import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";
import { CAR, WHEEL_R } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

// World units are 10 mm. x runs nose-forward, y to the car's left (toward the viewer), z up.
// The body is whole; taken apart, it lifts off. The battery's lid is open over its near half (y > CUT) to show the cells.
const W = 640;
const H = 560;
const AZIMUTH = 56;
const ELEVATION = 36;

const Z0 = 2.5; // top of the alignment plates the tyres stand on
const AX = CAR.wheelbase / 20; // 144.85: axles at ±AX
const TRACK = 80; // wheel centres at y = ±TRACK
const TYRE_R = WHEEL_R * 100; // 38.2
const TYRE_W = 12.75; // half of 255 mm
const RIM_R = 25.4; // 20-inch rim
const WZ = Z0 + TYRE_R;
const HALF_L = CAR.length / 20; // 239.1
const HALF_W = CAR.width / 20; // 94.75
const ROOF_Z = Z0 + CAR.height / 10 - 2.5; // tyres are pressed 2.5 into the plates' z0: height measured from the road
const CUT = -4;
const SILL_Z = Z0 + 18;
const ARCH_R = 43;

const PLATE = { x: -296, y: -128, w: 574, d: 256, r: 12 };
const PLATE_H = 12;
const FOOT_H = 5;

const PIECES = {
  body: { name: "Body", say: "body · steel and aluminium shell, glass roof", move: [0, 0, 130] },
  cabin: { name: "Cabin", say: "cabin · seats, dash and the panoramic display", move: [0, 0, 44] },
  fl: { name: "Front left corner", say: "front left corner · strut, brake, 20-inch wheel", move: [12, 70, 0] },
  fr: { name: "Front right corner", say: "front right corner · strut, brake, 20-inch wheel", move: [12, -70, 0] },
  rl: { name: "Rear left corner", say: "rear left corner · strut, brake, 20-inch wheel", move: [30, 70, 0] },
  rr: { name: "Rear right corner", say: "rear right corner · strut, brake, 20-inch wheel", move: [30, -70, 0] },
  front: { name: "Front drive unit", say: "front motor · induction, drives on demand", move: [80, 0, 0] },
  rear: { name: "Rear drive unit", say: "rear motor · electrically excited synchronous", move: [-80, 0, 0] },
  battery: { name: "Battery", say: `battery · ${CAR.battery} kWh, ${CAR.volts} V, cylindrical cells`, move: [0, 0, 0] },
  stand: { name: "Stand", say: "", move: [0, 0, 0] },
};
const STAGGER = ["body", "cabin", "fl", "rl", "fr", "rr", "front", "rear", "battery", "stand"];
const SPRING = { stagger: 0.045, stiffness: 52, damping: 13.2, substeps: 4 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [HALF_L, HALF_W, ROOF_Z + 130], [-HALF_L, -HALF_W, ROOF_Z + 130], [HALF_L, -HALF_W, ROOF_Z + 130], [-HALF_L, HALF_W, ROOF_Z + 130]],
  W,
  H,
  { pad: 22, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const f2 = (v) => Math.round(v * 100) / 100;
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const record = R.solid;
const rideOf = (piece) => piece;
function put(piece, name, ref, svg, shapes = [], { bias = 0, attrs = "", ...rest } = {}) {
  return R.put({ piece, ride: rideOf(piece), name: R.nameFor(name), at: ref, bias, svg, shapes, move: PIECES[piece].move, attrs, ...rest });
}

// ---------- prisms of any polygon along any axis (concave allowed), as in the arcade cabinet ----------
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
const YF = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]); // polygons in (x, z), extruded along y
const XF = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); // polygons in (y, z), extruded along x
const centroid = (poly) => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
function side(piece, name, poly, y0, y1, style = {}, { extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const shape = record(A.prism(YF, poly, y0, y1, { name }));
  const [cx, cz] = centroid(poly);
  put(piece, name, [cx, (y0 + y1) / 2, cz], S(prismPaths(YF, poly, y0, y1), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function cross(piece, name, poly, x0, x1, style = {}, { extra = "", inner = "", bias = 0 } = {}) {
  const shape = record(A.prism(XF, poly, x0, x1, { name }));
  const [cy, cz] = centroid(poly);
  put(piece, name, [(x0 + x1) / 2, cy, cz], S(prismPaths(XF, poly, x0, x1), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
  return shape;
}
function box(piece, name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name }, steps));
  put(piece, name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function disc(piece, name, F, s0, s1, r, style = {}, { extra = "", bias = 0, owner, steps, attrs = "" } = {}) {
  const shape = record(A.disc(F, s0, s1, r, { name, owner }));
  put(piece, name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P, steps ? { steps } : {}), { tone: "mid", ...style }) + extra, [shape], { bias, attrs });
  return shape;
}
function turned(piece, name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, owner, attrs = "" } = {}) {
  const paths = G.solidOf(profile, F, P, smooth ? { smooth } : {});
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner, radius: smooth && smooth.radius ? smooth.radius : null }));
  put(piece, name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function ball(piece, name, c, r, style = {}, { bias = 0 } = {}) {
  const shape = record(A.ball(c, r, { name }));
  put(piece, name, c, S(G.sphereOf(c, r, P, { steps: 24 }), { tone: "mid", ...style }), [shape], { bias });
  return shape;
}

// Pipes, shafts and cables: depth-sorted chunks, gapped under their own collars.
const ROUTES = {};
function line(piece, name, control, r, { bend = 6, tone = "hi", ends = [true, true], shells = [false, false], boots = [], gaps: extra = [], free = [false, false], limp = false, touch, attrs = "" } = {}) {
  const route = G.fillet(control, Math.max(bend, r * 2.6), 10, { P, tube: r });
  const total = G.pathLength(route);
  const SHELL = Math.max(1.8, r * 2.2);
  const gaps = [...(shells[0] ? [[0, SHELL]] : []), ...(shells[1] ? [[total - SHELL, total]] : []), ...extra];
  const bootSpans = boots.map(([from, to]) => [from, to]);
  gaps.push(...bootSpans);
  R.route(name, route, r, { owner: name, gaps, limp, touch, free, rims: shells.map((on) => (on ? r * 1.8 : r)), piece, move: PIECES[piece].move, ride: piece });
  tubePieces(route, r, P, { maxLength: 12, spacing: Math.max(0.8, Math.min(1.6, r)), gaps }).forEach((part, index) =>
    put(piece, `${name}:${index}`, part.mid, tubeSvg(part, { tone }), [A.tube(part.points, part.radii)], { route: name, chunk: index, attrs: ` data-route="${name}" data-from="${f2(part.from)}" data-to="${f2(part.to)}"${attrs}` }),
  );
  [0, 1].forEach((index) => {
    const end = index ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, index ? total : 0);
    if (shells[index]) {
      const F = G.frameAlong(end, tangent);
      const [s0, s1] = index ? [-SHELL, 0] : [0, SHELL];
      disc(piece, `${name}.shell${index}`, F, s0, s1, r * 1.8, { tone: "mid" }, { owner: name, steps: 20 });
    } else if (ends[index] && limp) {
      const size = Math.max(0.5, r * KS * 0.9);
      put(piece, `${name}.end${index}`, end, Dots([at(end)], { size, tone: "hi" }), [A.ball(end, size / KS, { name: `${name}.end${index}`, owner: name })], { bias: 0.15 });
    }
  });
  // rubber boots on a shaft: a short bellows of discs
  for (const [from, to] of bootSpans) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const sA = from + ((to - from) * i) / n;
      const sB = from + ((to - from) * (i + 1)) / n;
      const mid = (sA + sB) / 2;
      const F = G.frameAlong(G.pointAlong(route, mid), G.tangentAlong(route, mid));
      const rr = r * (i % 2 ? 1.6 : 2.0);
      disc(piece, `${name}.boot`, F, sA - mid, sB - mid, rr, { tone: "lo" }, { owner: name, steps: 24 });
    }
  }
  ROUTES[name] = { total: f2(total) };
  return { route, total };
}

const back = [];

// ---------- stand: base plate, two turn plates under the front wheels, two slip plates under the rear ----------
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 26))) {
  back.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.8, P, 32), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 6.2, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 32), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 12);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.6, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
{
  const strip = { x: PLATE.x + 30, y: PLATE.y + PLATE.d - 13, w: PLATE.w - 60, d: 6, r: 1 };
  back.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 10, 5, strip.y, 0.6, [1.8, 3.4], P);
  back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  back.push(Dots([at([strip.x + 2, strip.y + 3, 0.6]), at([strip.x + strip.w - 2, strip.y + 3, 0.6])], { size: 0.45 }));
  const label = { x: -40, y: PLATE.y + PLATE.d - 36, w: 46, d: 16, r: 1.2 };
  back.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  back.push(Ln(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  back.push(Ln([30, 20, 25].map((w, i) => k.lineOnTop([label.x + 4, label.y + 4 + i * 3.6], [label.x + 4 + w, label.y + 4 + i * 3.6], 0.8, P)).join(""), { tone: "lo", free: true }));
  back.push(Dots([at([label.x + label.w - 2.8, label.y + 2.6, 0.8]), at([label.x + label.w - 2.8, label.y + label.d - 2.6, 0.8])], { size: 0.45 }));
}
for (const sy of [-1, 1]) {
  const cx = AX;
  const cy = sy * TRACK;
  const base = { x: cx - 34, y: cy - 30, w: 68, d: 60, r: 3 };
  put("stand", "stand.turnbase", [cx, cy, 0.6], S(k.slabOf(base, 0, 1.2, P, 3, 0.4), { tone: "lo" }) + Dots(k.corners(base, 3).map(([x, y]) => at([x, y, 1.2])), { size: 0.45 }), [record(A.slab(base, 0, 1.2, { name: "stand.turnbase", ground: true }, 3))]);
  const tk = k.radialTicks(cx, cy, 27.6, 72, 6, Z0, [1.2, 2.6], P);
  put("stand", "stand.turnplate", [cx, cy, 1.85], S(k.cylinder(cx, cy, 28, 1.2, Z0 - 1.2, P, 72, 0.4), { tone: "mid" }) + Ln(tk.minor, { tone: "lo" }) + Ln(tk.major, { tone: "mid" }) + Ln(k.ring(cx, cy, 21, Z0, P, 64), { tone: "faint" }), [record(A.cylinder(cx, cy, 28, 1.2, Z0 - 1.2, { name: "stand.turnplate", ground: true }))]);
  const slip = { x: -AX - 30, y: cy - 26, w: 60, d: 52, r: 2.4 };
  put("stand", "stand.slip", [-AX, cy, Z0 / 2], S(k.slabOf(slip, 0, Z0, P, 3, 0.4), { tone: "mid" }) + Ln(k.planOutline(k.insetPlan(slip, 3), Z0, P, 3), { tone: "faint" }) + Dots(k.corners(slip, 2.6).map(([x, y]) => at([x, y, Z0])), { size: 0.45 }), [record(A.slab(slip, 0, Z0, { name: "stand.slip", ground: true }, 3))]);
}

// ---------- corners: wheel, tyre, brake, knuckle, strut with coil, lower arms ----------
const tyreR = (s) => 31 + 7.2 * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(s) / TYRE_W), 4)), 0.25);
const tyreSlope = (s) => {
  const u = Math.min(0.995, Math.abs(s) / TYRE_W);
  const inner = 1 - Math.pow(u, 4);
  return -Math.sign(s) * 7.2 * 0.25 * Math.pow(inner, -0.75) * 4 * Math.pow(u, 3) / TYRE_W;
};
const WHEELS = [];
const CORNERS = [
  { id: "fl", x: AX, sy: 1 },
  { id: "fr", x: AX, sy: -1 },
  { id: "rl", x: -AX, sy: 1 },
  { id: "rr", x: -AX, sy: -1 },
];
for (const c of CORNERS) {
  const centre = [c.x, c.sy * TRACK, WZ];
  const F = G.frameOf(centre, [0, c.sy, 0], [1, 0, 0], [0, 0, 1]);
  const knots = Array.from({ length: 27 }, (_, i) => -TYRE_W + (2 * TYRE_W * i) / 26);
  const profile = [[-TYRE_W, RIM_R], ...knots.map((s) => [s, tyreR(s), 1]), [TYRE_W, RIM_R]];
  turned(c.id, `${c.id}.tyre`, F, profile, { tone: "mid" }, { smooth: { slope: (s) => (Math.abs(s) >= TYRE_W ? 0 : tyreSlope(s)), radius: (s) => (Math.abs(s) >= TYRE_W - 1e-6 ? 31 : tyreR(s)) }, inner: Ln(G.arcOf(F, 0, TYRE_R, P), { tone: "faint" }) });
  // rim face and spokes, drawn on the outer face; rebuilt by the live loop while the car drives
  const face = TYRE_W + 0.9;
  const spokes = G.spokesOf(F, face, 6.9, RIM_R - 0.3, 10, P, { sweep: 0.22 });
  const lugs = G.dotsOf(F, face + 0.8, 4.6, 5, P, { all: true });
  disc(c.id, `${c.id}.rim`, F, TYRE_W, face, RIM_R, { tone: "hi" }, { extra: `<g data-spokes="${c.id}">${Ln(spokes, { tone: "mid" })}</g>` + Ln(G.circleOf(F, face, RIM_R - 2.4, P, 64), { tone: "faint" }), attrs: ` data-wheel="${c.id}"` });
  disc(c.id, `${c.id}.cap`, F, face, face + 0.8, 6.4, { tone: "hi" }, { extra: Dots(lugs, { size: 0.5, tone: "mid" }) + Ln(G.circleOf(F, face + 0.8, 3, P, 24), { tone: "lo" }) });
  // inboard: hub, brake disc, caliper, knuckle
  disc(c.id, `${c.id}.hub`, F, -TYRE_W - 1.6, -TYRE_W, 9, { tone: "mid" });
  disc(c.id, `${c.id}.disc`, F, -TYRE_W - 3.4, -TYRE_W - 1.6, 19.5, { tone: "hi" }, { extra: Ln(G.circleOf(F, -TYRE_W - 3.4, 13, P, 48) + G.circleOf(F, -TYRE_W - 3.4, 8.5, P, 32), { tone: "faint" }) });
  const yIn = c.sy * (TRACK - TYRE_W - 3.4);
  const yKn = c.sy * (TRACK - TYRE_W - 3.4 - 12);
  const behind = c.x > 0 ? -1 : 1;
  const calX = c.x + behind * 14;
  box(c.id, `${c.id}.caliper`, [calX - 5, Math.min(yIn, yIn - c.sy * 3.2), WZ + 2], [calX + 5, Math.max(yIn, yIn - c.sy * 3.2), WZ + 16], { tone: "hi" }, { r: 1.4, steps: 3, bevel: 0.3 });
  box(c.id, `${c.id}.knuckle`, [c.x - 6, Math.min(yIn, yKn), WZ - 12], [c.x + 6, Math.max(yIn, yKn), WZ + 14], { tone: "mid" }, { r: 1.2, steps: 3, bevel: 0.3 });
  // strut: damper body from the knuckle top up to the tower, coil around it, top mount
  const sx = c.x;
  const sy = c.sy * (TRACK - TYRE_W - 12);
  const z0 = WZ + 14;
  const z1 = WZ + 44;
  const SF = G.frameOf([sx, sy, z0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  turned(c.id, `${c.id}.damper`, SF, [[0, 3.4], [4, 3.4]], { tone: "mid" });
  disc(c.id, `${c.id}.seat`, SF, 4, 5.2, 7.6, { tone: "mid" });
  turned(c.id, `${c.id}.body`, SF, [[5.2, 3.4], [18, 3.4]], { tone: "mid" }, { inner: Ln(G.arcOf(SF, 12, 3.4, P), { tone: "faint" }) });
  turned(c.id, `${c.id}.rod`, SF, [[18, 1.4], [z1 - z0, 1.4]], { tone: "hi" });
  disc(c.id, `${c.id}.mount`, SF, z1 - z0, z1 - z0 + 3, 7.6, { tone: "mid" }, { extra: Dots(G.dotsOf(SF, z1 - z0 + 3, 5.6, 3, P, { all: true }), { size: 0.45 }) });
  const coil = [];
  const turns = 5.5;
  for (let i = 0; i <= 220; i++) {
    const t = i / 220;
    const a = t * turns * Math.PI * 2;
    coil.push([sx + 6.2 * Math.cos(a), sy + 6.2 * Math.sin(a), WZ + 23.2 + t * (z1 - z0 - 23.2 + 14 - 14) ]);
  }
  const coilTop = WZ + 44;
  for (let i = 0; i < coil.length; i++) coil[i][2] = z0 + 5.2 + 0.7 + (i / (coil.length - 1)) * (z1 - z0 - 5.2 - 1.4);
  // split the helix into its front and back runs so the damper sits inside it
  const front = [];
  const backRun = [];
  let run = [];
  let facing = null;
  for (const p of coil) {
    const n = [p[0] - sx, p[1] - sy, 0];
    const f = G.dot3(n, V) > 0;
    if (facing !== null && f !== facing) {
      run.push(p);
      (facing ? front : backRun).push(run);
      run = [];
    }
    facing = f;
    run.push(p);
  }
  (facing ? front : backRun).push(run);
  const coilD = (runs) => runs.filter((r) => r.length > 1).map((r) => path3(r)).join("");
  put(c.id, `${c.id}.coil.back`, [sx, sy, (WZ + coilTop) / 2 + 10], Ln(coilD(backRun), { tone: "lo", className: "cx-coil" }), backRun.filter((r) => r.length > 1).map((r) => A.tube(r, 0.5, { name: `${c.id}.coil` })), { bias: -6 });
  put(c.id, `${c.id}.coil.front`, [sx, sy, (WZ + coilTop) / 2 + 10], Ln(coilD(front), { tone: "hi", className: "cx-coil" }), front.filter((r) => r.length > 1).map((r) => A.tube(r, 0.5, { name: `${c.id}.coil` })), { bias: 6 });
  WHEELS.push({ id: c.id, F: { o: F.o, a: F.a, u: F.u, v: F.v }, face });
  c.knuckleY = yKn;
}

// ---------- battery: tray, far-half lid, cell tops in the open half, end plates, sills ----------
const BAT = { x0: -100, x1: 100, y0: -74, y1: 74, z0: Z0 + 16, z1: Z0 + 29 };
box("battery", "battery.tray", [BAT.x0, BAT.y0, BAT.z0], [BAT.x1, BAT.y1, BAT.z0 + 1.6], { tone: "lo" }, { r: 2, steps: 3 });
for (const [y0, y1] of [[BAT.y0, BAT.y0 + 1.4], [BAT.y1 - 1.4, BAT.y1]]) box("battery", "battery.side", [BAT.x0, y0, BAT.z0 + 1.6], [BAT.x1, y1, BAT.z1], { tone: "mid" }, { r: 0.4 });
for (const [x0, x1] of [[BAT.x0, BAT.x0 + 1.4], [BAT.x1 - 1.4, BAT.x1]]) box("battery", "battery.end", [x0, BAT.y0 + 1.4, BAT.z0 + 1.6], [x1, BAT.y1 - 1.4, BAT.z1], { tone: "mid" }, { r: 0.3 });
box("battery", "battery.lid", [BAT.x0 + 1.4, BAT.y0 + 1.4, BAT.z1 - 1.2], [BAT.x1 - 1.4, CUT, BAT.z1], { tone: "mid" }, {
  r: 0.4,
  extra: Ln([-70, -20, 30, 80].map((x) => k.lineOnTop([x, BAT.y0 + 1.4], [x, CUT], BAT.z1, P)).join(""), { tone: "faint" }),
});
// the cells: 46 mm cylinders standing in rows (4695), seen from above through the open half of the lid
const CELL = 4.6;
const PITCH = 4.9;
const cellCols = [];
const cellTop = BAT.z1 - 2.6;
{
  const x0 = BAT.x0 + 4;
  const cols = Math.floor((BAT.x1 - BAT.x0 - 8) / PITCH);
  const rows = Math.floor((BAT.y1 - 4 - CUT - 1) / (PITCH * 0.866));
  for (let c = 0; c < cols; c++) {
    const rings = [];
    for (let r = 0; r < rows; r++) {
      const x = x0 + c * PITCH + (r % 2 ? PITCH / 2 : 0) + CELL / 2;
      if (x > BAT.x1 - 4) continue;
      const y = CUT + 2 + CELL / 2 + r * PITCH * 0.866;
      rings.push(k.ring(x, y, CELL / 2, cellTop, P, 14));
    }
    cellCols.push(rings.join(""));
  }
  const floor = { x: BAT.x0 + 1.4, y: CUT, w: BAT.x1 - BAT.x0 - 2.8, d: BAT.y1 - 1.4 - CUT, r: 0.2 };
  const svg = S(k.slabOf(floor, BAT.z0 + 1.6, cellTop - BAT.z0 - 1.6, P, 1), { tone: "lo", crease: "none" }) + cellCols.map((d, i) => `<path class="cx-cell" data-col="${i}" d="${d}"/>`).join("");
  put("battery", "battery.cells", [0, (CUT + BAT.y1) / 2, (BAT.z0 + cellTop) / 2], svg, [record(A.slab(floor, BAT.z0 + 1.6, cellTop - BAT.z0 - 1.6, { name: "battery.cells" }, 1))], { bias: -0.2 });
}
// busbars across the cell field
box("battery", "battery.busbar", [BAT.x0 + 1.4, CUT + 0.5, cellTop], [BAT.x1 - 1.4, CUT + 2, cellTop + 0.6], { tone: "hi" }, { r: 0.2 });

// ---------- drive units ----------
function driveUnit(piece, ax, { r, len, dir }) {
  const F = G.frameOf([ax, 0, WZ], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  const half = len / 2;
  const y0 = -half - 6;
  const y1 = half - 6;
  turned(piece, `${piece}.motor`, F, [[y0, r - 2], [y0 + 2, r], [y1 - 2, r], [y1, r - 2]], { tone: "hi" }, {
    extra: k.fadedSvg(G.ribsOf(F, y0 + 4, y1 - 4, r, 36, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }),
  });
  // gearbox on the left end, output coaxial with the half shafts
  const gb = { x0: ax - 15, x1: ax + 15, y0: y1, y1: y1 + 12, z0: WZ - 13, z1: WZ + 15 };
  box(piece, `${piece}.gearbox`, [gb.x0, gb.y0, gb.z0], [gb.x1, gb.y1, gb.z1], { tone: "mid" }, { r: 3, steps: 4, bevel: 0.5, inner: Ln(k.sideSeam({ x: gb.x0, y: gb.y0, w: 30, d: 12, r: 3 }, WZ, P, 4), { tone: "faint" }), extra: Dots(k.corners({ x: gb.x0, y: gb.y0, w: 30, d: 12 }, 2.4).map(([x, y]) => at([x, y, gb.z1])), { size: 0.45 }) });
  disc(piece, `${piece}.endcap`, F, y0 - 3, y0, r - 4, { tone: "mid" });
  // inverter on top of the motor
  const top = WZ + r;
  box(piece, `${piece}.inverter`, [ax - 12, -20, top], [ax + 12, 6, top + 8], { tone: "hi" }, {
    r: 1.4,
    steps: 3,
    bevel: 0.4,
    extra: Ln(k.planOutline({ x: ax - 9, y: -17, w: 18, d: 20, r: 0.8 }, top + 8, P, 2), { tone: "faint" }) + Dots(k.corners({ x: ax - 12, y: -20, w: 24, d: 26 }, 2).map(([x, y]) => at([x, y, top + 8])), { size: 0.45 }),
  });
  // subframe: two rails under the unit and a cross tube, carrying the motor on mounts
  const sub = { z0: SILL_Z - 2, z1: SILL_Z + 2 };
  for (const sy of [-1, 1]) box(piece, `${piece}.rail`, [ax - 26, sy * 40 - 3, sub.z0], [ax + 26, sy * 40 + 3, sub.z1], { tone: "lo" }, { r: 1, steps: 2 });
  for (const sx of [-1, 1]) box(piece, `${piece}.cross`, [ax + sx * 22 - 3, -37, sub.z0], [ax + sx * 22 + 3, 37, sub.z1], { tone: "lo" }, { r: 1, steps: 2 });
  box(piece, `${piece}.cradle`, [ax - 25, -14, sub.z1], [ax + 25, 6, WZ - r], { tone: "lo" }, { r: 1.2, steps: 2, bevel: 0.3, extra: Dots([at([ax - 22, -11, WZ - r]), at([ax + 22, 3, WZ - r])], { size: 0.45 }) });
  return { y0: y0 - 3, y1: gb.y1, top };
}
function cyl(piece, name, cx, cy, r, z, h, style = {}) {
  const shape = record(A.cylinder(cx, cy, r, z, h, { name }));
  put(piece, name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, 24), { tone: "lo", ...style }), [shape]);
  return shape;
}
const FRONT = driveUnit("front", AX, { r: 12, len: 40 });
const REAR = driveUnit("rear", -AX, { r: 14, len: 44 });

// half shafts with boots, from each unit to its knuckles (ends come free when the corners move out)
for (const [unit, ax, c0, c1] of [[FRONT, AX, "fl", "fr"], [REAR, -AX, "rl", "rr"]]) {
  const kl = CORNERS.find((c) => c.id === c0).knuckleY;
  const kr = CORNERS.find((c) => c.id === c1).knuckleY;
  line(c0, `${c0}.shaft`, [[ax, kl, WZ], [ax, unit.y1, WZ]], 1.8, { tone: "mid", boots: [[0.4, 6.4], [kl - unit.y1 - 6, kl - unit.y1 - 0.2]], free: [false, true] });
  line(c1, `${c1}.shaft`, [[ax, kr, WZ], [ax, unit.y0, WZ]], 1.8, { tone: "mid", boots: [[0.4, 6.4], [unit.y0 - kr - 6, unit.y0 - kr - 0.2]], free: [false, true] });
}

// ---------- cabin: seats on the battery, dash, steering, display ----------
const FLOOR = BAT.z1 + 1.1; // top of the floor pan
function seat(piece, name, x, y, w) {
  const cushion = { x: x - 22, y: y - w / 2, w: 44, d: w, r: 5 };
  box(piece, `${name}.rail`, [x - 20, y - w / 2 + 3, FLOOR], [x + 20, y - w / 2 + 6, FLOOR + 3], { tone: "lo" }, { r: 0.6 });
  box(piece, `${name}.rail`, [x - 20, y + w / 2 - 6, FLOOR], [x + 20, y + w / 2 - 3, FLOOR + 3], { tone: "lo" }, { r: 0.6 });
  box(piece, `${name}.base`, [x - 18, y - w / 2 + 4, FLOOR + 3], [x + 16, y + w / 2 - 4, FLOOR + 14], { tone: "lo" }, { r: 2, steps: 3 });
  box(piece, `${name}.cushion`, [cushion.x, cushion.y, FLOOR + 14], [cushion.x + cushion.w, cushion.y + cushion.d, FLOOR + 22], { tone: "hi" }, { r: 5, steps: 6, bevel: 0.8, extra: Ln(k.planOutline(k.insetPlan(cushion, 6), FLOOR + 22, P, 5), { tone: "faint" }) });
  const backPoly = [[x - 22, FLOOR + 22], [x - 13, FLOOR + 22], [x - 24, FLOOR + 68], [x - 33, FLOOR + 66]];
  side(piece, `${name}.back`, backPoly, y - w / 2 + 1, y + w / 2 - 1, { tone: "hi" }, { inner: "" });
  const head = [[x - 32, FLOOR + 69], [x - 25, FLOOR + 70], [x - 27, FLOOR + 82], [x - 34, FLOOR + 81]];
  side(piece, `${name}.head`, head, y - 10, y + 10, { tone: "hi" });
  side(piece, `${name}.post`, [[x - 30, FLOOR + 66.6], [x - 29, FLOOR + 66.8], [x - 29.3, FLOOR + 69.3], [x - 30.3, FLOOR + 69.1]], y - 6, y - 4, { tone: "lo" });
}
seat("cabin", "seat.driver", 22, 38, 52);
seat("cabin", "seat.passenger", 22, -38, 52);
{
  // rear bench, full width
  const x = -78;
  box("cabin", "bench.base", [x - 18, -66, FLOOR], [x + 16, 66, FLOOR + 12], { tone: "lo" }, { r: 2, steps: 3 });
  box("cabin", "bench.cushion", [x - 22, -68, FLOOR + 12], [x + 22, 68, FLOOR + 21], { tone: "hi" }, { r: 4, steps: 5, bevel: 0.8, extra: Ln([-22, 22].map((yy) => k.lineOnTop([x - 22, yy], [x + 22, yy], FLOOR + 21, P)).join(""), { tone: "faint" }) });
  side("cabin", "bench.back", [[x - 22, FLOOR + 21], [x - 13, FLOOR + 21], [x - 27, FLOOR + 66], [x - 36, FLOOR + 64]], -68, 68, { tone: "hi" });
}
// dashboard: one moulding across the car, the panoramic display along its top, the steering column and wheel
const DASH = [[52, FLOOR + 40], [93, FLOOR + 36], [98, FLOOR + 58], [93, FLOOR + 68], [74, FLOOR + 70], [58, FLOOR + 62]];
side("cabin", "dash", DASH, -82, 82, { tone: "mid" }, { inner: "" });
side("cabin", "display", [[73, FLOOR + 70.05], [86, FLOOR + 69.2], [86.6, FLOOR + 72.4], [73.4, FLOOR + 73.4]], -64, 64, { tone: "lo" }, { attrs: ' data-display=""' });
{
  // column out of the dash's rear face along its normal, then hub, a ring and three spokes
  const base = [55, 38, FLOOR + 51];
  const dir = G.unit3([-22, 0, 6]);
  const tip = G.add3(base, G.mul3(dir, 14));
  line("cabin", "steering.column", [base, tip], 1.4, { tone: "mid", ends: [false, false] });
  const WF = G.frameAlong(tip, dir);
  turned("cabin", "steering.hub", WF, [[0, 4.2], [4.6, 4.2]], { tone: "hi" });
  // rim: a ring tube in three runs between ball joints, each spoke radial from the hub's side into a ball
  const RR = 16.7;
  const BALL = 1.7;
  const SPOKES = [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83];
  const off = 2 * Math.asin(Math.sqrt(BALL * BALL - 1.1 * 1.1) / (2 * RR));
  SPOKES.forEach((a0, i) => {
    let a1 = SPOKES[(i + 1) % SPOKES.length];
    if (a1 <= a0) a1 += Math.PI * 2;
    const arc = Array.from({ length: 33 }, (_, j) => G.pointOf(WF, 3.6, RR, a0 + off + ((a1 - a0 - 2 * off) * j) / 32));
    const name = `steering.rim${i}`;
    R.route(name, arc, 1.1, { owner: name, piece: "cabin", move: PIECES.cabin.move, ride: "cabin" });
    tubePieces(arc, 1.1, P, { maxLength: 8, spacing: 0.8 }).forEach((part, index) => put("cabin", `${name}:${index}`, part.mid, tubeSvg(part, { tone: "hi" }), [A.tube(part.points, part.radii)], { route: name, chunk: index }));
  });
  for (const ang of SPOKES) {
    const c = G.pointOf(WF, 3.6, RR, ang);
    ball("cabin", "steering.joint", c, BALL, { tone: "hi" });
    line("cabin", "steering.spoke", [G.pointOf(WF, 3.6, 4.2, ang), G.pointOf(WF, 3.6, RR - Math.sqrt(BALL * BALL - 0.8 * 0.8), ang)], 0.8, { tone: "hi", ends: [false, false] });
  }
}

// ---------- body: the whole shell, both sides; the glass shows the cabin ----------
const z = (v) => Z0 + v;
const SKIN = 0.8;
const BELT_INSET = 9; // greenhouse sits inboard of the shoulder
const IN = HALF_W - SKIN; // inner face of each side skin
function lowerPoly() {
  const top = [[HALF_L - 6, z(20)], [HALF_L, z(44)], [HALF_L - 1, z(70)], [HALF_L - 4, z(78)], [HALF_L - 11, z(84)], [118, z(99)], [-180, z(108)], [-HALF_L + 4, z(110)], [-HALF_L, z(96)], [-HALF_L + 1, z(44)], [-HALF_L + 8, z(20)]];
  const archOver = (cx) => {
    const pts = [[cx - ARCH_R, z(20)]];
    for (let i = 12; i >= 0; i--) {
      const a = (i / 12) * Math.PI;
      pts.push([cx + ARCH_R * Math.cos(a), z(36) + ARCH_R * Math.sin(a) * 0.98]);
    }
    pts.push([cx + ARCH_R, z(20)]);
    return pts;
  };
  return [...top, ...archOver(-AX), [-AX + ARCH_R + 6, z(18)], [AX - ARCH_R - 6, z(18)], ...archOver(AX)];
}
const lower = lowerPoly();
const beltZ = (x) => (x > 118 ? z(99) : z(99) + ((118 - x) / 298) * 9);
const ROOF_FRONT = 32;
const ROOF_BACK = -172;
const roofZ = (x) => ROOF_Z - 4 * ((x - ROOF_FRONT) / (ROOF_BACK - ROOF_FRONT)) ** 2;
const yIn = HALF_W - BELT_INSET;
for (const sy of [-1, 1]) {
  const tag = sy > 0 ? "l" : "r";
  const [o0, o1] = sy > 0 ? [IN, HALF_W] : [-HALF_W, -IN];
  // side skin: fenders, doors and rear wing in one pressing, with door shut lines and a character line
  // shut lines run from the sill to the beltline; the character line runs nose to tail, edge to edge
  const topAt = (x) => z(99) + ((118 - x) / 298) * 9;
  const sw = sy > 0 ? HALF_W : -HALF_W;
  const shut = path3([[60, sw, z(18)], [60, sw, topAt(60)]]) + path3([[-40, sw, z(18)], [-40, sw, topAt(-40)]]);
  const edgeAt = (zz, a, b) => a[0] + ((zz - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
  const cz0 = z(74);
  const cz1 = z(88);
  const crease = path3([[edgeAt(cz0, [HALF_L - 1, z(70)], [HALF_L - 4, z(78)]), sw, cz0], [edgeAt(cz1, [-HALF_L, z(96)], [-HALF_L + 1, z(44)]), sw, cz1]]);
  side("body", `body.side.${tag}`, lower, o0, o1, { tone: "hi" }, { extra: Ln(shut, { tone: "lo" }) + Ln(crease, { tone: "faint" }) + Dots([at([20, sy * HALF_W, z(84)]), at([-80, sy * HALF_W, z(86)])], { size: 0.6, tone: "mid" }) });
  // wheel-arch trims: a dark band proud of the skin around each arch
  for (const cx of [AX, -AX]) {
    const ring = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      ring.push([cx + (ARCH_R + 4.5) * Math.cos(a), z(36) + (ARCH_R + 4.5) * Math.sin(a) * 0.98]);
    }
    for (let i = 14; i >= 0; i--) {
      const a = (i / 14) * Math.PI;
      ring.push([cx + ARCH_R * Math.cos(a), z(36) + ARCH_R * Math.sin(a) * 0.98]);
    }
    const [t0, t1] = sy > 0 ? [HALF_W, HALF_W + 0.9] : [-HALF_W - 0.9, -HALF_W];
    side("body", `body.archtrim.${tag}`, ring, t0, t1, { tone: "lo" }, { attrs: ' data-trim=""' });
  }
  // strut towers: the body bears on the four strut top mounts
  for (const ax of [AX, -AX]) {
    const inner = sy * (TRACK - TYRE_W - 12 - 7);
    const [ty0, ty1] = sy > 0 ? [inner, IN] : [-IN, inner];
    box("body", `body.tower.${tag}`, [ax - 7, ty0, WZ + 47], [ax + 7, ty1, WZ + 51.5], { tone: "lo" }, { r: 1, steps: 2, bevel: 0.3, extra: Dots([at([ax - 4, sy * (TRACK - TYRE_W - 12), WZ + 51.5]), at([ax + 4, sy * (TRACK - TYRE_W - 12), WZ + 51.5])], { size: 0.45 }) });
  }
  // sill cladding between the arch trims, and flush door handles
  {
    const end = AX - ARCH_R - 4.5;
    const [t0, t1] = sy > 0 ? [HALF_W, HALF_W + 0.9] : [-HALF_W - 0.9, -HALF_W];
    side("body", `body.cladding.${tag}`, [[-end, z(18)], [end, z(18)], [end, z(27)], [-end, z(27)]], t0, t1, { tone: "lo" }, { attrs: ' data-trim=""' });
    for (const hx of [32, -70]) {
      const [h0, h1] = sy > 0 ? [HALF_W, HALF_W + 0.5] : [-HALF_W - 0.5, -HALF_W];
      box("body", `body.handle.${tag}`, [hx - 6, h0, z(87)], [hx + 6, h1, z(89)], { tone: "mid" }, { r: 0.2 });
    }
  }
  // sills inside the skins, under the doors
  const [s0, s1] = sy > 0 ? [IN - 10, IN] : [-IN, -IN + 10];
  side("body", `body.sill.${tag}`, [[-AX + ARCH_R + 6, z(18)], [AX - ARCH_R - 6, z(18)], [AX - ARCH_R - 6, z(28)], [-AX + ARCH_R + 6, z(28)]], s0, s1, { tone: "mid" });
  // shoulder ledge from the skin in to the greenhouse
  const pts = Array.from({ length: 10 }, (_, i) => 118 + ((-HALF_L + 18 - 118) * i) / 9);
  const topEdge = pts.map((x) => [x, Math.max(beltZ(x), z(99))]);
  const ledge = [...topEdge, ...[...topEdge].reverse().map(([x, zz]) => [x, zz - 2.2])];
  const [l0, l1] = sy > 0 ? [yIn + 3, IN] : [-IN, -yIn - 3];
  side("body", `body.shoulder.${tag}`, ledge, l0, l1, { tone: "mid" });
  // pillars and side glass
  const [p0, p1] = sy > 0 ? [yIn, yIn + 3] : [-yIn - 3, -yIn];
  const PILLARS = [
    ["apillar", [[118, z(99)], [111, z(97.3)], [ROOF_FRONT - 4, roofZ(ROOF_FRONT - 4) - 3.05], [ROOF_FRONT, roofZ(ROOF_FRONT) - 3.05]]],
    ["bpillar", [[-36, beltZ(-36)], [-44, beltZ(-44)], [-44, roofZ(-44) - 3.05], [-36, roofZ(-36) - 3.05]]],
    ["dpillar", [[-176, beltZ(-176)], [-HALF_L + 18, z(110)], [ROOF_BACK, roofZ(ROOF_BACK) - 3.05], [-166, roofZ(-166) - 3.05]]],
  ];
  for (const [name, poly] of PILLARS) side("body", `body.${name}.${tag}`, poly, p0, p1, { tone: "hi" });
  const [g0, g1] = sy > 0 ? [yIn + 1, yIn + 2] : [-yIn - 2, -yIn - 1];
  side("body", `body.window.front.${tag}`, [[108, beltZ(108) + 0.3], [-35, beltZ(-35)], [-35, roofZ(-35) - 3.05], [ROOF_FRONT - 7, roofZ(ROOF_FRONT - 7) - 3.05]], g0, g1, { tone: "faint" }, { attrs: ' data-glass=""' });
  side("body", `body.window.rear.${tag}`, [[-44, beltZ(-44)], [-176, beltZ(-176)], [-166, roofZ(-166) - 3.05], [-44, roofZ(-44) - 3.05]], g0, g1, { tone: "faint" }, { attrs: ' data-glass=""' });
  // roof rail along the top of the side glass
  const roofPts = Array.from({ length: 12 }, (_, i) => ROOF_FRONT + ((ROOF_BACK - ROOF_FRONT) * i) / 11);
  const [r0, r1] = sy > 0 ? [yIn, yIn + 3] : [-yIn - 3, -yIn];
  side("body", `body.roofrail.${tag}`, [...roofPts.map((x) => [x, roofZ(x) + 0.6]), ...[...roofPts].reverse().map((x) => [x, roofZ(x) - 3])], r0, r1, { tone: "hi" });
  // mirror on a stalk at the A-pillar foot
  const [m0, m1] = sy > 0 ? [yIn + 3, IN + 10] : [-IN - 10, -yIn - 3];
  side("body", `body.mirror.${tag}`, [[108, beltZ(108)], [94, beltZ(94)], [94, z(106)], [104, z(107.4)]], m0, m1, { tone: "hi" });
  // lamps: a slim headlamp bar in the nose, a tail lamp bar across the tail
  const [h0, h1] = sy > 0 ? [40, IN - 6] : [-IN + 6, -40];
  box("body", `body.headlamp.${tag}`, [HALF_L - 0.75, h0, z(60)], [HALF_L + 0.6, h1, z(65)], { tone: "hi" }, { r: 0.6, attrs: ' data-lamp="head"' });
}
// floor pan between the sills, firewall, nose, hood, tail
side("cabin", "cabin.floor", [[BAT.x0, BAT.z1 + 0.05], [98, BAT.z1 + 0.05], [98, BAT.z1 + 1.1], [BAT.x0, BAT.z1 + 1.1]], -62, 62, { tone: "lo" });
side("body", "body.firewall", [[98, BAT.z1 + 0.05], [101, BAT.z1 + 0.05], [101, z(92)], [98, z(92)]], -62, 62, { tone: "lo" });
side("body", "body.nose", [[HALF_L - 6, z(20)], [HALF_L, z(44)], [HALF_L - 1, z(70)], [HALF_L - 4, z(78)], [HALF_L - 12, z(82.3)], [HALF_L - 22, z(83.6)], [HALF_L - 24, z(20)]], -IN, IN, { tone: "hi" }, {
  extra: Ln(path3([[HALF_L - 6 / 26, -IN, z(50)], [HALF_L - 6 / 26, IN, z(50)]]) + path3([[HALF_L - 14 / 26, -IN, z(58)], [HALF_L - 14 / 26, IN, z(58)]]), { tone: "faint" }),
});
// the grille: two upright panels in the nose face, closed (an electric car needs little air)
for (const sy of [-1, 1]) box("body", "body.grille", [HALF_L - 0.1, sy > 0 ? 3 : -30, z(46)], [HALF_L + 1.6, sy > 0 ? 30 : -3, z(58)], { tone: "mid" }, { r: 1.4, steps: 3, extra: "" });
side("body", "body.hood", [[HALF_L - 11, z(84)], [118, z(99)], [118, z(97.4)], [HALF_L - 12, z(82.4)]], -IN, IN, { tone: "hi" }, { extra: "" });
side("body", "body.tail", [[-HALF_L, z(96)], [-HALF_L + 4, z(110)], [-HALF_L + 18, z(110)], [-HALF_L + 18, z(20)], [-HALF_L + 8, z(20)], [-HALF_L + 1, z(44)]], -IN, IN, { tone: "hi" });
box("body", "body.taillamp", [-HALF_L - 1.6, -IN + 6, z(88)], [-HALF_L + 0.2, IN - 6, z(92)], { tone: "hi" }, { r: 0.5, attrs: ' data-lamp="tail"' });
side("body", "body.screen", [[118, z(99)], [ROOF_FRONT, roofZ(ROOF_FRONT)], [ROOF_FRONT - 1, roofZ(ROOF_FRONT) - 1.4], [116, z(96)]], -yIn, yIn, { tone: "faint" }, { attrs: ' data-glass=""' });
{
  const roofPts = Array.from({ length: 12 }, (_, i) => ROOF_FRONT - 1.4 + ((ROOF_BACK + 1.4 - ROOF_FRONT + 1.4) * i) / 11);
  side("body", "body.roof", [...roofPts.map((x) => [x, roofZ(x)]), ...[...roofPts].reverse().map((x) => [x, roofZ(x) - 1.6])], -yIn, yIn, { tone: "faint" }, { attrs: ' data-glass=""' });
}
side("body", "body.bow", [[-22, roofZ(-22) - 1.6], [-16, roofZ(-16) - 1.6], [-16, roofZ(-16) - 5.2], [-22, roofZ(-22) - 5.2]], -yIn, yIn, { tone: "mid" });
side("body", "body.backglass", [[ROOF_BACK, roofZ(ROOF_BACK)], [-HALF_L + 4.5, z(111.6)], [-HALF_L + 6.5, z(110.05)], [ROOF_BACK + 1, roofZ(ROOF_BACK) - 1.4]], -yIn, yIn, { tone: "faint" }, { attrs: ' data-glass=""' });
// charge port in the near rear wing, behind a hinged flap
const PORT = [-206, HALF_W, z(88)];
box("body", "body.chargeport", [-212, IN - 7, z(83)], [-200, IN, z(93)], { tone: "mid" }, { r: 1, steps: 3, bevel: 0.3 });

// ---------- the DC charger on the bench, its cable into the port ----------
const CHG = { x: -216, y: 109, w: 20, d: 12, r: 2 };
box("stand", "stand.charger.foot", [CHG.x - 2, CHG.y - 2, 0], [CHG.x + CHG.w + 2, CHG.y + CHG.d + 2, 3], { tone: "lo" }, { r: 2.6, steps: 3 });
box("stand", "stand.charger", [CHG.x, CHG.y, 3], [CHG.x + CHG.w, CHG.y + CHG.d, 112], { tone: "mid" }, {
  r: 2,
  steps: 4,
  bevel: 0.6,
  inner: Ln(k.sideSeam(CHG, 20, P, 4) + k.sideSeam(CHG, 106, P, 4), { tone: "faint" }),
  extra: Dots(k.corners(CHG, 2.4).map(([x, y]) => at([x, y, 112])), { size: 0.45 }),
});
{
  // the screen on the charger's front face (facing +x), with its readout
  const m = planeMatrix([CHG.x + 2, CHG.y + CHG.d + 0.05, 102], [1, 0, 0], [0, 0, -1]);
  put("stand", "stand.charger.screen", [CHG.x + 10, CHG.y + CHG.d, 94], `<g transform="${m}"><rect class="cx-window" x="0" y="0" width="16" height="14" rx="1"/><text class="cx-digits" data-charger="pct" x="8" y="6.6" font-size="5.6" text-anchor="middle">--%</text><text class="cx-digits cx-small" data-charger="kw" x="8" y="11.6" font-size="3.2" text-anchor="middle">0 kW</text></g>`, [record(A.box([CHG.x + 2, CHG.y + CHG.d, 88], [CHG.x + 18, CHG.y + CHG.d + 0.05, 102], { name: "stand.charger.screen" }))], { bias: 0.3 });
}
line("stand", "charge.cable", [[PORT[0], CHG.y, PORT[2]], [PORT[0], HALF_W, PORT[2]]], 1.9, { tone: "mid", bend: 9, shells: [false, true], free: [false, true], limp: true, attrs: ' data-charge=""' });

function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}

// ---------- high-voltage lines: battery to each inverter ----------
for (const [piece, sx, top] of [["front", 1, FRONT.top], ["rear", -1, REAR.top]]) {
  const face = sx * BAT.x1;
  const inv = sx * (AX - 12);
  line(piece, `hv.${piece}`, [[face, -16, BAT.z0 + 7], [sx * 111, -16, BAT.z0 + 7], [sx * 111, -16, top + 4], [inv, -16, top + 4]], 1.3, { tone: "mid", shells: [true, true], bend: 5, free: [true, false] });
}

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const unit = (vector) => {
  const o = at([0, 0, 0]);
  const p = at(vector);
  return [p[0] - o[0], p[1] - o[1]];
};
const groups = R.items.map((item, index) => {
  const [mx, my, mz] = item.move;
  return `<g class="it" data-piece="${item.piece}" data-name="${item.name}" data-k="${item.key.toFixed(3)}" data-m="${mx.toFixed(1)},${my.toFixed(1)},${mz.toFixed(1)}" data-i="${index}"${item.attrs ?? ""}>${item.svg}</g>`;
});

const LABEL_TEXT =
  "A BMW iX3, the 2025 Neue Klasse electric SUV, as a 1:10 model on a bench, standing on two turn plates and two slip plates beside a DC charger whose cable is plugged into the rear wing. Through the glass you see the seats and steering wheel; taken apart, the body lifts off to show the flat battery under the floor, its cylindrical cells showing through the open half of the lid, the front and rear drive units with their inverters and half shafts, four suspension corners with struts, coil springs, brake discs and 20-inch wheels, the seats, dashboard and steering wheel, and the high-voltage lines from the battery to each inverter.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="cx-car">${groups.join("")}</g>`] });

const DATA = {
  P,
  V,
  EX: unit([1, 0, 0]),
  EY: unit([0, 1, 0]),
  EZ: unit([0, 0, 1]),
  pieces: Object.fromEntries(Object.entries(PIECES).map(([id, p]) => [id, { name: p.name, say: p.say }])),
  stagger: STAGGER,
  spring: SPRING,
  wheels: WHEELS,
  cells: cellCols.length,
  routes: ROUTES,
};

const CSS = readFileSync(join(HERE, "ix3.css"), "utf8");
const MODEL = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const latheSource = readFileSync(join(HERE, "..", "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
const latheScript = `const GL = (() => {${latheSource}\nreturn { spokesOf };})();\n`;
const PARTS_BUTTONS = ["body", "cabin", "battery", "front", "rear", "fl"]
  .map((id, i) => `<button type="button" class="cx-part" data-part="${id}">${String(i + 1).padStart(2, "0")} ${PIECES[id].name}</button>`)
  .join("");

const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 2",
    title: "BMW iX3 on the bench",
    hint: "space apart · D drive · C charge",
    readout: `parked · 80% · ${Math.round(CAR.range * 0.8)} km`,
    keys: [
      { mark: "lit", label: "What is working now: the battery's cells as they charge, the wheels and motors as it drives, a part you pick" },
      { mark: "raised", label: "Body shell: it lifts off when the car comes apart; the glass shows the cabin" },
      { mark: "edge", label: "High-voltage lines: battery to each inverter, and the charger's cable to the port" },
    ],
    caption:
      `The BMW iX3 50 xDrive, first car of the Neue Klasse (2025), at 1 : 10 on a workshop bench. It is ${CAR.length.toLocaleString("en-US")} mm long on a ${CAR.wheelbase.toLocaleString("en-US")} mm wheelbase and weighs ${CAR.kerb.toLocaleString("en-US")} kg. A ${CAR.battery} kWh, ${CAR.volts} V battery of cylindrical cells, packed straight into the floor without modules, feeds an induction motor at the front and an electrically excited synchronous motor at the rear: ${CAR.power} kW and ${CAR.torque} N·m together, 0–100 km/h in ${CAR.sprint} s, ${CAR.top} km/h top speed. On a ${CAR.peakCharge} kW charger it goes from 10 to 80% in ${CAR.charge10to80} minutes; its WLTP range is up to ${CAR.range} km. Drive runs a 0–100 sprint from a model of the car's mass and power, tuned to BMW's time; Charge plays the 21 minutes as a time-lapse on an illustrative charging curve with BMW's peak and total. Take it apart to see its eight assemblies.`,
    body: `<div class="iso-stage cx-stage" tabindex="0" role="group" aria-label="BMW iX3 model. Space takes it apart or puts it together; D runs a 0 to 100 sprint; C charges from 10 to 80 percent; arrow keys pick an assembly; Escape clears.">${svg}<span class="cx-sr" role="status" aria-live="polite" data-status></span></div>`,
  });

const CREDIT = `<style>.credit{margin:40px 0 0;color:var(--anatomy-muted);font:11px/1.4 var(--anatomy-mono);letter-spacing:.04em}.credit a{color:var(--anatomy-text);text-decoration:none;border-bottom:1px solid var(--anatomy-faint)}.credit a:hover{color:var(--anatomy-strong);border-color:var(--anatomy-mid)}</style><p class="credit">Made by <a href="https://www.littlenicethings.com/">Studio Little Nice Things</a> · <a href="https://buymeacoffee.com/littlenicethings">Support future experiments ☕️</a></p>`;
const page = k.pageHtml({ title: "BMW iX3 on the bench", theme: THEME, body: body.replace('</figure>', `<div class="cx-parts">${PARTS_BUTTONS}</div></figure>`) + CREDIT, script: kitScript() + latheScript + MODEL + LIVE, width: 720 });
const name = THEME === "light" ? "ix3-light.html" : "ix3.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `${R.solids.length} solids`, `scale ${KS.toFixed(3)}`);

A.auditOrExit(R, P, {});
