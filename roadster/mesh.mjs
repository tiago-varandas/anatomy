// The proxy car for the turning view: a light mesh of the car's outside, its cabin and its nozzles,
// built from the same profiles the drawing uses. Faces are triangles with flat normals, grouped into
// parts that carry the drawing's outline tone. Edges keep their two faces, so the page can draw the
// creases and, as the car turns, the silhouettes as outlines.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// signed area of a 2D ring; positive when it runs anticlockwise
const area = (ring) => ring.reduce((a, [x, y], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length];
  return a + x * y2 - x2 * y;
}, 0) / 2;

// ear clipping for a simple anticlockwise ring: triangles as index triples into the ring
function triangulate(ring) {
  const idx = ring.map((_, i) => i);
  const out = [];
  const inside = (p, a, b, c) => {
    const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    return s(a, b, p) >= -1e-9 && s(b, c, p) >= -1e-9 && s(c, a, p) >= -1e-9;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = ring[ia];
      const b = ring[ib];
      const c = ring[ic];
      const turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (turn <= 1e-9) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(ring[j], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

export function meshMaker() {
  const parts = [];
  const verts = [];
  const faces = [];
  let part = -1;
  let index = new Map();
  const vertex = (p) => {
    const key = `${part}|${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}`;
    if (!index.has(key)) {
      index.set(key, verts.length);
      verts.push(p);
    }
    return index.get(key);
  };
  // one triangle, wound so its normal points along `out` when given
  const tri = (a, b, c, out) => {
    const n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return;
    if (out && dot(n, out) < 0) [b, c] = [c, b];
    faces.push([vertex(a), vertex(b), vertex(c), part]);
  };
  const begin = (name, tone = "hi") => {
    parts.push({ name, tone });
    part = parts.length - 1;
    index = new Map();
  };
  // a prism: a 2D ring in the frame's (u, v) plane, between s0 and s1 along its axis a
  function prism(name, F, ring, s0, s1, tone) {
    begin(name, tone);
    const ccw = area(ring) > 0 ? ring : [...ring].reverse();
    const at = (s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
    const tris = triangulate(ccw);
    // the ring is anticlockwise seen from +a (u to v), so the +a cap faces +a as wound
    const a = F.a;
    const minus = [-a[0], -a[1], -a[2]];
    for (const [i, j, k] of tris) {
      tri(at(s1, ccw[i]), at(s1, ccw[j]), at(s1, ccw[k]), a);
      tri(at(s0, ccw[i]), at(s0, ccw[k]), at(s0, ccw[j]), minus);
    }
    for (let i = 0; i < ccw.length; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % ccw.length];
      // the outward side of an anticlockwise ring: the edge direction turned clockwise
      const du = q[0] - p[0];
      const dv = q[1] - p[1];
      const out = [F.u[0] * dv - F.v[0] * du, F.u[1] * dv - F.v[1] * du, F.u[2] * dv - F.v[2] * du];
      tri(at(s0, p), at(s0, q), at(s1, q), out);
      tri(at(s0, p), at(s1, q), at(s1, p), out);
    }
  }
  const XF = { o: [0, 0, 0], a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };
  const YF = { o: [0, 0, 0], a: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] };
  // a profile in (y, z) across x, and a section in (x, z) along y, as the drawing makes them
  const profile = (name, ring, x0, x1, tone) => prism(name, XF, ring, x0, x1, tone);
  const section = (name, ring, y0, y1, tone) => prism(name, YF, ring, y0, y1, tone);
  const box = (name, [x0, y0, z0], [x1, y1, z1], tone) => prism(name, { o: [0, 0, 0], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, tone);
  // a round part along any axis: radius r0 at s0 to r1 at s1, n facets
  function round(name, o, axis, s0, s1, r0, r1, n, tone) {
    const a = unit(axis);
    const helper = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const u = unit(cross(helper, a));
    const v = cross(a, u);
    begin(name, tone);
    const at = (s, r, t) => [o[0] + a[0] * s + (u[0] * Math.cos(t) + v[0] * Math.sin(t)) * r, o[1] + a[1] * s + (u[1] * Math.cos(t) + v[1] * Math.sin(t)) * r, o[2] + a[2] * s + (u[2] * Math.cos(t) + v[2] * Math.sin(t)) * r];
    const c0 = [o[0] + a[0] * s0, o[1] + a[1] * s0, o[2] + a[2] * s0];
    const c1 = [o[0] + a[0] * s1, o[1] + a[1] * s1, o[2] + a[2] * s1];
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2;
      const t1 = ((i + 1) / n) * Math.PI * 2;
      const tm = (t0 + t1) / 2;
      const out = [u[0] * Math.cos(tm) + v[0] * Math.sin(tm), u[1] * Math.cos(tm) + v[1] * Math.sin(tm), u[2] * Math.cos(tm) + v[2] * Math.sin(tm)];
      tri(at(s0, r0, t0), at(s0, r0, t1), at(s1, r1, t1), out);
      tri(at(s0, r0, t0), at(s1, r1, t1), at(s1, r1, t0), out);
      if (r1 > 0.01) tri(c1, at(s1, r1, t0), at(s1, r1, t1), a);
      if (r0 > 0.01) tri(c0, at(s0, r0, t1), at(s0, r0, t0), [-a[0], -a[1], -a[2]]);
    }
  }
  // the finished mesh: positions, faces with their part, and the edges worth drawing
  function finish({ crease = 30 } = {}) {
    const normals = faces.map(([a, b, c]) => unit(cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]))));
    const edgeFaces = new Map();
    faces.forEach(([a, b, c], f) => {
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = p < q ? `${p},${q}` : `${q},${p}`;
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        edgeFaces.get(key).push(f);
      }
    });
    const cosCrease = Math.cos((crease * Math.PI) / 180);
    const edges = [];
    for (const [key, fs] of edgeFaces) {
      const [p, q] = key.split(",").map(Number);
      if (fs.length === 1) edges.push([p, q, fs[0], -1, 1]);
      else if (fs.length === 2) {
        const d = dot(normals[fs[0]], normals[fs[1]]);
        if (d > 0.9998) continue; // flat: never an outline
        edges.push([p, q, fs[0], fs[1], d < cosCrease ? 1 : 0]);
      }
    }
    const r = (v) => Math.round(v * 10) / 10;
    return {
      parts,
      positions: verts.flatMap((p) => p.map(r)),
      faces: faces.flatMap(([a, b, c, k]) => [a, b, c, k]),
      normals: normals.flatMap((n) => n.map((v) => Math.round(v * 1000) / 1000)),
      edges: edges.flat(),
    };
  }
  return { profile, section, box, round, prism, finish };
}
