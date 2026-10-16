
// ---------- the car drawn live in 3D while it turns ----------
// Flat faces in the drawing's own shades, banded by the same light, and the creases and silhouettes as
// outlines of the drawing's weight, all depth-tested. One canvas serves whichever view is on screen.
function makeCar3D(mesh) {
  const canvas = document.createElement("canvas");
  canvas.className = "rs-layer rs-car3d";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const link = (vs, fs) => {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  };
  // the pose: body to pad, then the view's projection, as the drawing's own iso() does it
  const POSE = `
uniform mat3 uRot; uniform vec3 uPivot; uniform vec3 uMove;
uniform vec2 uEX; uniform vec2 uEY; uniform vec2 uEZ; uniform vec2 uOrigin; uniform vec2 uView; uniform vec3 uV;
vec3 placed(vec3 p) { return uRot * (p - uPivot) + uPivot + uMove; }
vec2 screen(vec3 w) { return uOrigin + uEX * w.x + uEY * w.y + uEZ * w.z; }
vec4 clip(vec2 s, float depth) { return vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, -depth / 2400.0, 1.0); }`;
  const faceProgram = link(
    `attribute vec3 aPos; attribute vec3 aNormal; attribute float aGlass;
uniform vec3 uLight;${POSE}
varying float vScore; varying float vGlass;
void main() {
  vec3 w = placed(aPos);
  vec3 n = uRot * aNormal;
  if (dot(n, uV) < 0.0) n = -n;
  vScore = dot(n, uLight);
  vGlass = aGlass;
  gl_Position = clip(screen(w), dot(w, uV));
}`,
    `precision mediump float;
uniform vec3 uShade0; uniform vec3 uShade1; uniform vec3 uShade2; uniform vec3 uShade3; uniform vec3 uTop;
uniform vec4 uGlassColor; uniform float uAlpha; uniform float uGlassPass;
varying float vScore; varying float vGlass;
void main() {
  if ((vGlass > 0.5) != (uGlassPass > 0.5)) discard;
  vec3 c = vScore < 0.0 ? uShade0 : vScore < 0.2 ? uShade1 : vScore < 0.42 ? uShade2 : vScore < 0.62 ? uShade3 : uTop;
  float a = uAlpha;
  if (vGlass > 0.5) { c = uGlassColor.rgb; a *= uGlassColor.a; }
  gl_FragColor = vec4(c * a, a);
}`,
  );
  const lineProgram = link(
    `attribute vec3 aA; attribute vec3 aB; attribute vec2 aSide; attribute float aTone;
uniform float uHalf;${POSE}
varying float vTone;
void main() {
  vec3 wa = placed(aA); vec3 wb = placed(aB);
  vec2 sa = screen(wa); vec2 sb = screen(wb);
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  bool atB = aSide.x > 0.5;
  vec3 w = atB ? wb : wa;
  vec2 s = (atB ? sb : sa) + n * aSide.y * uHalf + d * (atB ? uHalf : -uHalf);
  vTone = aTone;
  gl_Position = clip(s, dot(w, uV) + 1.6);
}`,
    `precision mediump float;
uniform vec3 uHi; uniform vec3 uMid; uniform vec3 uLo; uniform vec3 uFaint; uniform float uAlpha;
varying float vTone;
void main() {
  vec3 c = vTone < 0.5 ? uHi : vTone < 1.5 ? uMid : vTone < 2.5 ? uLo : uFaint;
  gl_FragColor = vec4(c * uAlpha, uAlpha);
}`,
  );
  // faces: one vertex per corner of each triangle, carrying the triangle's flat normal
  const P = mesh.positions;
  const F = mesh.faces;
  const N = mesh.normals;
  const tonesOf = { hi: 0, mid: 1, lo: 2, faint: 3, glass: 3 };
  const faceCount = F.length / 4;
  const faceData = new Float32Array(faceCount * 3 * 7);
  for (let f = 0; f < faceCount; f++) {
    const glass = mesh.parts[F[f * 4 + 3]].tone === "glass" ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 4 + k];
      faceData.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N[f * 3], N[f * 3 + 1], N[f * 3 + 2], glass], (f * 3 + k) * 7);
    }
  }
  const faceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, faceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, faceData, gl.STATIC_DRAW);
  // edges: a quad each, chosen per frame by whether they are creases or silhouettes from where we look
  const E = mesh.edges;
  const edgeCount = E.length / 5;
  const lineData = new Float32Array(edgeCount * 4 * 9);
  for (let e = 0; e < edgeCount; e++) {
    const a = E[e * 5];
    const b = E[e * 5 + 1];
    const tone = tonesOf[mesh.parts[F[E[e * 5 + 2] * 4 + 3]].tone] ?? 0;
    const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([end, side], k) => lineData.set([...A, ...B, end, side, tone], (e * 4 + k) * 9));
  }
  const lineBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
  const uintIndex = !!gl.getExtension("OES_element_index_uint");
  const indexBuffer = gl.createBuffer();
  const indices = uintIndex ? new Uint32Array(edgeCount * 6) : new Uint16Array(Math.min(edgeCount, 10922) * 6);
  const where = (program, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
  const POSE_U = ["uRot", "uPivot", "uMove", "uEX", "uEY", "uEZ", "uOrigin", "uView", "uV", "uAlpha"];
  const fu = where(faceProgram, [...POSE_U, "uLight", "uShade0", "uShade1", "uShade2", "uShade3", "uTop", "uGlassColor", "uGlassPass"]);
  const lu = where(lineProgram, [...POSE_U, "uHalf", "uHi", "uMid", "uLo", "uFaint"]);
  const fa = { aPos: gl.getAttribLocation(faceProgram, "aPos"), aNormal: gl.getAttribLocation(faceProgram, "aNormal"), aGlass: gl.getAttribLocation(faceProgram, "aGlass") };
  const la = { aA: gl.getAttribLocation(lineProgram, "aA"), aB: gl.getAttribLocation(lineProgram, "aB"), aSide: gl.getAttribLocation(lineProgram, "aSide"), aTone: gl.getAttribLocation(lineProgram, "aTone") };
  // the theme's colours, read from the page's tokens
  const rgb = (name) => {
    const probe = getComputedStyle(document.querySelector(".iso") || document.body).getPropertyValue(name).trim() || "#888";
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = probe;
    const hex = c.fillStyle;
    if (hex.startsWith("#")) return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const m = hex.match(/[\d.]+/g) || [128, 128, 128];
    return m.slice(0, 3).map((v) => +v / 255);
  };
  let colours = null;
  const readColours = () => {
    colours = {
      shades: ["--anatomy-shade-0", "--anatomy-shade-1", "--anatomy-shade-2", "--anatomy-shade-3", "--anatomy-top"].map(rgb),
      lines: ["--anatomy-hi", "--anatomy-mid", "--anatomy-lo", "--anatomy-faint"].map(rgb),
      glass: [...rgb("--rs-glass"), 0.35],
    };
  };
  let drawn = false;
  function size() {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * r));
    const h = Math.max(1, Math.round(canvas.clientHeight * r));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }
  // pose: { yaw, roll } in radians, { x, y, z } in cm on the pad; alpha fades the whole car
  function draw(VD, pose, alpha) {
    if (!colours) readColours();
    size();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (alpha <= 0.001) {
      drawn = false;
      return;
    }
    const cy = Math.cos(pose.yaw);
    const sy = Math.sin(pose.yaw);
    const cr = Math.cos(-pose.roll);
    const sr = Math.sin(-pose.roll);
    // Rz(yaw) * Ry(-roll), column-major for GL
    const R = [cy * cr, sy * cr, -sr, -sy, cy, 0, cy * sr, sy * sr, cr];
    const V = VD.V;
    const set = (u) => {
      gl.uniformMatrix3fv(u.uRot, false, R);
      gl.uniform3f(u.uPivot, 0, 0, 45);
      gl.uniform3f(u.uMove, pose.x, pose.y, pose.z);
      gl.uniform2f(u.uEX, VD.EX[0], VD.EX[1]);
      gl.uniform2f(u.uEY, VD.EY[0], VD.EY[1]);
      gl.uniform2f(u.uEZ, VD.EZ[0], VD.EZ[1]);
      gl.uniform2f(u.uOrigin, VD.origin[0], VD.origin[1]);
      gl.uniform2f(u.uView, VD.W, VD.H);
      gl.uniform3f(u.uV, V[0], V[1], V[2]);
      gl.uniform1f(u.uAlpha, alpha);
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // opaque faces, then the outlines over them, then the glass
    const faces = (glassPass) => {
      gl.useProgram(faceProgram);
      set(fu);
      gl.uniform3f(fu.uLight, VD.light[0], VD.light[1], VD.light[2]);
      ["uShade0", "uShade1", "uShade2", "uShade3", "uTop"].forEach((name, i) => gl.uniform3fv(fu[name], colours.shades[i]));
      gl.uniform4fv(fu.uGlassColor, colours.glass);
      gl.uniform1f(fu.uGlassPass, glassPass ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, faceBuffer);
      gl.enableVertexAttribArray(fa.aPos);
      gl.vertexAttribPointer(fa.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(fa.aNormal);
      gl.vertexAttribPointer(fa.aNormal, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(fa.aGlass);
      gl.vertexAttribPointer(fa.aGlass, 1, gl.FLOAT, false, 28, 24);
      gl.drawArrays(gl.TRIANGLES, 0, faceCount * 3);
      gl.disableVertexAttribArray(fa.aGlass);
    };
    gl.depthMask(true);
    faces(false);
    // which edges show: a crease when either face is turned to us, any other only on the silhouette
    const facing = new Uint8Array(faceCount);
    for (let f = 0; f < faceCount; f++) {
      const n0 = N[f * 3];
      const n1 = N[f * 3 + 1];
      const n2 = N[f * 3 + 2];
      // the normal turned onto the pad, then against the view
      const w0 = R[0] * n0 + R[3] * n1 + R[6] * n2;
      const w1 = R[1] * n0 + R[4] * n1 + R[7] * n2;
      const w2 = R[2] * n0 + R[5] * n1 + R[8] * n2;
      facing[f] = w0 * V[0] + w1 * V[1] + w2 * V[2] > 0 ? 1 : 0;
    }
    let count = 0;
    const limit = indices.length / 6;
    for (let e = 0; e < edgeCount && count < limit; e++) {
      const f1 = E[e * 5 + 2];
      const f2 = E[e * 5 + 3];
      const crease = E[e * 5 + 4];
      const a = facing[f1];
      const b = f2 >= 0 ? facing[f2] : a;
      if (crease ? !(a || b) : a === b) continue;
      const base = e * 4;
      indices.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], count * 6);
      count++;
    }
    gl.useProgram(lineProgram);
    set(lu);
    gl.uniform1f(lu.uHalf, 0.45); // half the drawing's outline weight, in the drawing's own units
    ["uHi", "uMid", "uLo", "uFaint"].forEach((name, i) => gl.uniform3fv(lu[name], colours.lines[i]));
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.enableVertexAttribArray(la.aA);
    gl.vertexAttribPointer(la.aA, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(la.aB);
    gl.vertexAttribPointer(la.aB, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(la.aSide);
    gl.vertexAttribPointer(la.aSide, 2, gl.FLOAT, false, 36, 24);
    gl.enableVertexAttribArray(la.aTone);
    gl.vertexAttribPointer(la.aTone, 1, gl.FLOAT, false, 36, 32);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, count * 6, uintIndex ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    [la.aA, la.aB, la.aSide, la.aTone].forEach((l) => gl.disableVertexAttribArray(l));
    gl.depthMask(false);
    faces(true);
    gl.depthMask(true);
    drawn = true;
  }
  return {
    canvas,
    draw,
    clear() {
      if (!drawn) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawn = false;
    },
    retheme: readColours,
  };
}
