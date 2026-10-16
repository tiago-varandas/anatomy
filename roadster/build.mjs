import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";
import { glCamera } from "../kit/gl.mjs";
import { kitScript, glScript } from "../scripts/inline-kit.mjs";
import { meshMaker } from "./mesh.mjs";
import { NOZZLES, SPEC, FULL, RESIDUAL, simulate, tankOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Four views a quarter turn apart around the car: rear-left, rear-right, front-right, front-left.
// `node build.mjs` builds all four (one process each, in parallel) and assembles the dark and light
// pages; `node build.mjs --view=N` builds one view's drawing. Add --audit to audit every view.
const VIEWS = [40, 130, 220, 310];
const VIEW_NAMES = ["rear left", "rear right", "front right", "front left"];
const viewArg = process.argv.find((a) => a.startsWith("--view="));
const VIEW = viewArg ? Number(viewArg.slice(7)) : null;
if (VIEW === null) {
  // --assemble rebuilds only the pages from the views already drawn, for changes to the runtime or styles
  if (process.argv.includes("--assemble")) assemble();
  else await buildAll();
  process.exit(process.exitCode ?? 0);
}

// World units are centimetres. x runs to the car's left, y to its tail, z up from the pad.
// The side facing the camera is open: its side panel comes off and the near halves of the hood, deck
// and diffuser are cut away (beyond x = CUT on that side).
const W = 1000;
const H = 760;
const AZIMUTH = VIEWS[VIEW];
const ELEVATION = 32;
const NEAR = AZIMUTH === 40 || AZIMUTH === 310 ? 1 : -1; // +1 when the car's left side faces the camera
const REAR = AZIMUTH === 40 || AZIMUTH === 130; // the camera stands behind the car

const HALF_W = 100;
const SKIN = 1.2;
const IN = HALF_W - SKIN; // inner face of the side skins
const CUT = 12; // near halves of hood, deck and battery lid are cut away beyond this x
const AXF = -132; // front axle
const AXR = 132; // rear axle
const TRACK = 84; // wheel centres at x = ±TRACK
const TYRE_R = 34;
const TYRE_W = 14; // half width
const RIM_R = 25;
const WZ = TYRE_R; // axle height: the tyres stand on the pad
const ARCH_R = 42;
const SILL_Z = 13;

const PAD = { x: -196, y: -372, w: 456, d: 716, r: 12 };
const PAD_H = 16;

// Taking the car apart peels it off its air system, which never moves: the side panel lifts first,
// the rest of the skin rises to meet it, the diffuser and the nozzle doors slide out the back, and
// the cabin floats up between the skin and the chassis.
const PIECES = {
  panel: { move: [10 * NEAR, 0, 240] },
  body: { move: [0, 0, 240] },
  diffuser: { move: [0, 50, -3] },
  cabin: { move: [0, 0, 95] },
  car: { move: [0, 0, 0] },
  pad: { move: [0, 0, 0] },
};
const STAGGER = ["panel", "body", "diffuser", "cabin"]; // the chassis, its air system and the pad never move
const SPRING = { stagger: 0.14, stiffness: 48, damping: 12.5, substeps: 4 };

// every view is drawn at one scale, the smallest that fits all four, so the car keeps its size as it turns
const fitPoints = (near) => [...k.boxCorners(PAD, -PAD_H, 0), [near * (HALF_W + 10), 216, 103 + 240 + 80], [near * (HALF_W + 10), -219, 103 + 240 + 80], [-near * HALF_W, -215, 120], [-near * HALF_W, 215, 120]];
const nearOf = (az) => (az === 40 || az === 310 ? 1 : -1);
const SCALE = Math.min(...VIEWS.map((az) => k.fitProjection(fitPoints(nearOf(az)), W, H, { pad: 16, azimuth: az, elevation: ELEVATION }).scale));
const P = (() => {
  const flat = fitPoints(NEAR).map((p) => k.iso(p, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { origin: [W / 2 - cx * SCALE, H / 2 - cy * SCALE], scale: SCALE, azimuth: AZIMUTH, elevation: ELEVATION };
})();
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const f2 = (v) => Math.round(v * 100) / 100;
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}

// ---------- recording: every item goes in with its true shape and its layer ----------
// Layers: "back" (the pad and what lies on its far side), "car" (moves as one), "front" (nearer than
// the car at every pose it reaches: the deflector, the near chocks, the fill cart and its hose).
const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const record = R.solid;
let LAYER = "car";
let PIECE = "car";
function put(name, ref, svg, shapes = [], { bias = 0, attrs = "", ...rest } = {}) {
  return R.put({ piece: PIECE, ride: PIECE, name: R.nameFor(name), at: ref, bias, svg, shapes, move: PIECES[PIECE].move, attrs, layer: LAYER, ...rest });
}

// prisms of any polygon along any axis (concave allowed), as in the arcade cabinet
const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}
function prismPaths(F, poly, s0, s1) {
  const ring = signed(poly) > 0 ? poly : [...poly].reverse();
  const n = ring.length;
  const W3 = (s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  const capNear = G.dot3(F.a, V) > 0;
  const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
  const near = ring.map((p) => at(W3(nearS, p)));
  const far = ring.map((p) => at(W3(farS, p)));
  const normals = ring.map(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % n];
    return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
  });
  const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
  const outline = [];
  const crease = [];
  for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
  for (const run of runsOf(facing, true)) {
    crease.push(k.pathOf(run.map((i) => near[i])));
    outline.push(k.pathOf(run.map((i) => far[i])));
  }
  for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
  const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
  const buckets = [[], [], [], [], []];
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
    parts.push(k.pathOf(quad, true));
    buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
  }
  const capTone = G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P);
  buckets[capTone].push(k.pathOf(screenOriented(near), true));
  return { fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
}
const XF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); // polygons in (y, z), extruded along x
const YF = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]); // polygons in (x, z), extruded along y
const centroid = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
// a polygon in (y, z) extruded across x from x0 to x1: body profiles, the hood, the deck
function profile(name, poly, x0, x1, style = {}, { extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const shape = record(A.prism(XF, poly, x0, x1, { name }));
  const [cy, cz] = centroid(poly);
  put(name, [(x0 + x1) / 2, cy, cz], S(prismPaths(XF, poly, x0, x1), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
// a polygon in (x, z) extruded along y from y0 to y1: the roll hoop, the yoke, strakes
function section(name, poly, y0, y1, style = {}, { extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const shape = record(A.prism(YF, poly, y0, y1, { name }));
  const [cx, cz] = centroid(poly);
  put(name, [cx, (y0 + y1) / 2, cz], S(prismPaths(YF, poly, y0, y1), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, attrs = "", ground = false, owner } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, ground, owner }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function disc(name, F, s0, s1, r, style = {}, { extra = "", bias = 0, owner, steps, attrs = "" } = {}) {
  const shape = record(A.disc(F, s0, s1, r, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P, steps ? { steps } : {}), { tone: "mid", ...style }) + extra, [shape], { bias, attrs });
  return shape;
}
function turned(name, F, profileKnots, style = {}, { extra = "", inner = "", bias = 0, smooth, owner, attrs = "" } = {}) {
  const paths = G.solidOf(profileKnots, F, P, smooth ? { smooth } : {});
  const mid = (profileKnots[0][0] + profileKnots[profileKnots.length - 1][0]) / 2;
  const shape = record(A.solid(F, profileKnots, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function ball(name, c, r, style = {}, { bias = 0, attrs = "" } = {}) {
  const shape = record(A.ball(c, r, { name }));
  put(name, c, S(G.sphereOf(c, r, P, { steps: 24 }), { tone: "mid", ...style }), [shape], { bias, attrs });
  return shape;
}
// a rod from a to b of radius r (a slender solid), ends flush on whatever they meet
function rod(name, a, b, r, style = {}, { attrs = "", steps = 14 } = {}) {
  const d = G.sub3(b, a);
  const F = G.frameAlong(a, G.unit3(d));
  return disc(name, F, 0, G.len3(d), r, { tone: "mid", ...style }, { steps, attrs });
}
function cyl(name, cx, cy, r, z, h, style = {}, { steps = 32, extra = "", inner = "", attrs = "", ground = false } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z, h, { name, ground }));
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps), { tone: "mid", ...style, inner }) + extra, [shape], { attrs });
  return shape;
}
const ROUTES = {};
// pipes and cables: depth-sorted chunks, gapped under their own fittings
function line(name, control, r, { bend = 6, tone = "hi", shells = [true, true], free = [false, false], limp = false, touch, attrs = "", braid = false, gaps: extra = [] } = {}) {
  const route = G.fillet(control, Math.max(bend, r * 3), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(2.2, r * 2.4);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : []), ...extra];
  R.route(name, route, r, { owner: name, gaps, limp, touch, free, rims: shells.map((on) => (on ? r * 1.7 : r)), piece: PIECE, move: PIECES[PIECE].move, ride: PIECE });
  const rings = braid ? { spacing: 1.1, tone: "faint" } : null;
  tubePieces(route, r, P, { maxLength: 10, spacing: Math.max(0.7, Math.min(1.4, r)), gaps, ...(rings ? { rings } : {}) }).forEach((part, index) =>
    put(`${name}:${index}`, part.mid, tubeSvg(part, { tone }), [A.tube(part.points, part.radii)], { route: name, chunk: index, attrs: ` data-route="${name}" data-from="${f2(part.from)}" data-to="${f2(part.to)}"${attrs}` }),
  );
  [0, 1].forEach((index) => {
    if (!shells[index]) return;
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    const F = G.frameAlong(end, tangent);
    const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
    // a fitting: a hex nut drawn as a short disc with a ridge
    disc(`${name}.fitting${index}`, F, s0, s1, r * 1.7, { tone: "mid" }, { owner: name, steps: 6, attrs: ` data-route="${name}" data-fitting="${index}"${attrs}` });
  });
  ROUTES[name] = { total: f2(total), route };
  return { route, total };
}

const back = [];
const halos = [];

// ===================================================================== the pad
LAYER = "back";
PIECE = "pad";
back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(PAD, -8), -PAD_H, 4, P)}"/>`);
box("stand.pad", [PAD.x, PAD.y, -PAD_H], [PAD.x + PAD.w, PAD.y + PAD.d, 0], { tone: "mid" }, {
  r: PAD.r,
  steps: 6,
  bevel: 1.2,
  ground: true,
  inner: Ln(k.sideSeam(PAD, -PAD_H + 5, P, 6), { tone: "faint" }),
  extra: [
    // saw-cut joints, edge to edge
    Ln([-180, 60].map((y) => k.lineOnTop([PAD.x + 0.4, y], [PAD.x + PAD.w - 0.4, y], 0, P)).join("") + k.lineOnTop([0, PAD.y + 0.4], [0, -180], 0, P) + k.lineOnTop([0, 60], [0, PAD.y + PAD.d - 0.4], 0, P), { tone: "faint" }),
    // anchor bolts at the pad corners
    Dots(k.corners(PAD, 14).map(([x, y]) => at([x, y, 0])), { size: 0.55 }),
  ].join(""),
});
// painted: a box round the car's start position, the start line at the front axle, a ruler along the near edge
{
  const boxPlan = { x: -112, y: -232, w: 224, d: 464, r: 2 };
  const ruler = { x: 240, y: -356, w: 7, d: 440, r: 0.6 };
  const startY = AXF - TYRE_R - 4;
  const t = k.topTicks(ruler.y + 10, ruler.y + ruler.d - 10, 25, 4, ruler.x, 0.12, [2.6, 5.4], P);
  put(
    "stand.paint",
    [0, 0, 0.06],
    `<g class="rs-paint">` +
      Ln(k.planOutline(boxPlan, 0.06, P, 2) + k.planOutline(k.insetPlan(boxPlan, 2.4), 0.06, P, 2), { tone: "mid" }) +
      Ln(k.lineOnTop([-112, startY], [112, startY], 0.06, P), { tone: "hi" }) +
      `</g>` +
      S(k.slabOf(ruler, 0, 0.12, P, 2), { tone: "lo", crease: "none" }) +
      Ln(rulerTicks(ruler), { tone: "lo" }),
    [record(A.slab({ x: -112, y: -232, w: 224, d: 464, r: 2 }, 0, 0.06, { name: "stand.paint" }, 2)), record(A.slab(ruler, 0, 0.12, { name: "stand.paint" }, 2))],
  );
  void t;
}
function rulerTicks(ruler) {
  // ticks hang from the strip's inner edge: every 25 cm, a long one every metre from the start line
  const out = [];
  const y0 = AXF - TYRE_R - 4;
  for (let y = ruler.y + 6; y <= ruler.y + ruler.d - 6; y += 25) {
    const major = Math.abs(((y - y0) % 100 + 100) % 100) < 1e-6 || Math.abs((((y - y0) % 100) + 100) % 100 - 100) < 1e-6;
    out.push(k.lineOnTop([ruler.x, y], [ruler.x - (major ? 9 : 4.5), y], 0.12, P));
  }
  return out.join("");
}

// chocks: four rubber wedges, pulled clear and lying beside the wheels
function chock(name, x, y) {
  const poly = [[-7, 0], [7, 0], [7, 2.4], [-1, 9], [-7, 9]];
  return section(name, poly.map(([u, v]) => [x + u, v]), y - 9, y + 9, { tone: "lo" }, { extra: "" });
}
for (const y of [AXF, AXR]) chock("stand.chock", -NEAR * 126, y + 30);

// ===================================================================== corners
LAYER = "car";
PIECE = "car";
const tyreR = (s) => 26.5 + 7.5 * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(s) / TYRE_W), 4)), 0.25);
const tyreSlope = (s) => {
  const u = Math.min(0.995, Math.abs(s) / TYRE_W);
  const inner = 1 - Math.pow(u, 4);
  return -Math.sign(s) * 7.5 * 0.25 * Math.pow(inner, -0.75) * 4 * Math.pow(u, 3) / TYRE_W;
};
const WHEELS = [];
const CORNERS = [
  { id: "fl", y: AXF, sx: 1 },
  { id: "rl", y: AXR, sx: 1 },
  { id: "fr", y: AXF, sx: -1 },
  { id: "rr", y: AXR, sx: -1 },
];
for (const c of CORNERS) {
  const near = c.sx === NEAR;
  const centre = [c.sx * TRACK, c.y, WZ];
  const F = G.frameOf(centre, [c.sx, 0, 0], [0, 1, 0], [0, 0, 1]);
  const knots = Array.from({ length: 27 }, (_, i) => -TYRE_W + (2 * TYRE_W * i) / 26);
  const tyreProfile = [[-TYRE_W, RIM_R], ...knots.map((s) => [s, tyreR(s), 1]), [TYRE_W, RIM_R]];
  turned(`${c.id}.tyre`, F, tyreProfile, { tone: "mid" }, { smooth: { slope: (s) => (Math.abs(s) >= TYRE_W ? 0 : tyreSlope(s)), radius: (s) => (Math.abs(s) >= TYRE_W - 1e-6 ? 26.5 : tyreR(s)) }, inner: Ln(G.arcOf(F, 0, TYRE_R, P), { tone: "faint" }) });
  const face = TYRE_W + 0.9;
  const spokes = G.spokesOf(F, face, 6.6, RIM_R - 0.3, 12, P, { sweep: 0.3 });
  const lugs = G.dotsOf(F, face + 0.8, 4.4, 5, P, { all: true });
  disc(`${c.id}.rim`, F, TYRE_W, face, RIM_R, { tone: "hi" }, { extra: near ? `<g data-spokes="${c.id}">${Ln(spokes, { tone: "mid" })}</g>` + Ln(G.circleOf(F, face, RIM_R - 2.2, P, 64), { tone: "faint" }) : "", attrs: ` data-wheel="${c.id}"` });
  if (near) disc(`${c.id}.cap`, F, face, face + 0.8, 6.2, { tone: "hi" }, { extra: Dots(lugs, { size: 0.5, tone: "mid" }) + Ln(G.circleOf(F, face + 0.8, 2.8, P, 24), { tone: "lo" }) });
  // inboard: hub, a drilled brake disc, the caliper on the trailing side, the upright
  disc(`${c.id}.hub`, F, -TYRE_W - 1.8, -TYRE_W, 9, { tone: "mid" });
  disc(`${c.id}.disc`, F, -TYRE_W - 4.2, -TYRE_W - 1.8, 18.5, { tone: "hi" }, { extra: Ln(G.circleOf(F, -TYRE_W - 4.2, 12.5, P, 48) + G.circleOf(F, -TYRE_W - 4.2, 8, P, 32), { tone: "faint" }) + Dots(G.dotsOf(F, -TYRE_W - 4.2, 15.6, 18, P), { size: 0.45, tone: "lo" }) });
  const xIn = c.sx * (TRACK - TYRE_W - 4.2);
  const behind = c.y < 0 ? 1 : -1;
  const calY = c.y + behind * 15;
  box(`${c.id}.caliper`, [Math.min(xIn, xIn - c.sx * 3.6), calY - 6, WZ + 2], [Math.max(xIn, xIn - c.sx * 3.6), calY + 6, WZ + 17], { tone: "hi" }, { r: 1.6, steps: 3, bevel: 0.3 });
  const ux0 = c.sx * (TRACK - TYRE_W - 4.2);
  const ux1 = c.sx * (TRACK - TYRE_W - 4.2 - 8);
  box(`${c.id}.upright`, [Math.min(ux0, ux1), c.y - 6, WZ - 18], [Math.max(ux0, ux1), c.y + 6, WZ + 20], { tone: "mid" }, { r: 1.4, steps: 3, bevel: 0.3 });
  WHEELS.push({ id: c.id, F: { o: F.o, a: F.a, u: F.u, v: F.v }, face, near });
  c.upright = { x: c.sx * (TRACK - TYRE_W - 4.2 - 8), z0: WZ - 18, z1: WZ + 20 };
}

// ===================================================================== body: far skin, nose, hood, glass, hoop, deck, tail
PIECE = "body";
// The side profile in (y, z): a low wedge with a sharp nose, high front fenders, an open cockpit
// (the targa roof is stowed), a buttress behind the seat and a long flat deck.
const archOver = (cy) => {
  const pts = [[cy + ARCH_R, SILL_Z]];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI;
    pts.push([cy + ARCH_R * Math.cos(a), WZ + ARCH_R * Math.sin(a) * 0.98]);
  }
  pts.push([cy - ARCH_R, SILL_Z]);
  return pts;
};
const TOP_LINE = [[-213, SILL_Z], [-219, 24], [-209, 42], [-168, 70], [-132, 80.5], [-96, 84], [-60, 85.2], [44, 86], [62, 103], [130, 101], [204, 93], [216, 85], [215, 44], [207, SILL_Z]];
const SIDE = [...TOP_LINE, ...archOver(AXR), ...archOver(AXF)];
const topAt = (y) => {
  for (let i = 0; i < TOP_LINE.length - 1; i++) {
    const [y0, z0] = TOP_LINE[i];
    const [y1, z1] = TOP_LINE[i + 1];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && y1 !== y0) return z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
  }
  return 86;
};
// the far skin, seen from inside through the open near side
profile("body.skin.far", SIDE, NEAR > 0 ? -HALF_W : IN, NEAR > 0 ? -IN : HALF_W, { tone: "hi" }, { extra: "" });
// the part of a full-width panel that stays: everything but the near half beyond CUT
const KEEP = NEAR > 0 ? [-IN, CUT] : [-CUT, IN];
// a thin shell along a run of the profile, inward by t
function shell(points, t) {
  const n = points.length;
  const inward = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dy = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dy, dz) || 1;
    return [p[0] + (dz / l) * t, p[1] - (dy / l) * t];
  });
  return [...points, ...inward.reverse()];
}
const HOOD = shell([[-209, 42], [-168, 70], [-132, 80.5], [-96, 84], [-60, 85.2]], 1.4);
const NOSE = shell([[-213, SILL_Z], [-219, 24], [-209, 42]], 1.6);
// the deck runs to the tail's top edge, and the two shells share one mitre point there, so neither runs into the other
const DECK_LINE = [[62, 103], [130, 101], [204, 93], [216, 85]];
// the tail's outer face leans back toward its top, but its inner face stands upright, so lifting the
// tail off never sweeps it into the fill line's fitting behind it
const TAIL_IN = 213.4;
const DECK = shell(DECK_LINE, 1.4);
const deckIn = DECK[DECK_LINE.length + 1];
const MITRE = [TAIL_IN, deckIn[1] + ((TAIL_IN - deckIn[0]) * (85 - 93)) / (216 - 204)];
DECK[DECK_LINE.length] = MITRE;
const TAIL = [[216, 85], [215, 44], [TAIL_IN, 44], MITRE];
profile("body.hood", HOOD, KEEP[0], KEEP[1], { tone: "hi" });
profile("body.nose", NOSE, -IN, IN, { tone: "hi" }, { extra: "" });
profile("body.deck", DECK, KEEP[0], KEEP[1], { tone: "hi" });
profile("body.tail", TAIL, -IN, IN, { tone: "hi" });
// windscreen: glass between two A-pillars, a header bar on top
const SCREEN = [[-60, 85.2], [-6, 107.5]];
const screenStrip = (t) => shell(SCREEN, t);
profile("body.screen", screenStrip(0.8), -80, 80, { tone: "faint" }, { attrs: ' data-glass=""' });
for (const s of [-1, 1]) profile("body.apillar", screenStrip(2.6), s > 0 ? 80 : -86, s > 0 ? 86 : -80, { tone: "hi" });
profile("body.header", [[-6, 107.5], [-5, 105.1], [0, 105.1], [0, 109.8], [-6, 109.8]], -86, 86, { tone: "hi" });
// the roll hoop behind the seat: an inverted U across the car, a bar bolted onto two feet that stand on
// the bulkhead. It sits wholly behind the seat back, so from every side one of them is simply in front.
const HOOP = { y0: 56, y1: 61 };
const HOOP_BAR = [[-60, 104.4], [60, 104.4], [60, 98], [-60, 98]];
const hoopFoot = (s) => [[s * 60, 104.4], [s * 80, 104.4], [s * IN, 88], [s * 64, 88], [s * 60, 98]];
section("body.hoop", HOOP_BAR, HOOP.y0, HOOP.y1, { tone: "hi" });
for (const s of [1, -1]) section("body.hoop.foot", hoopFoot(s), HOOP.y0, HOOP.y1, { tone: "hi" }, { extra: Dots([at([s * 60.8, 57.4, 104.4]), at([s * 60.8, 59.6, 104.4])], { size: 0.4 }) });
// the stowed targa roof: a glass panel lying in the rear trunk under the deck
box("body.targa", [-64, 132, 89.6], [20, 184, 91.4], { tone: "faint" }, { r: 3, steps: 4, attrs: ' data-glass=""', extra: Ln(k.planOutline({ x: -60, y: 136, w: 76, d: 44, r: 2 }, 91.4, P, 3), { tone: "lo" }) });

const UPF = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
PIECE = "car";
// ===================================================================== the tub and structure
const TUB = { y0: -92, y1: 60 };
// the carbon floor over the battery; in front of the seat its near half is cut away to show the cells
box("tub.floor", [-78, TUB.y0, 24], [CUT, TUB.y1, 26], { tone: "mid" }, { r: 0.4, extra: Ln([-60, -20, 20].map((y) => k.lineOnTop([-78, y], [CUT, y], 26, P)).join(""), { tone: "faint" }) });
box("tub.floor.near", [CUT, -8, 24], [78, TUB.y1, 26], { tone: "mid" }, { r: 0.4 });
// sills: inner wall, top and bottom; the near sill's outer wall is off with the panel.
// Each sill bottom is open over the lift nozzle (y 2..22).
for (const sx of [1, -1]) {
  const [w0, w1] = sx > 0 ? [78, 80] : [-80, -78];
  const [o0, o1] = sx > 0 ? [80, IN] : [-IN, -80];
  box("tub.sill.wall", [w0, -88, SILL_Z], [w1, 88, 42], { tone: "mid" }, { r: 0.3 });
  box("tub.sill.top", [o0, -88, 40], [o1, 88, 42], { tone: "mid" }, { r: 0.3, extra: Dots([-80, -40, 40, 80].map((y) => at([sx * 89, y, 42])), { size: 0.45 }) });
  box("tub.sill.bottom", [o0, -88, SILL_Z], [o1, 2, SILL_Z + 2], { tone: "lo" }, { r: 0.3 });
  box("tub.sill.bottom", [o0, 22, SILL_Z], [o1, 88, SILL_Z + 2], { tone: "lo" }, { r: 0.3 });
}
// bulkheads at both ends of the cell; the rear one has a slot along its top for the air lines
box("tub.firewall", [-78, -95, 26], [78, -92, 72], { tone: "mid" }, { r: 0.3 });
box("tub.bulkhead", [-78, TUB.y1, 26], [78, TUB.y1 + 3, 70], { tone: "mid" }, { r: 0.3 });
box("tub.bulkhead.side", [-78, TUB.y1, 70], [-60, TUB.y1 + 3, 88], { tone: "mid" }, { r: 0.3 });
box("tub.bulkhead.side", [76, TUB.y1, 70], [78, TUB.y1 + 3, 88], { tone: "mid" }, { r: 0.3 });
box("tub.bulkhead.cap", [-60, TUB.y1, 86], [76, TUB.y1 + 3, 88], { tone: "mid" }, { r: 0.3 });
// front and rear subframes: two rails each, cross members, a bumper beam at the nose
for (const sx of [1, -1]) {
  box("front.rail", [sx > 0 ? 30 : -38, -200, 20], [sx > 0 ? 38 : -30, -95, 28], { tone: "lo" }, { r: 0.8 });
  box("rear.rail", [sx > 0 ? 30 : -38, TUB.y1 + 3, 12], [sx > 0 ? 38 : -30, 178, 20], { tone: "lo" }, { r: 0.8 });
}
box("front.beam", [-86, -206, 20], [86, -200, 32], { tone: "mid" }, { r: 1, extra: Dots([-60, -20, 20, 60].map((x) => at([x, -200, 31.6])), { size: 0.45 }) });
box("front.cross", [-30, -110, 20], [30, -102, 28], { tone: "lo" }, { r: 0.6 });
box("rear.cross", [-30, 112, 12], [30, 118, 20], { tone: "lo" }, { r: 0.6 });

// ===================================================================== suspension, brakes and steering (drawn simply)
function plate(name, ring, z0, z1, style = {}, { extra = "" } = {}) {
  const shape = record(A.extruded(ring, z0, z1 - z0, { name }));
  const [cx, cy] = centroid(ring);
  put(name, [cx, cy, (z0 + z1) / 2], S(k.extrude(ring, z0, z1 - z0, P, { convex: true }), { tone: "mid", ...style }) + extra, [shape]);
  return shape;
}
// a coil-over between two spring seats: damper body, rod, and the coil split into the runs in
// front of and behind the damper so nothing interlocks
function coilOver(id, cx, cy, z0, z1) {
  const F = G.frameOf([cx, cy, z0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const h = z1 - z0;
  disc(`${id}.seat`, F, 0, 1.4, 5, { tone: "mid" });
  turned(`${id}.damper`, F, [[1.4, 2.6], [11, 2.6]], { tone: "mid" }, { inner: Ln(G.arcOf(F, 6, 2.6, P), { tone: "faint" }) });
  turned(`${id}.rod`, F, [[11, 0.9], [h - 1.4, 0.9]], { tone: "hi" });
  disc(`${id}.mount`, F, h - 1.4, h, 5, { tone: "mid" }, { extra: Dots(G.dotsOf(F, h, 3.6, 3, P, { all: true }), { size: 0.45 }) });
  const coil = [];
  const turns = 5;
  const a0 = 1.4 + 0.5;
  const a1 = h - 1.4 - 0.5;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const a = t * turns * Math.PI * 2;
    coil.push([cx + 4.2 * Math.cos(a), cy + 4.2 * Math.sin(a), z0 + a0 + t * (a1 - a0)]);
  }
  const frontRuns = [];
  const backRuns = [];
  let run = [];
  let facing = null;
  for (const p of coil) {
    const f = G.dot3([p[0] - cx, p[1] - cy, 0], V) > 0;
    if (facing !== null && f !== facing) {
      run.push(p);
      (facing ? frontRuns : backRuns).push(run);
      run = [];
    }
    facing = f;
    run.push(p);
  }
  (facing ? frontRuns : backRuns).push(run);
  const d = (runs) => runs.filter((r) => r.length > 1).map((r) => path3(r)).join("");
  put(`${id}.coil.back`, [cx, cy, z0 + h / 2], Ln(d(backRuns), { tone: "lo", className: "rs-coil" }), backRuns.filter((r) => r.length > 1).map((r) => A.tube(r, 0.5, { name: `${id}.coil` })), { bias: -4 });
  put(`${id}.coil.front`, [cx, cy, z0 + h / 2], Ln(d(frontRuns), { tone: "hi", className: "rs-coil" }), frontRuns.filter((r) => r.length > 1).map((r) => A.tube(r, 0.5, { name: `${id}.coil` })), { bias: 4 });
}
const XU = TRACK - TYRE_W - 4.2 - 8; // the upright's inner face
for (const c of CORNERS) {
  const sx = c.sx;
  const front = c.y < 0;
  const X = (v) => sx * v;
  const xs = (a, b) => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
  const railTop = front ? 28 : 20;
  const low = front ? [20, 22] : [16, 18];
  const quad = (half) => [[X(38), c.y - half], [X(XU), c.y - 3], [X(XU), c.y + 3], [X(38), c.y + half]];
  plate(`${c.id}.lower`, quad(17), low[0], low[1], { tone: "lo" });
  plate(`${c.id}.upper`, quad(17), 50, 52, { tone: "mid" });
  const topZ = front ? 66 : 72;
  for (const [y0, y1] of [[c.y - 20, c.y - 10], [c.y + 10, c.y + 20]]) {
    const [x0, x1] = xs(30, 38);
    box(`${c.id}.post`, [x0, y0, railTop], [x1, y1, topZ], { tone: "lo" }, { r: 0.6 });
  }
  const [b0, b1] = xs(30, 52);
  box(`${c.id}.bridge`, [b0, c.y - 20, topZ], [b1, c.y + 20, topZ + 4], { tone: "mid" }, { r: 0.8, extra: Dots([at([X(34), c.y - 15, topZ + 4]), at([X(34), c.y + 15, topZ + 4])], { size: 0.45 }) });
  coilOver(c.id, X(47), c.y, 52, topZ);
  // half shaft from the drive unit to the upright, booted at both ends
  const x0 = front ? (sx > 0 ? 29 : -27) : (sx > 0 ? 27 : -27);
  const x1 = X(XU);
  const dir = [Math.sign(x1 - x0), 0, 0];
  const SF = G.frameAlong([x0, c.y, WZ], dir);
  const L = Math.abs(x1 - x0);
  for (const [s0, s1] of [[0, 6], [L - 6, L]]) {
    for (let i = 0; i < 4; i++) disc(`${c.id}.boot`, SF, s0 + (i * (s1 - s0)) / 4, s0 + ((i + 1) * (s1 - s0)) / 4, i % 2 ? 3.4 : 4.2, { tone: "lo" }, { steps: 20 });
  }
  disc(`${c.id}.shaft`, SF, 6, L - 6, 2.2, { tone: "mid" }, { steps: 16 });
  if (front) {
    const [a0, a1] = xs(XU, XU + 4);
    box(`${c.id}.arm`, [a0, -126, 28.5], [a1, -104, 32.5], { tone: "mid" }, { r: 0.6 });
    rod(`${c.id}.tierod`, [X(26), -106, 30.5], [X(XU), -106, 30.5], 1.2, { tone: "hi" });
  }
}
// steer-by-wire: a rack on the front cross member, driven by its own motor; nothing links it to the yoke
box("front.rack", [-26, -109, 28], [26, -103, 33], { tone: "mid" }, { r: 1, extra: Dots([at([-20, -106, 33]), at([20, -106, 33])], { size: 0.45 }) });
disc("front.rackmotor", G.frameOf([4, -106, 37.4], [1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 13, 4.4, { tone: "hi" }, { extra: "" });

// ===================================================================== drive units
function motor(name, x0, x1, y, r) {
  const F = G.frameOf([x0, y, WZ], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const L = x1 - x0;
  turned(name, F, [[0, r - 2], [1.6, r], [L - 1.6, r], [L, r - 2]], { tone: "hi" }, { extra: k.fadedSvg(G.ribsOf(F, 3, L - 3, r, 30, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
}
motor("front.motor", -24, 24, AXF, 12);
box("front.gearbox", [24, AXF - 12, 22], [29, AXF + 12, 46], { tone: "mid" }, { r: 2, steps: 3, extra: Dots(k.corners({ x: 24, y: AXF - 12, w: 5, d: 24 }, 1.6).map(([x, y]) => at([x, y, 46])), { size: 0.4 }) });
disc("front.endcap", G.frameOf([-24, AXF, WZ], [-1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 3, 9, { tone: "mid" });
box("front.inverter", [-14, AXF - 10, 46], [14, AXF + 10, 52], { tone: "hi" }, { r: 1.2, steps: 3, extra: Ln(k.planOutline({ x: -11, y: AXF - 7, w: 22, d: 14, r: 0.6 }, 52, P, 2), { tone: "faint" }) + Dots(k.corners({ x: -14, y: AXF - 10, w: 28, d: 20 }, 1.8).map(([x, y]) => at([x, y, 52])), { size: 0.4 }) });
box("front.cradle", [-30, AXF - 6, 20], [30, AXF + 6, 22], { tone: "lo" }, { r: 0.4 });
for (const [name, a, b, g0, g1] of [["rear.motorL", 4, 22, 22, 27], ["rear.motorR", -22, -4, -27, -22]]) {
  motor(name, a, b, AXR, 13);
  box(`${name}.gearbox`, [g0, AXR - 12, 21], [g1, AXR + 12, 47], { tone: "mid" }, { r: 2, steps: 3 });
  box(`${name}.inverter`, [a + 2, AXR - 9, 47], [b - 2, AXR + 9, 53], { tone: "hi" }, { r: 1.2, steps: 3, extra: Dots(k.corners({ x: a + 2, y: AXR - 9, w: b - a - 4, d: 18 }, 1.6).map(([x, y]) => at([x, y, 53])), { size: 0.4 }) });
}
box("rear.cradle", [-30, AXR - 6, 19], [30, AXR + 6, 21], { tone: "lo" }, { r: 0.4 });

// ===================================================================== battery: tray, lid, the near cells shown in front of the seat
const BAT = { x0: -78, x1: 78, y0: -90, y1: 58, z0: 11, z1: 24 };
box("battery.tray", [BAT.x0, BAT.y0, BAT.z0], [BAT.x1, BAT.y1, BAT.z0 + 2], { tone: "lo" }, { r: 1.2, steps: 3 });
for (const [y0, y1] of [[BAT.y0, BAT.y0 + 2], [BAT.y1 - 2, BAT.y1]]) box("battery.end", [BAT.x0, y0, BAT.z0 + 2], [BAT.x1, y1, BAT.z1], { tone: "mid" }, { r: 0.3 });
box("battery.side", [BAT.x1 - 2, BAT.y0 + 2, BAT.z0 + 2], [BAT.x1, BAT.y1 - 2, BAT.z1], { tone: "mid" }, { r: 0.3 });
box("battery.lid", [BAT.x0, BAT.y0 + 2, BAT.z1 - 1.4], [CUT, BAT.y1 - 2, BAT.z1], { tone: "mid" }, { r: 0.3 });
box("battery.lid.near", [CUT, -8, BAT.z1 - 1.4], [BAT.x1 - 2, BAT.y1 - 2, BAT.z1], { tone: "mid" }, { r: 0.3 });
{
  // modules: two rows of four in the open bay, each with its terminals and a busbar across them
  const z0 = BAT.z0 + 2;
  const z1 = BAT.z1 - 2.4;
  for (const [x0, x1] of [[CUT + 2, 43], [45, 74]]) {
    for (let i = 0; i < 4; i++) {
      const y0 = BAT.y0 + 3 + i * 20.25;
      const y1 = y0 + 19.25;
      const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.8 };
      box("battery.module", [x0, y0, z0], [x1, y1, z1], { tone: "mid" }, { r: 0.8, steps: 2, extra: Ln(k.planOutline(k.insetPlan(plan, 2), z1, P, 2), { tone: "faint" }) + Dots([at([x0 + 4, y0 + 4, z1]), at([x1 - 4, y1 - 4, z1])], { size: 0.6, tone: "hi" }) });
    }
    box("battery.busbar", [(x0 + x1) / 2 - 1.5, BAT.y0 + 4, z1], [(x0 + x1) / 2 + 1.5, -10, z1 + 0.6], { tone: "hi" }, { r: 0.2 });
  }
  box("battery.coolant", [74.6, BAT.y0 + 3, BAT.z0 + 2], [BAT.x1 - 2, -10, BAT.z0 + 8], { tone: "lo" }, { r: 0.4, extra: Dots([-80, -60, -40, -20].map((y) => at([76, y, BAT.z0 + 8])), { size: 0.45 }) });
}

// ===================================================================== tanks: carbon-overwrapped pressure vessels in every void
// Each tank is a lathe: elliptical domes, a polar boss at one end. Its volume comes from the same profile.
const TANKS = [];
const domeS0 = (r, rb = 3) => r * 0.62 * (1 - Math.sqrt(1 - (rb / r) ** 2));
// the length that puts the end of the boss exactly at `endAt` along the axis
const lenTo = (start, endAt, r) => endAt - 3 - start + domeS0(r);
function copv(name, o, axis, len, r, { valve = true } = {}) {
  const F = G.frameAlong(o, axis);
  const d = r * 0.62;
  const rb = 3;
  const s0 = d - d * Math.sqrt(1 - (rb / r) ** 2);
  const dome = (t) => r * Math.sqrt(Math.max(0, 1 - ((d - t) / d) ** 2));
  const knots = [[s0, rb]];
  const N = 10;
  for (let i = 1; i <= N; i++) {
    const t = s0 + (d - s0) * (i / N);
    knots.push([t, dome(t), 1]);
  }
  for (let i = N; i >= 1; i--) {
    const t = s0 + (d - s0) * (i / N);
    knots.push([len - t, dome(t), 1]);
  }
  knots.push([len - s0, rb]);
  // hoop windings on the barrel and the dome seams
  const hoops = [];
  for (let s = d + 8; s < len - d - 4; s += 9) hoops.push(G.arcOf(F, s, r, P));
  const seams = G.arcOf(F, d, r, P) + G.arcOf(F, len - d, r, P);
  turned(`${name}`, F, knots, { tone: "hi" }, { inner: Ln(hoops.join(""), { tone: "faint" }) + Ln(seams, { tone: "lo" }), attrs: ` data-tank="${name}"` });
  let volume = 0;
  for (let i = 1; i < knots.length; i++) {
    const [sa, ra] = knots[i - 1];
    const [sb, rbb] = knots[i];
    volume += (Math.PI * (sb - sa) * (ra * ra + ra * rbb + rbb * rbb)) / 3;
  }
  const tip = len - s0;
  disc(`${name}.boss`, F, tip, tip + 3, rb, { tone: "mid" }, { steps: 16, owner: name });
  const end = G.add3(o, G.mul3(axis, tip + 3));
  let valveBox = null;
  if (valve) {
    // a hand valve on the boss: a block with a lever
    const c = G.add3(end, G.mul3(axis, 3));
    const half = [Math.abs(axis[0]) > 0.5 ? 3 : 4, Math.abs(axis[1]) > 0.5 ? 3 : 4, 4];
    valveBox = { c, half };
    box(`${name}.valve`, [c[0] - half[0], c[1] - half[1], c[2] - half[2]], [c[0] + half[0], c[1] + half[1], c[2] + half[2]], { tone: "mid" }, { r: 0.8, steps: 2, owner: name, attrs: ` data-air="${name}"` });
    const lx = c[0] - half[0] * 0.6;
    box(`${name}.lever`, [lx - 0.6, c[1] + 1.2, c[2] + half[2]], [lx + 0.6, c[1] + 9, c[2] + half[2] + 1.2], { tone: "hi" }, { r: 0.2, owner: name });
  }
  TANKS.push({ name, volume: volume / 1000, end, valveBox, F, r, len });
  return { end, valveBox };
}
// behind the seat, the big one, on two cradles over the rear rails
const T1 = copv("tank.behind", [-72, 87, 51], [1, 0, 0], 144, 24);
for (const sx of [1, -1]) box("tank.behind.cradle", [sx > 0 ? 30 : -38, 79, 20], [sx > 0 ? 38 : -30, 95, 27], { tone: "lo" }, { r: 0.6 });
// it rides on its cradles; the hub's plate is strapped to its top
// over the rear axle, under the deck: two more, the front one on posts on the valve block
const T8 = copv("tank.trunk", [-70, 168, 72], [1, 0, 0], 140, 13);
const T9 = copv("tank.tail", [-70, 198, 74], [1, 0, 0], 140, 10);
for (const x of [-50, 44]) box("tank.tail.post", [x, 194, 43], [x + 6, 202, 64], { tone: "lo" }, { r: 0.4 });
// the passenger's place: the Rocket seats one, so two tanks fill the other seat's space,
// and a third fills the tunnel under the console
const T4 = copv("tank.seatA", [-28.5, -64, 42], [0, 1, 0], lenTo(-64, 54, 16), 16, { valve: false });
const T5 = copv("tank.seatB", [-61, -64, 42], [0, 1, 0], lenTo(-64, 54, 16), 16, { valve: false });
const T6 = copv("tank.tunnel", [0, -88, 36], [0, 1, 0], lenTo(-88, 54, 10), 10, { valve: false });
// the cabin block their bosses plug into, against the bulkhead, with a hand valve for each
box("air.cabinblock", [-78, 54, 26], [12, TUB.y1, 46], { tone: "mid" }, { r: 1, steps: 3, attrs: ' data-air="cabin"', extra: Dots([-61, -28.5, 0].map((x) => at([x, 57, 46])), { size: 0.9, tone: "hi" }) });

// ===================================================================== the air hub on the big tank: collector, shut-off, regulator, distribution
const HUB_Z = 75; // top of the big tank
// three pads strapped to its top: under the distribution, the regulator and shut-off, and the collector
for (const [x0, x1] of [[10, 30], [36, 50], [56, 66]]) box("air.pad", [x0, 83, HUB_Z], [x1, 91, HUB_Z + 2], { tone: "lo" }, { r: 0.6 });
const HZ = HUB_Z + 2; // hub components stand here
box("air.collector", [54, 79, HZ], [68, 93, HZ + 10], { tone: "hi" }, { r: 1, steps: 3, bevel: 0.3, attrs: ' data-air="hub"', extra: Dots([at([56, 81, HZ + 10]), at([66, 91, HZ + 10])], { size: 0.45 }) });
turned("air.relief", UPF([57, 86, HZ + 10]), [[0, 1.6], [4, 1.6], [4.2, 2.2], [6, 2.2]], { tone: "mid" });
const SHUT = G.frameOf([46, 86, HZ + 5], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
turned("air.shutoff", SHUT, [[0, 3.6], [1, 4.4], [7, 4.4], [8, 3.6]], { tone: "hi" }, { attrs: ' data-air="hub"' });
cyl("air.shutoff.stem", 50, 86, 1.1, HZ + 9.4, 2.2, { tone: "mid" }, { steps: 12 });
const LEVER = { a: [50, 86, HZ + 11.6], b: [50, 76, HZ + 12.4] };
box("air.shutoff.lever", [49.2, 76, HZ + 11.6], [50.8, 87, HZ + 12.8], { tone: "hi" }, { r: 0.3, attrs: ' data-air="lever"' });
const REG = G.frameOf([32, 86, HZ + 5], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
turned("air.regulator", REG, [[0, 4.2], [1.4, 5], [12.6, 5], [14, 4.2]], { tone: "hi" }, { attrs: ' data-air="hub"' });
turned("air.regulator.dome", UPF([39, 86, HZ + 10]), [[0, 4.6], [5, 4.6, 1], [7, 3.6, 1], [8.4, 1.4]], { tone: "mid" }, { smooth: null, attrs: ' data-air="hub"' });
cyl("air.regulator.knob", 39, 86, 1.6, HZ + 18.4, 3, { tone: "hi" }, { steps: 16, inner: Ln(k.knurl(39, 86, 1.6, HZ + 18.8, HZ + 21, 14, P, 0.3), { tone: "lo" }) });
box("air.distribution", [8, 80, HZ], [32, 92, HZ + 12], { tone: "hi" }, { r: 1, steps: 3, bevel: 0.3, attrs: ' data-air="hub"' });
// the gauge on the distribution: a dial whose needle reads the feed pressure
const GAUGE = { x: 20, y: 86, z: HZ + 14.2, r: 4.2 };
{
  const t = k.radialTicks(GAUGE.x, GAUGE.y, GAUGE.r - 0.6, 20, 5, GAUGE.z, [0.8, 1.6], P);
  cyl("air.gauge", GAUGE.x, GAUGE.y, GAUGE.r, HZ + 12, 2.2, { tone: "mid" }, { steps: 32, extra: Ln(t.minor, { tone: "lo" }) + Ln(t.major, { tone: "mid" }) + `<g data-gauge=""><path class="rs-needle" d=""/></g>` + Dots([at([GAUGE.x, GAUGE.y, GAUGE.z])], { size: 0.7, tone: "hi" }) });
}

// ===================================================================== valve blocks, valves and nozzles
// rear: one block behind the motors carries the six rear valves; the four main nozzles bolt to its back
box("air.rearblock", [-66, 160, 20], [66, 174, 36], { tone: "mid" }, { r: 1.4, steps: 3, bevel: 0.4, attrs: ' data-air="rear"' });
for (const x of [-44, 44]) box("tank.trunk.post", [x - 3, 162, 36], [x + 3, 172, 59], { tone: "lo" }, { r: 0.4 });
const VALVES = {};
function coil(id, x, y, z) {
  cyl(`valve.${id}`, x, y, 2.8, z, id[0] === "f" ? 5.6 : 7, { tone: "hi" }, { steps: 20, attrs: ` data-valve="${id}"`, extra: Dots([at([x, y, z + (id[0] === "f" ? 5.6 : 7)])], { size: 1.1, tone: "hi" }).replace('class="iso-dots"', `class="iso-dots rs-led" data-led="${id}"`) });
  VALVES[id] = [x, y, z];
}
const MAIN_X = [-56, -18, 18, 56];
MAIN_X.forEach((x, i) => coil(`main${i}`, x, 167, 36));
coil("rL", 37, 167, 36);
coil("rR", -37, 167, 36);
// main nozzles: a flange on the block's back face, a bell out to the exit at y 206
const MAIN_BELL = [[0, 4.4], [4, 3.8, 1], [12, 4.4, 1], [20, 5.2, 1], [30, 6]];
MAIN_X.forEach((x, i) => {
  const F = G.frameOf([x, 174, 27], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  disc(`nozzle.main${i}.flange`, F, 0, 2, 7.6, { tone: "mid" }, { extra: Dots(G.dotsOf(F, 2, 6.2, 8, P, { all: true }), { size: 0.45 }) });
  const exit = G.add3(F.o, G.mul3(F.a, 32));
  turned(`nozzle.main${i}`, G.frameOf([x, 176, 27], [0, 1, 0], [1, 0, 0], [0, 0, 1]), MAIN_BELL, { tone: "hi" }, { attrs: ` data-nozzle="main${i}"`, extra: `<path class="rs-throat" d="${G.circleOf(G.frameOf(exit, [0, 1, 0], [1, 0, 0], [0, 0, 1]), 0, 5.2, P, 40)}"/>` + Dots([at(exit)], { size: 1.2, tone: "lo" }) });
});
// the diffuser over them: a plate, five strakes, and a door in each channel that swings up to clear the jet
// its near half is cut away like the deck, to show the near bells; a rail along its back edge carries the near doors' hinges
PIECE = "diffuser";
box("body.diffuser", [KEEP[0], 180, 40], [KEEP[1], 214, 43], { tone: "mid" }, { r: 0.6 });
box("body.diffuser.rail", NEAR > 0 ? [CUT, 210, 40] : [-IN, 210, 40], NEAR > 0 ? [IN, 214, 43] : [-CUT, 214, 43], { tone: "mid" }, { r: 0.6 });
for (const x of [-76, -36, 0]) box("body.strake", [NEAR * x - 1.2, 182, SILL_Z], [NEAR * x + 1.2, 214, 40], { tone: "mid" }, { r: 0.3 });
const DOORS = [];
MAIN_X.forEach((x, i) => {
  const [x0, x1] = x < -36 ? [-74.8, -37.2] : x < 0 ? [-34.8, -1.2] : x < 36 ? [1.2, 34.8] : [37.2, 74.8];
  const pose = (deg) => {
    const a = (deg * Math.PI) / 180;
    const hinge = [214.6, 40];
    return [[-0.6, 0], [0.6, 0], [0.6, -26], [-0.6, -26]].map(([dy, dz]) => [hinge[0] + dy * Math.cos(a) - dz * Math.sin(a), hinge[1] + dy * Math.sin(a) + dz * Math.cos(a)]);
  };
  const poses = [0, 22, 44, 66, 88].map((deg) => `<g class="rs-door-pose" data-a="${deg}"${deg ? "" : " data-show"}>${S(prismPaths(XF, pose(deg), x0, x1), { tone: "mid" })}</g>`).join("");
  const shape = record(A.prism(XF, pose(0), x0, x1, { name: `door.main${i}` }));
  put(`door.main${i}`, [(x0 + x1) / 2, 214.6, 27], poses, [shape], { attrs: ` data-door="main${i}"` });
  DOORS.push(`main${i}`);
});
PIECE = "car";
// front: a two-valve block on its own cross member between the front rails, behind the bumper beam
box("front.crossF", [-30, -190, 20], [30, -174, 24], { tone: "lo" }, { r: 0.6, extra: Dots([-26, 26].flatMap((x) => [at([x, -188, 24]), at([x, -176, 24])]), { size: 0.45 }) });
box("air.frontblock", [-23, -186, 24], [23, -178, 36], { tone: "mid" }, { r: 1, steps: 3, attrs: ' data-air="front"' });
coil("fL", 12, -182, 36);
coil("fR", -12, -182, 36);
// corner nozzles: short bells canted down, outward, and fore or aft
const CORNER = {};
for (const n of NOZZLES.filter((n) => n.kind === "corner")) {
  const sx = Math.sign(n.pos[0]);
  const fy = Math.sign(n.pos[1]);
  const N0 = [sx * 84, fy < 0 ? -183 : 188, 30];
  const out = n.out;
  const F = G.frameAlong(N0, out);
  turned(`nozzle.${n.id}`, F, [[0, 3.6], [1.6, 3.6], [1.8, 2.4], [6, 2.2, 1], [9, 2.6, 1], [11, 3]], { tone: "hi" }, { attrs: ` data-nozzle="${n.id}"` });
  CORNER[n.id] = { N0, out, exit: G.add3(N0, G.mul3(out, 11)) };
}
// lift nozzles: straight down through the open sill bottom, the valve on the sill top above
const LIFT = {};
for (const sx of [1, -1]) {
  const id = sx > 0 ? "liftL" : "liftR";
  const x = sx * 89;
  const F = G.frameOf([x, 12, 40], [0, 0, -1], [1, 0, 0], [0, 1, 0]);
  disc(`nozzle.${id}.flange`, F, 0, 2.2, 6, { tone: "mid" }, { extra: "" });
  turned(`nozzle.${id}`, F, [[2.2, 3.6], [8, 3.2, 1], [16, 4.2, 1], [24, 5.6]], { tone: "hi" }, { attrs: ` data-nozzle="${id}"` });
  box(`valve.${id}.body`, [x - 5, 6, 42], [x + 5, 18, 49], { tone: "mid" }, { r: 0.8, steps: 2 });
  coil(id, x, 12, 49);
  LIFT[id] = { exit: [x, 12, 16] };
}

// ===================================================================== the lines: braided hoses with a nut at each end
// supply: each tank group into the collector; distribution: out to the valve blocks and the lifts
const AIR = {};
const hose = (id, control, opts = {}) => {
  AIR[id] = line(`air.${id}`, control, 1.1, { tone: "hi", braid: true, ...opts });
};
const v1 = T1.valveBox.c;
hose("t1", [[v1[0], v1[1] - 2, v1[2] + 4], [v1[0], v1[1] - 2, HZ + 6], [68, v1[1] - 2, HZ + 6]]);
const v8 = T8.valveBox.c;
// the trunk tank's valve is the rear manifold: the tail tank joins it from behind, its line leaves forward
hose("t8", [[v8[0], v8[1] - 4, v8[2]], [v8[0], 130, v8[2]], [v8[0], 122, HZ + 3], [v8[0], 106, HZ + 3], [57, 106, HZ + 3], [57, 93, HZ + 3]]);
const v9 = T9.valveBox.c;
const JX = (v9[0] + v8[0]) / 2;
hose("t9", [[JX, v9[1] - 4, v8[2] + 1], [JX, v8[1] + 4, v8[2] + 1]]);
hose("cabin", [[-30, 57, 46], [-30, 57, HZ + 2], [-30, 70, HZ + 2], [61, 70, HZ + 2], [61, 79, HZ + 2]]);
// the rear line turns across the car before it drops, so neither bend lies edge-on to any of the four cameras
hose("rear", [[20, 92, HZ + 7], [20, 146, HZ + 7], [0, 146, HZ + 7], [0, 150, 52], [0, 151, 28], [0, 160, 28]]);
hose("front", [[14, 80, HZ + 7], [14, 54, HZ + 7], [14, 46, 80], [14, -94, 80], [14, -104, 60], [14, -160, 60], [14, -166, 30], [14, -178, 30]]);
hose("liftL", [[26, 80, HZ + 6], [26, 56, HZ + 6], [72, 56, HZ + 6], [72, 56, 45.5], [72, 12, 45.5], [84, 12, 45.5]]);
hose("liftR", [[8, 83, HZ + 4.5], [-50, 83, HZ + 4.5], [-50, 56, HZ + 4.5], [-89, 56, HZ + 4.5], [-89, 56, 46], [-89, 30, 46], [-89, 18, 46]]);
for (const n of NOZZLES.filter((n) => n.kind === "corner")) {
  const c = CORNER[n.id];
  const sx = Math.sign(n.pos[0]);
  const fy = Math.sign(n.pos[1]);
  const approach = G.add3(c.N0, G.mul3(c.out, -6));
  if (fy < 0) hose(n.id, [[sx * 23, -182, 32], [sx * 62, -182, 32], approach, c.N0]);
  else hose(n.id, [[sx * 66, 170, 28], [sx * 74, 170, 28], approach, c.N0]);
}
// the fill line from the port in the tail to the collector
// the tail's outer face at the port's height, and the nipple the cart's coupling clamps onto
const tailOut = (z) => 215 + ((z - 44) / 41) * 1;
const PORT_Z = 58; // low on the tail, below the taillight
const FILL = [78, TAIL_IN - 0.05, PORT_Z];
hose("fill", [FILL, [78, 206, PORT_Z], [92, 196, 72], [92, 98, 72], [88, 90, HZ + 3], [68, 90, HZ + 3]], { free: [true, false] });
const NIPPLE = G.frameOf([78, tailOut(PORT_Z), PORT_Z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
PIECE = "body";
turned("air.fillport", NIPPLE, [[0, 3.6], [0.8, 3.6], [1, 2.2], [3.6, 2.2], [3.8, 3.3], [4.6, 3.3]], { tone: "hi" }, { owner: "body.tail", attrs: ' data-air="fill"' });
PIECE = "car";
const PORT_END = G.add3(NIPPLE.o, [0, 4.6, 0]);

// ===================================================================== cabin: one fixed seat, the yoke, the console with the mode switch
// the seat: a carbon shell with bolsters and a four-point harness
PIECE = "cabin";
const SEAT = { x0: 24, x1: 60 };
profile("seat.pan", [[-6, 34], [34, 34], [35.05, 39], [-4, 41]], SEAT.x0 + 3, SEAT.x1 - 3, { tone: "hi" });
profile("seat.back", [[34, 34], [42, 34], [55, 94], [47, 96]], SEAT.x0 + 3, SEAT.x1 - 3, { tone: "hi" });
for (const [x0, x1] of [[SEAT.x0, SEAT.x0 + 3], [SEAT.x1 - 3, SEAT.x1]]) profile("seat.bolster", [[-6, 34], [42, 34], [56, 95], [47, 97], [32, 46], [-4, 45]], x0, x1, { tone: "mid" });
box("seat.base", [SEAT.x0 + 2, -4, 26], [SEAT.x1 - 2, 38, 34], { tone: "lo" }, { r: 1, steps: 2 });
for (const [x0, x1] of [[33, 37], [47, 51]]) profile("seat.strap", shell([[46.16, 92], [35.68, 42]], 0.6), x0, x1, { tone: "lo" });
profile("seat.lap", [[0, 40.8], [4, 40.6], [4, 41.4], [0, 41.6]], SEAT.x0 + 3, SEAT.x1 - 3, { tone: "lo" });
box("seat.buckle", [40, 0.6, 41.5], [44, 3.6, 42.9], { tone: "hi" }, { r: 0.3 });
// the console over the tunnel tank, with the guarded mode switch on top
box("console.cheek", [-12, -40, 26], [-10, 44, 46], { tone: "mid" }, { r: 0.3 });
box("console.top", [-12, -40, 46], [12, 44, 48], { tone: "mid" }, { r: 0.6 });
const SW = { x: 0, y: -28, z: 48 };
box("switch.plate", [-6, SW.y - 8, 48], [6, SW.y + 8, 49.6], { tone: "lo" }, { r: 0.8, extra: Ln([-4, 0, 4].map((dy) => k.lineOnTop([6, SW.y + dy], [2.6, SW.y + dy], 49.6, P)).join(""), { tone: "mid" }) });
const SWITCH_POSES = [-32, -16, 0, 16, 32];
{
  const leverAt = (deg) => {
    const a = (deg * Math.PI) / 180;
    const p0 = [SW.x, SW.y, 49.6];
    const p1 = [SW.x, SW.y + Math.sin(a) * 5, 49.6 + Math.cos(a) * 5];
    return { p0, p1 };
  };
  const poses = SWITCH_POSES.map((deg) => {
    const { p0, p1 } = leverAt(deg);
    const F = G.frameAlong(p0, G.unit3(G.sub3(p1, p0)));
    return `<g class="rs-lever-pose" data-a="${deg}"${deg === 32 ? " data-show" : ""}>${S(G.disc(0, 3.79, 0.7, F, P), { tone: "hi" })}${S(G.sphereOf(p1, 1.4, P, { steps: 16 }), { tone: "hi" })}</g>`;
  }).join("");
  const { p0, p1 } = leverAt(32);
  put("switch.lever", [SW.x, SW.y, 53], poses, [record(A.disc(G.frameAlong(p0, G.unit3(G.sub3(p1, p0))), 0, 3.79, 0.7, { name: "switch.lever" })), record(A.ball(p1, 1.4, { name: "switch.lever" }))], { attrs: ' data-switch=""' });
}
// the guard: a flip cover hinged at the back of the plate
const GUARD_POSES = [0, 30, 60, 90, 120];
{
  const pose = (deg) => {
    const a = (deg * Math.PI) / 180;
    const hinge = [SW.y + 8, 58];
    return [[0, 0], [-16, 0], [-16, -1.2], [0, -1.2]].map(([dy, dz]) => [hinge[0] + dy * Math.cos(a) - dz * Math.sin(a), hinge[1] + dy * Math.sin(a) + dz * Math.cos(a)]);
  };
  for (const x of [-7, 5.6]) box("switch.guardcheek", [x, SW.y + 6, 49.6], [x + 1.4, SW.y + 9, 56.8], { tone: "lo" }, { r: 0.3 });
  const poses = GUARD_POSES.map((deg) => `<g class="rs-guard-pose" data-a="${deg}"${deg ? "" : " data-show"}>${S(prismPaths(XF, pose(deg), -7, 7), { tone: "mid" })}</g>`).join("");
  const shape = record(A.prism(XF, pose(0), -7, 7, { name: "switch.guard" }));
  put("switch.guard", [0, SW.y, 57.4], poses, [shape], { attrs: ' data-guard=""' });
}
// dash, centre screen, two driver displays, the yoke on a short column (steer-by-wire)
PIECE = "car";
profile("dash", [[-92, 56], [-60, 62], [-58, 70], [-66, 76], [-92, 74]], -78, 78, { tone: "mid" });
profile("dash.screen", [[-59.7, 63.2], [-58.1, 69.4], [-57.3, 69.2], [-58.9, 63]], -15, 15, { tone: "lo" }, { attrs: ' data-screen=""' });
for (const [x0, x1] of [[31, 39], [45, 53]]) profile("dash.display", [[-70, 75.4], [-67, 75.6], [-65.4, 80.4], [-68.4, 80.8]], x0, x1, { tone: "lo" }, { attrs: ' data-screen=""' });
rod("yoke.column", [42, -58.9, 66], [42, -54, 66], 1.6, { tone: "mid" });
PIECE = "cabin";
section("yoke", [[23, 60], [61, 60], [61, 74], [57, 74], [57, 64.4], [27, 64.4], [27, 74], [23, 74]], -52, -49.6, { tone: "hi" });
box("yoke.hub", [37, -54, 61], [47, -52, 68], { tone: "mid" }, { r: 1, steps: 2 });
PIECE = "car";
for (const x of [34, 48]) box("pedal", [x, -88, 30], [x + 6, -87, 44], { tone: "mid" }, { r: 0.6 });
for (const x of [36, 50]) rod("pedal.arm", [x + 1, -92, 42], [x + 1, -88, 42], 0.8, { tone: "lo" });

// ===================================================================== the left side panel, lifted off and floating above the car
PIECE = "panel";
{
  const sx = NEAR * (HALF_W + 0.05);
  const shut = [-58, 42].map((y) => path3([[sx, y, SILL_Z + 0.4], [sx, y, topAt(y) - 0.3]])).join("");
  const vent = path3([[sx, 70, 62], [sx, 92, 62], [sx, 92, 66], [sx, 70, 66]], true) + path3([[sx, 73, 63.4], [sx, 89, 63.4], [sx, 89, 64.6], [sx, 73, 64.6]], true);
  profile("panel.skin", SIDE, NEAR > 0 ? IN : -HALF_W, NEAR > 0 ? HALF_W : -IN, { tone: "hi" }, { extra: Ln(shut, { tone: "lo" }) + Ln(vent, { tone: "faint" }) + Dots([at([sx, -20, 30]), at([sx, 20, 30])], { size: 0.5, tone: "mid" }) });
  const out = (a, b) => (NEAR > 0 ? [a, b] : [-b, -a]); // an x span outside the near skin
  const [h0, h1] = out(HALF_W, HALF_W + 0.6);
  const [c0, c1] = out(HALF_W, HALF_W + 4.5);
  box("panel.handle", [h0, 18, 74], [h1, 30, 76.4], { tone: "mid" }, { r: 0.2 });
  box("panel.camera", [c0, -54, 84], [c1, -48, 86.5], { tone: "hi" }, { r: 0.6, steps: 2 });
  for (const cy of [AXF, AXR]) {
    const ring = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      ring.push([cy + (ARCH_R + 3.5) * Math.cos(a), WZ + (ARCH_R + 3.5) * Math.sin(a) * 0.98]);
    }
    for (let i = 14; i >= 0; i--) {
      const a = (i / 14) * Math.PI;
      ring.push([cy + ARCH_R * Math.cos(a), WZ + ARCH_R * Math.sin(a) * 0.98]);
    }
    const [t0, t1] = out(HALF_W, HALF_W + 0.9);
    profile("panel.archtrim", ring, t0, t1, { tone: "lo" }, { attrs: ' data-trim=""' });
  }
}
PIECE = "body";
// the full-length taillight on the tail's outer face, and the hidden headlamp slits in the nose
profile("body.taillight", [[tailOut(77), 77], [tailOut(80), 80], [tailOut(80) + 1.2, 80], [tailOut(77) + 1.2, 77]], -IN + 6, IN - 6, { tone: "hi" }, { attrs: ' data-lamp="tail"' });
for (const s of [-1, 1]) {
  const ny = (z) => -219 + ((z - 24) / 18) * 10;
  profile("body.headlamp", [[ny(38), 38], [ny(41), 41], [ny(41) - 0.87, 41.49], [ny(38) - 0.87, 38.49]], s > 0 ? 44 : -88, s > 0 ? 88 : -44, { tone: "lo" });
}
// targa rests on two pads on the trunk tank
for (const x of [-40, 2]) box("body.targa.pad", [x, 164, 85], [x + 6, 172, 89.6], { tone: "lo" }, { r: 0.4 });
PIECE = "car";

// ===================================================================== in front of the car: the deflector, the near chocks, the fill cart and its hose
LAYER = "front";
PIECE = "pad";
for (const y of [AXF, AXR]) chock("stand.chock", NEAR * 126, y + 30);
// the deflector, the cart and its hose stand behind the car: in front of it only when the camera is behind it
LAYER = REAR ? "front" : "back";
// the blast deflector: a sloped steel plate on three ribs, bolted down behind the tail
profile("stand.deflector", [[282, 0], [285.6, 0], [316, 52], [312.4, 53.6]], -112, 112, { tone: "hi" }, { extra: "" });
for (const x of [-100, 0, 100]) profile("stand.deflector.rib", [[285.6, 0], [316, 0], [316, 52]], x - 1, x + 1, { tone: "mid" });
box("stand.deflector.foot", [-112, 316, 0], [112, 322, 4], { tone: "lo" }, { r: 0.6, extra: Dots([-90, -30, 30, 90].map((x) => at([x, 319, 4])), { size: 0.5 }) });
// the fill cart: a frame on casters, two storage bottles, a booster compressor, a hose reel and a gauge
const CART = { x0: 170, x1: 236, y0: 238, y1: 316 };
box("cart.frame", [CART.x0, CART.y0, 14], [CART.x1, CART.y1, 18], { tone: "lo" }, { r: 1, steps: 3, extra: Dots(k.corners({ x: CART.x0, y: CART.y0, w: 66, d: 78 }, 2.4).map(([x, y]) => at([x, y, 18])), { size: 0.45 }) });
for (const [x, y] of [[176, 244], [230, 244], [176, 310], [230, 310]]) {
  disc("cart.caster", G.frameOf([x - 2, y, 6], [1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 4, 6, { tone: "lo" }, { steps: 20 });
  box("cart.fork", [x - 3, y - 3, 12], [x + 3, y + 3, 14], { tone: "mid" }, { r: 0.4 });
}
for (const x of [184, 202]) {
  const F = G.frameOf([x, 241, 26.5], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  turned("cart.bottle", F, [[0, 3], [1.2, 6, 1], [3.4, 8.5, 1], [6, 8.5], [66, 8.5], [68.6, 8.5, 1], [70.8, 6, 1], [72, 3]], { tone: "hi" }, { inner: Ln([20, 46].map((s) => G.arcOf(F, s, 8.5, P)).join(""), { tone: "faint" }) });
}
box("cart.compressor", [214, 240, 18], [236, 286, 46], { tone: "mid" }, {
  r: 1.4,
  steps: 3,
  bevel: 0.4,
  inner: "",
  extra: Ln([0, 1, 2, 3, 4, 5].map((i) => path3([[236.05, 244 + i * 5, 24], [236.05, 247 + i * 5, 24], [236.05, 247 + i * 5, 40], [236.05, 244 + i * 5, 40]], true)).join(""), { tone: "lo" }),
});
{
  // the cart's gauge on its near face: the storage bank's pressure, in a short round case
  const m = planeMatrix([237.25, 272, 40], [0, 1, 0], [0, 0, -1]);
  const dial = `<g transform="${m}"><circle class="rs-dial" cx="6" cy="6" r="5.4"/>${Array.from({ length: 11 }, (_, i) => {
    const a = -2.4 + (i / 10) * 4.8;
    const r0 = i % 5 === 0 ? 3.6 : 4.3;
    return `<path class="rs-tick" d="M${(6 + Math.sin(a) * r0).toFixed(2)} ${(6 - Math.cos(a) * r0).toFixed(2)}L${(6 + Math.sin(a) * 5.4).toFixed(2)} ${(6 - Math.cos(a) * 5.4).toFixed(2)}"/>`;
  }).join("")}<path class="rs-needle" data-cartneedle="" d="M6 6L6 1.4"/><circle class="rs-hub" cx="6" cy="6" r=".7"/></g>`;
  disc("cart.gauge", G.frameOf([236, 278, 34], [1, 0, 0], [0, 1, 0], [0, 0, 1]), 0, 1.2, 6, { tone: "mid" }, { steps: 32, extra: dial });
}
for (const x of [216, 232]) box("cart.cheek", [x, 252, 46], [x + 2, 268, 62], { tone: "lo" }, { r: 0.4 });
{
  const RF = G.frameOf([218, 260, 59], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  disc("cart.reel.flange", RF, 0, 1.2, 12, { tone: "mid" }, { steps: 40 });
  disc("cart.reel.flange", RF, 12.8, 14, 12, { tone: "mid" }, { steps: 40 });
  disc("cart.reel", RF, 1.2, 12.8, 8.6, { tone: "hi" }, { steps: 40, extra: k.fadedSvg(G.ribsOf(RF, 1.8, 12.2, 8.6, 9, P, { fade: [0.1, 0.5], seams: true }), { tone: "lo" }) });
}
for (const x of [174, 232]) rod("cart.handle", [x, 316, 18], [x, 322, 70.8], 1, { tone: "mid" });
rod("cart.handle.bar", [173, 322, 72], [233, 322, 72], 1.2, { tone: "hi" });
// the hose: off the reel, down to the pad, across to the tail and up into the fill port
box("cart.fairlead", [220, 240, 46], [230, 247, 53], { tone: "mid" }, { r: 0.8, steps: 2 });
const HOSE = line("hose", [[225, 240, 49.5], [225, 224, 49.5], [223, 223, 9], [200, 231, 2.8], [140, 236, 2.8], [114, 238, 2.8], [106, 238, 16], [106, 238, 48], [96, 238, PORT_Z], [78, 238, PORT_Z], PORT_END], 1.8, { tone: "mid", limp: true, touch: ["stand.pad"], bend: 12, shells: [false, true], free: [false, true], attrs: ' data-hose=""' });
LAYER = "car";
PIECE = "car";

// ===================================================================== the proxy car for the turning view
// While the car turns in the air the page draws this mesh live in place of the drawing: the closed body,
// the open cabin with its seat, console, yoke, dash and the tanks in the passenger's place, the wheels,
// the open nozzle doors and the ten nozzles. It is built from the drawing's own profiles, so at the
// drawing's heading it lines up with it.
const MESH = (() => {
  const M = meshMaker();
  M.profile("skin", SIDE, IN, HALF_W, "hi");
  M.profile("skin", SIDE, -HALF_W, -IN, "hi");
  M.profile("hood", HOOD, -IN, IN, "hi");
  M.profile("nose", NOSE, -IN, IN, "hi");
  M.profile("deck", DECK, -IN, IN, "hi");
  M.profile("tail", TAIL, -IN, IN, "hi");
  M.profile("lamp", [[tailOut(77), 77], [tailOut(80), 80], [tailOut(80) + 1.2, 80], [tailOut(77) + 1.2, 77]], -IN + 6, IN - 6, "hi");
  for (const s of [-1, 1]) M.profile("pillar", screenStrip(2.6), s > 0 ? 80 : -86, s > 0 ? 86 : -80, "hi");
  M.profile("header", [[-6, 107.5], [-5, 105.1], [0, 105.1], [0, 109.8], [-6, 109.8]], -86, 86, "hi");
  M.profile("glass", screenStrip(0.8), -80, 80, "glass");
  M.section("hoop", HOOP_BAR, HOOP.y0, HOOP.y1, "hi");
  for (const s of [1, -1]) M.section("hoop", hoopFoot(s), HOOP.y0, HOOP.y1, "hi");
  M.box("floor", [-78, TUB.y0, 24], [78, TUB.y1, 26], "mid");
  for (const sx of [1, -1]) M.box("sill", sx > 0 ? [78, -88, SILL_Z] : [-IN, -88, SILL_Z], sx > 0 ? [IN, 88, 42] : [-78, 88, 42], "mid");
  M.box("bulkhead", [-78, -95, 26], [78, -92, 72], "mid");
  M.box("bulkhead", [-78, TUB.y1, 26], [78, TUB.y1 + 3, 70], "mid");
  M.profile("dash", [[-92, 56], [-60, 62], [-58, 70], [-66, 76], [-92, 74]], -78, 78, "mid");
  M.profile("seat", [[-6, 34], [34, 34], [35.05, 39], [-4, 41]], SEAT.x0 + 3, SEAT.x1 - 3, "hi");
  M.profile("seat", [[34, 34], [42, 34], [55, 94], [47, 96]], SEAT.x0 + 3, SEAT.x1 - 3, "hi");
  for (const [x0, x1] of [[SEAT.x0, SEAT.x0 + 3], [SEAT.x1 - 3, SEAT.x1]]) M.profile("bolster", [[-6, 34], [42, 34], [56, 95], [47, 97], [32, 46], [-4, 45]], x0, x1, "mid");
  M.box("console", [-12, -40, 26], [12, 44, 48], "mid");
  M.section("yoke", [[23, 60], [61, 60], [61, 74], [57, 74], [57, 64.4], [27, 64.4], [27, 74], [23, 74]], -52, -49.6, "hi");
  for (const x of [-28.5, -61]) M.round("tank", [x, -64, 42], [0, 1, 0], 0, lenTo(-64, 54, 16), 16, 16, 22, "hi");
  // wheels, hanging: tyre, rim face and its spokes, hub
  for (const c of CORNERS) {
    const inner = c.sx * (TRACK - TYRE_W);
    const outer = c.sx * (TRACK + TYRE_W);
    M.round("tyre", [inner, c.y, WZ], [c.sx, 0, 0], 0, TYRE_W * 2, TYRE_R, TYRE_R, 32, "hi");
    M.round("rim", [outer, c.y, WZ], [c.sx, 0, 0], 0, 0.5, RIM_R, RIM_R, 32, "mid");
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      M.round("spoke", [outer + c.sx * 0.5, c.y, WZ], [0, Math.cos(a), Math.sin(a)], 6, RIM_R - 1.5, 1.1, 0.8, 6, "mid");
    }
    M.round("hub", [outer + c.sx * 0.5, c.y, WZ], [c.sx, 0, 0], 0, 1.4, 6.2, 5.6, 16, "hi");
  }
  // the diffuser with its strakes and, open as in flight, the four doors
  M.box("diffuser", [-IN, 180, 40], [IN, 214, 43], "mid");
  for (const x of [-76, -36, 0, 36, 76]) M.box("strake", [x - 1.2, 182, SILL_Z], [x + 1.2, 214, 40], "mid");
  const doorAt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [[-0.6, 0], [0.6, 0], [0.6, -26], [-0.6, -26]].map(([dy, dz]) => [214.6 + dy * Math.cos(a) - dz * Math.sin(a), 40 + dy * Math.sin(a) + dz * Math.cos(a)]);
  };
  for (const [x0, x1] of [[-74.8, -37.2], [-34.8, -1.2], [1.2, 34.8], [37.2, 74.8]]) M.profile("door", doorAt(88), x0, x1, "mid");
  // the nozzles: the rear four bells, the two lifts down through the sills, the four corners
  for (const x of MAIN_X) M.round("bell", [x, 176, 27], [0, 1, 0], 0, 30, 4.4, 6, 18, "hi");
  for (const id of ["liftL", "liftR"]) M.round("bell", [LIFT[id].exit[0], 12, 40], [0, 0, -1], 2.2, 24, 3.6, 5.6, 18, "hi");
  for (const id of Object.keys(CORNER)) M.round("bell", CORNER[id].N0, CORNER[id].out, 0, 11, 3.6, 3, 14, "hi");
  return M.finish();
})();

// ===================================================================== order and output
A.settle(R, P);
// the paint lies 0.06 on the pad's top, inside the depth tolerance, so nothing orders it against the pad:
// it goes straight after the pad, under everything that stands on it
{
  const pad = R.items.find((i) => i.name === "stand.pad");
  for (const item of R.items) if (item.name === "stand.paint") item.key = pad.key + 0.01;
}
R.items.sort((a, b) => a.key - b.key);
// the three layers must agree with true depth wherever two items overlap across them
const RANK = { back: 0, car: 1, front: 2 };
const crossing = [];
for (const pair of R.settled.overlaps.pairs) {
  if (pair.state !== 0) continue;
  const a = R.settled.items[pair.a];
  const b = R.settled.items[pair.b];
  if (a.layer === b.layer) continue;
  const [lo, hi] = RANK[a.layer] < RANK[b.layer] ? [a, b] : [b, a];
  if (lo.key > hi.key) crossing.push(`${lo.name} (${lo.layer}) is in front of ${hi.name} (${hi.layer})`);
}
if (crossing.length) console.log(`layer order: ${crossing.length} problems\n  ` + crossing.slice(0, 12).join("\n  "));

const unit = (vector) => {
  const o = at([0, 0, 0]);
  const p = at(vector);
  return [p[0] - o[0], p[1] - o[1]];
};
const groupOf = (item, index) => {
  const [mx, my, mz] = item.move;
  return `<g class="it" data-piece="${item.piece}" data-name="${item.name}" data-k="${item.key.toFixed(3)}" data-m="${mx.toFixed(1)},${my.toFixed(1)},${mz.toFixed(1)}" data-i="${index}"${item.attrs ?? ""}>${item.svg}</g>`;
};
const backItems = R.items.filter((i) => i.layer === "back").map(groupOf);
const carItems = R.items.filter((i) => i.layer === "car").map(groupOf);
const frontItems = R.items.filter((i) => i.layer === "front").map(groupOf);

// the car's shadow on the pad: it follows the car along the pad and thins as the car lifts
const SHADOW = { x: -98, y: -206, w: 196, d: 412, r: 44 };
const shadow = `<g class="rs-shadow"><path class="iso-halo rs-shadow-halo" d="${k.haloOf(SHADOW, 0, 0.1, P)}"/></g>`;

const VOLUME = TANKS.reduce((a, t) => a + t.volume, 0);
const sim = simulate("rocket", tankOf(1));
const simThrust = simulate("thrust", tankOf(1));
const SIDE_NAME = NEAR > 0 ? "left" : "right";
const LABEL =
  `A cutaway of the 2026 Tesla Roadster in its Rocket version on a concrete test pad, seen from its ${VIEW_NAMES[VIEW]}. The ${SIDE_NAME} side panel floats above the car (taken apart, the rest of the skin rises to meet it, the cabin floats up and the diffuser slides out the back); through the opening you see the single seat with its harness, the yoke, the console with a guarded three-position mode switch, the floor battery, the three motors, the suspension, and the compressed-air system: six carbon-overwrapped tanks, an air hub of collector, shut-off valve, regulator and distribution manifold on the largest tank, braided lines out to two valve blocks and two sill valves, and ten nozzles: four facing back through doors in the diffuser, two pointing down from the sills and four canted down at the corners. Behind the car a blast deflector stands on the pad, and a fill cart's hose runs to a port in the tail.`;
const svgOpen = (cls) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg rs-layer ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
const HOSE_ROUTE = ROUTES["air.hose"] ? ROUTES["air.hose"].route : ROUTES["hose"].route;
const hosePath = (() => {
  const out = [];
  let acc = 0;
  for (let i = 0; i < HOSE_ROUTE.length; i++) {
    if (i) acc += G.len3(G.sub3(HOSE_ROUTE[i], HOSE_ROUTE[i - 1]));
    const p = at(HOSE_ROUTE[i]);
    out.push([f2(acc), f2(p[0]), f2(p[1])]);
  }
  return out;
})();
const knobAt = HOSE_ROUTE[HOSE_ROUTE.length - 1];
const hoseKnob = `<g class="rs-hose-knob" data-knob="" style="display:none"><g class="rs-knob-move">${S(G.sphereOf(knobAt, 2.6, P, { steps: 20 }), { tone: "mid" })}</g></g>`;
const HOSE_LAYER = REAR ? "front" : "back";
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: [...back, ...backItems, shadow, HOSE_LAYER === "back" ? hoseKnob : ""] });
const frontSvg = `${svgOpen("rs-front")}${frontItems.join("")}${HOSE_LAYER === "front" ? hoseKnob : ""}</svg>`;

// what lights when each nozzle fires: its line from the hub out to its valve and the nozzle itself
const LIGHT = {
  main: ["air.rear"],
  lift: [],
  corner: [],
};
const NOZZLE_DATA = NOZZLES.map((n) => {
  const kind = n.kind;
  let exit;
  let dir = n.out;
  let routes = [];
  if (kind === "main") {
    const x = MAIN_X[+n.id.slice(4)];
    exit = [x, 206, 27];
    routes = ["air.rear"];
  } else if (kind === "lift") {
    exit = LIFT[n.id].exit;
    routes = [`air.${n.id}`];
  } else {
    exit = CORNER[n.id].exit;
    routes = [n.pos[1] < 0 ? "air.front" : "air.rear", `air.${n.id}`];
  }
  const near = kind === "main" ? REAR : Math.sign(exit[0]) === NEAR;
  return { id: n.id, kind, exit: exit.map(f2), dir: dir.map((v) => +v.toFixed(4)), size: n.exit * 100, routes, max: n.max, near };
});
void LIGHT;
// the fallback for the plumes when there is no WebGL: a soft cone down each near or rear jet
const fallback = NOZZLE_DATA.filter((n) => n.near)
  .map((n) => {
    const L = n.kind === "main" ? 80 : n.kind === "lift" ? 16 : 18;
    const e = n.exit;
    const d = n.dir;
    const a0 = at(e);
    const a1 = at(G.add3(e, G.mul3(d, L)));
    const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
    const nx = -(a1[1] - a0[1]) / len;
    const ny = (a1[0] - a0[0]) / len;
    const left = [];
    const right = [];
    for (let i = 0; i <= 8; i++) {
      const sv = (L * i) / 8;
      const c = at(G.add3(e, G.mul3(d, sv)));
      const w = (n.size * 0.9 + sv * 0.21) * KS;
      left.push([c[0] + nx * w, c[1] + ny * w]);
      right.push([c[0] - nx * w, c[1] - ny * w]);
    }
    return `<path class="rs-jet-fb" data-jet="${n.id}" d="${k.pathOf([...left, ...right.reverse()], true)}"/>`;
  })
  .join("");
const carSvg = `${svgOpen("rs-carsvg")}<g class="rs-car">${carItems.join("")}<g class="rs-fallback">${fallback}</g></g></svg>`;
const DATA = {
  W,
  H,
  P,
  V,
  KS,
  camera: glCamera(P),
  EX: unit([1, 0, 0]),
  EY: unit([0, 1, 0]),
  EZ: unit([0, 0, 1]),
  stagger: STAGGER,
  spring: SPRING,
  nozzles: NOZZLE_DATA,
  supply: ["air.t1", "air.t8", "air.t9", "air.cabin"],
  wheels: WHEELS.filter((w) => w.near),
  rimR: RIM_R - 0.3,
  gauge: GAUGE,
  doors: DOORS,
  doorPoses: [0, 22, 44, 66, 88],
  switchPoses: SWITCH_POSES,
  guardPoses: GUARD_POSES,
  shadow: SHADOW,
  pad: { x0: PAD.x, x1: PAD.x + PAD.w, y0: PAD.y, y1: PAD.y + PAD.d },
  deflector: { y0: 282, y1: 316, x0: -112, x1: 112, top: 53.6 },
  carExtent: { x0: -HALF_W, x1: HALF_W, y0: -219, y1: 217 },
  hoseTotal: HOSE.total,
  hosePath,
  knob: at(knobAt).map(f2),
  volume: +VOLUME.toFixed(1),
  view: VIEW,
  name: VIEW_NAMES[VIEW],
  origin: at([0, 0, 0]).map((v) => +v.toFixed(3)),
  light: G.lightOf(P).map((v) => +v.toFixed(4)),
  ...(VIEW === 0 ? { mesh: MESH } : {}),
};

const fmt = (v, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const CAPTION =
  `Tesla showed the new Roadster on 15 October 2026 in three versions: Performance (two seats, 0–60 mph in under 1.6 s), Thrust (two seats, rear cold-gas thrusters, under 0.9 s) and Rocket (one seat, invite-only, not approved for public roads, under 0.59 s), with over 300 miles of range and over 230 mph, for 2028. ` +
  `This is the Rocket. Tesla's Lars Moravy said its 10 thrusters run on 600 litres of compressed air, held in carbon-overwrapped pressure vessels in "every usable void"; Tesla says they give four to five times the force the tyres can. ` +
  `Everything else here is our estimate: the layout (the tanks drawn hold ${fmt(VOLUME)} L), a 300 bar fill, a 40 bar regulator, about 80 kN from all ten nozzles (a reported, unconfirmed figure), and a 1,814 kg car (a "4,000+ lb" figure posted by Marques Brownlee, not Tesla). ` +
  `On those numbers a full tank holds ${fmt(FULL)} kg of air, of which ${fmt(FULL - RESIDUAL)} kg is usable, and lifts the car for about ${fmt(sim.airtime, 1)} s; one Thrust launch spends ${fmt(simThrust.used, 1)} kg. ` +
  `The mode switch is ours, to compare the three versions on one car. The internal layout is an illustration, not Tesla's engineering drawing.`;
mkdirSync(join(HERE, "views"), { recursive: true });
writeFileSync(join(HERE, "views", `view-${VIEW}.json`), JSON.stringify({ backSvg, carSvg, frontSvg, data: DATA, caption: CAPTION }));
console.log(`wrote view ${VIEW} (${VIEW_NAMES[VIEW]})`, `${R.items.length} items`, `${R.solids.length} solids`, `scale ${KS.toFixed(3)}`, `tanks ${VOLUME.toFixed(0)} L`);
// Crowding pairs looked at 8x in each view and judged clear; each says why. The audit models wide flat
// panels (the diffuser, the tail, the side panel) as rods with round ends, which reach further than the
// panels do. The cart's hose is always reeled in before the car comes apart, so its pairs in the
// taken-apart state never show on the page.
const CROWD_BY_VIEW = [
  // rear left
  [
    ["hose", "body.diffuser"], // the coupling sits on the fill port, about 30 px above the diffuser's visible edge
    ["air.rL", "body.tail"], // the line end sits about 10 px from the tail panel's lower corner
  ],
  // rear right
  [
    ["air.fR", "front.beam"], // the line bends into the corner nozzle in front of the beam, 26 cm nearer
    ["air.fL", "front.rail"], // the fitting sits on the valve block's face, the rail 16 cm behind it
    ["air.liftR", "tank.seatB"], // the line ends on the sill valve's body, the tank 28 cm behind
    ["air.rear", "tub.sill.wall"], // taken apart: the fitting sits on the distribution block, the sill a metre behind
  ],
  // front right
  [
    ["hose", "stand.deflector"], // taken apart only, when the hose is reeled in
    ["air.cabin", "tank.behind"], // the fitting sits on the cabin block's top, the tank 25 cm behind it
  ],
  // front left
  [
    ["hose", "cart.bottle"], // the hose drops from its fairlead in front of the bottle's end, clearly over it
    ["hose", "stand.deflector"], // taken apart only, when the hose is reeled in
    ["air.rL", "panel.skin"], // the bend shows through the wheel arch, inside it
    ["air.cabin", "tub.bulkhead.cap"], // taken apart: the line ends on the collector, the cap 20 cm behind
    ["air.cabin", "tank.behind"], // taken apart: the fitting sits on the cabin block's top, in front of the tank
    ["air.cabin", "tank.seatA"], // taken apart: the same fitting, with the seat tank's end beside it
    ["hose", "body.diffuser.rail"], // taken apart only, when the hose is reeled in
  ],
];
const CROWD_OK = CROWD_BY_VIEW[VIEW];
if (process.argv.includes("--audit")) A.auditOrExit(R, P, { crowd: CROWD_OK, cover: ["door.main0", "door.main1", "door.main2", "door.main3", "switch.lever", "switch.guard"] });

// ===================================================================== all four views, and the pages
async function buildAll() {
  const audit = process.argv.includes("--audit");
  const one = (view) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), `--view=${view}`, ...(audit ? ["--audit"] : [])], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ view, code, out }));
    });
  const results = await Promise.all(VIEWS.map((_, view) => one(view)));
  for (const r of results) console.log(`== view ${r.view}, ${VIEW_NAMES[r.view]}${r.code ? ` (exit ${r.code})` : ""}\n${r.out.trim()}`);
  if (results.some((r) => r.code)) process.exitCode = 1;
  assemble();
}
// how far the four corner nozzles can turn the car on one tank, from the model: their couple, the car's
// yaw inertia, and the time a full tank keeps it up
function turnLine() {
  const corners = NOZZLES.filter((n) => n.kind === "corner");
  const couple = corners.reduce((a, n) => a + Math.abs(n.pos[0] * -n.out[1] - n.pos[1] * -n.out[0]) * n.max, 0) * 0.4;
  const t = simulate("rocket", tankOf(1)).airtime;
  const alpha = couple / SPEC.yawInertia;
  const stop = ((alpha * (t / 2) ** 2 * 180) / Math.PI).toFixed(0);
  const spin = ((0.5 * alpha * t * t * 180) / Math.PI).toFixed(0);
  return `In hands-on flight the corner nozzles, fired in diagonal pairs, can also turn the car: on these numbers about ${Math.round(stop / 5) * 5}° on one tank if it is to stop turning before it lands, or ${Math.round(spin / 5) * 5}° if it lands still turning, so a full turn would take several tanks.`;
}
function assemble() {
  const views = VIEWS.map((_, view) => JSON.parse(readFileSync(join(HERE, "views", `view-${view}.json`), "utf8")));
  const CSS = readFileSync(join(HERE, "roadster.css"), "utf8");
  const MODEL = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
  const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify({ views: views.map((v) => ({ ...v.data, mesh: undefined })), mesh: views[0].data.mesh }));
  const CAR3D = readFileSync(join(HERE, "car3d.js"), "utf8");
  const latheSource = readFileSync(join(HERE, "..", "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
  const latheScript = `const GL = (() => {${latheSource}\nreturn { spokesOf };})();\n`;
  const BUTTONS = [
    ["fly", "Hold to fly"],
    ["back", "\u2190 Back"],
    ["fwd", "Forward \u2192"],
    ["turnL", "Q \u27f2 Turn"],
    ["turnR", "Turn \u27f3 E"],
    ["orbit", "O Orbit"],
    ["spin", "S View \u21bb"],
    ["performance", "1 Performance"],
    ["thrust", "2 Thrust"],
    ["rocket", "3 Rocket"],
    ["launch", "\u21b5 Launch"],
    ["panel", "A Panel"],
    ["apart", "D Take apart"],
    ["refill", "F Refill"],
  ]
    .map(([id, text]) => `<button type="button" class="rs-btn" data-act="${id}">${text}</button>`)
    .join("");
  const viewsHtml = views
    .map((v, i) => `<div class="rs-view" data-view="${i}"${i ? ' aria-hidden="true"' : " data-on"}>${v.backSvg}<canvas class="rs-layer rs-gl rs-far" aria-hidden="true"></canvas>${v.carSvg}<canvas class="rs-layer rs-gl rs-near" aria-hidden="true"></canvas>${v.frontSvg}</div>`)
    .join("");
  const stage = `<div class="iso-stage rs-stage" tabindex="0" role="group" aria-label="Tesla Roadster cutaway. Hold Space to fly, from any version, and use the left and right arrows to move along the pad. S spins the view a quarter turn around the car. Press 1, 2 or 3 to pick a version and Enter to launch it. A takes the side panel off or puts it back, D takes the car apart, F refills the air.">${viewsHtml}<span class="rs-sr" role="status" aria-live="polite" data-status></span></div>`;
  const body =
    `<style>${CSS}</style>` +
    k.plateHtml({
      fig: "Fig 5",
      title: "Tesla Roadster · a flying car on compressed air",
      hint: "hold space to fly · \u2190 \u2192 move · Q E turn · S view",
      readout: "rocket · ≈300 bar · 100% air · 0 kN · 0.00 m",
      keys: [
        { mark: "lit", label: "The air's path while a nozzle fires: tank, regulator, manifold, valve, nozzle" },
        { mark: "raised", label: "The side panel facing you, lifted off to show the inside; taken apart, the rest of the skin, the diffuser and the cabin lift off the air system too" },
        { mark: "edge", label: "Braided high-pressure lines, and the fill cart's hose to the tail" },
      ],
      caption: views[0].caption + " " + turnLine(),
      body: stage,
    });
  const CREDIT = `<style>.credit{margin:40px 0 0;color:var(--anatomy-muted);font:11px/1.4 var(--anatomy-mono);letter-spacing:.04em}.credit a{color:var(--anatomy-text);text-decoration:none;border-bottom:1px solid var(--anatomy-faint)}.credit a:hover{color:var(--anatomy-strong);border-color:var(--anatomy-mid)}</style><p class="credit">Made by <a href="https://www.littlenicethings.com/">Studio Little Nice Things</a> · <a href="https://buymeacoffee.com/littlenicethings">Support future experiments ☕️</a></p>`;
  for (const theme of ["dark", "light"]) {
    const page = k.pageHtml({
      title: "Tesla Roadster · a flying car on compressed air",
      theme,
      // the controls sit right under the card, so they are on screen with the car rather than below the caption
      body: body.replace('<figcaption class="iso-legend">', `<div class="rs-buttons">${BUTTONS}</div><figcaption class="iso-legend">`) + CREDIT,
      script: kitScript() + glScript() + latheScript + MODEL + CAR3D + LIVE,
      width: 1040,
    });
    const name = theme === "light" ? "roadster-light.html" : "roadster.html";
    writeFileSync(join(HERE, name), page);
    console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`);
  }
}
