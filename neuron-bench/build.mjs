import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";
import { kitScript } from "../scripts/inline-kit.mjs";
import { NEURON, SYN, DELAY, SLOW } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";

const W = 600;
const H = 420;
const AZIMUTH = 58;

const PLATE = { x: -168, y: -74, w: 356, d: 148, r: 9 };
const PLATE_H = 12;
const FOOT_H = 5;

// Sensory neurons stand in a row along y; index 0 food, 1 bell, 2 light.
const SX = -125;
const SY = [-38, 38, 0];
const ZB_SENSE = 6; // foot collar of a sensory tank sits on its pedestal
const BLOCK = { x: 70, y: -50, w: 52, d: 100, r: 3 };
const BLOCK_H = 18;
const DX = 96;
const DY = 0;
const ZB_D = BLOCK_H;
const PORT_Z = 9;
const DROP_X = -45;
const HIGH_Z = 118;
const VALVE_X = 22;
const LINE_R = 2.4;
const COUNTER = { x: 140, y: -13, w: 26, d: 26, r: 2 };
const COUNTER_H = 30;
const OUT_X = 153;

// One tank: glass tube between two collars, a cap with the axon boss, and a mV scale beside it.
const GLASS_R = 8;
const FLUID_R = 7;
const COLLAR_R = 11;
const GLASS_H = 78;
const V_LO = -90;
const V_HI = 50;
const fluidZ = (zb, v) => zb + 8 + ((v - V_LO) / (V_HI - V_LO)) * 72;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [SX, SY[0], HIGH_Z + 3], [SX, SY[1], HIGH_Z + 3], [DX, DY, 129], [OUT_X, 0, 129], [DROP_X, SY[1], HIGH_Z + 3]],
  W,
  H,
  { pad: 26, azimuth: AZIMUTH },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const f2 = (v) => Math.round(v * 100) / 100;

const R = A.recorder(P);
const record = R.solid;
function put(name, ref, svg, shapes = [], { bias = 0, attrs = "", ...rest } = {}) {
  return R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes, piece: "bench", attrs, ...rest });
}
function box(name, plan, z, h, style = {}, { steps = 3, bevel = 0.5, extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const shape = record(A.slab(plan, z, h, { name }, steps));
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function cyl(name, cx, cy, r, z, h, style = {}, { steps = 40, bevel = 0, extra = "", inner = "", bias = 0, attrs = "" } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z, h, { name }));
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
  return shape;
}
function disc(name, F, s0, s1, r, style = {}, { extra = "", bias = 0, owner, attrs = "" } = {}) {
  const shape = record(A.disc(F, s0, s1, r, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P), { tone: "mid", ...style }) + extra, [shape], { bias, attrs });
  return shape;
}

// Pipes: flanged both ends, chunks depth-sorted, each chunk tagged with its arc-length span for the live pulse.
const ROUTES = {};
function pipe(name, control, r, { flangeR = r * 1.8, gaps: extra = [], tone = "hi", bend = 8, touch } = {}) {
  const line = G.fillet(control, Math.max(r * 2.6, bend), 12, { P, tube: r });
  const total = G.pathLength(line);
  const thick = 1.2;
  const flanges = [
    { centre: G.add3(line[0], G.mul3(G.tangentAlong(line, 0), thick / 2)), axis: G.tangentAlong(line, 0) },
    { centre: G.add3(line[line.length - 1], G.mul3(G.tangentAlong(line, total), -thick / 2)), axis: G.tangentAlong(line, total) },
  ];
  const gaps = [[0, thick], [total - thick, total], ...extra];
  R.route(name, line, r, { owner: name, gaps, touch, rims: [flangeR, flangeR], piece: "bench" });
  tubePieces(line, r, P, { maxLength: 9, spacing: 1.2, gaps }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { route: name, chunk: index, attrs: ` data-route="${name}" data-from="${f2(piece.from)}" data-to="${f2(piece.to)}"` }),
  );
  flanges.forEach(({ centre, axis }, index) => {
    const F = G.frameAlong(centre, axis);
    disc(`${name}.flange${index}`, F, -thick / 2, thick / 2, flangeR, { tone: "mid" }, { owner: name });
  });
  ROUTES[name] = { total: f2(total) };
  return { line, total };
}

const back = [];

// Base plate on feet, with groove, screws, a ruler strip and a label plate.
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 10);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: PLATE.x + 24, y: PLATE.y + PLATE.d - 12, w: PLATE.w - 48, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
const LABEL = { x: -60, y: PLATE.y + PLATE.d - 34, w: 34, d: 14, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(Ln([22, 15, 18].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.6 + i * 3.2], [LABEL.x + 4 + w, LABEL.y + 3.6 + i * 3.2], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));

// A tank neuron. The fluid column is the membrane potential, read against the scale.
const TANKS = [];
function tank(id, index, cx, cy, zb) {
  const view = Math.atan2(k.towardViewer(P)[1], k.towardViewer(P)[0]);
  cyl(`${id}.foot`, cx, cy, COLLAR_R, zb, 5, { tone: "mid" }, { bevel: 0.6, inner: Ln(k.sideArc(cx, cy, COLLAR_R, zb + 2.5, P, 32), { tone: "faint" }) });
  const g0 = zb + 5;
  const g1 = g0 + GLASS_H;
  const glints = [0.5, 0.78].map((da) => k.segment([cx + GLASS_R * Math.cos(view + da), cy + GLASS_R * Math.sin(view + da), g0], [cx + GLASS_R * Math.cos(view + da), cy + GLASS_R * Math.sin(view + da), g1], P)).join("");
  const rest = fluidZ(zb, NEURON.rest);
  const fluid = S(k.cylinder(cx, cy, FLUID_R, g0 + 0.3, rest - g0 - 0.3, P, 40), { tone: "hi" });
  put(`${id}.glass`, [cx, cy, (g0 + g1) / 2], `<g class="nb-glass">${S(k.cylinder(cx, cy, GLASS_R, g0, GLASS_H, P, 48), { tone: "lo", crease: "none" })}</g><g class="nb-fluid" data-fluid="${index}">${fluid}</g>${Ln(glints, { tone: "faint", className: "nb-glint" })}`, [record(A.cylinder(cx, cy, GLASS_R, g0, GLASS_H, { name: `${id}.glass` }))]);
  const boltRing = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + Math.PI / 8).map((a) => at([cx + 9.7 * Math.cos(a), cy + 9.7 * Math.sin(a), g1 + 5]));
  cyl(`${id}.collar`, cx, cy, COLLAR_R, g1, 5, { tone: "mid" }, { bevel: 0.6, extra: Dots(boltRing, { size: 0.45, tone: "mid" }) });
  cyl(`${id}.cap`, cx, cy, 8.5, g1 + 5, 4, { tone: "mid" }, { bevel: 0.5 });
  cyl(`${id}.boss`, cx, cy, 4.8, g1 + 9, 3, { tone: "mid" });
  // the scale: a strip standing tangent to both collars, ticks every 10 mV on its front face
  const strip = { x: cx + COLLAR_R, y: cy - 1.6, w: 4, d: 3.2, r: 0.5 };
  const face = cy + 1.6;
  const edge = strip.x + strip.w;
  const minor = [];
  const major = [];
  for (let v = V_LO; v <= V_HI; v += 10) {
    const z = fluidZ(zb, v);
    const big = v % 50 === 0;
    (big ? major : minor).push(k.segment([strip.x, face, z], [strip.x + (big ? 2.6 : 1.4), face, z], P));
  }
  const restTick = k.segment([edge, face, rest], [strip.x, face, rest], P);
  const stripTop = g1 + 5;
  box(`${id}.scale`, strip, zb, stripTop - zb, { tone: "mid" }, {
    steps: 2,
    bevel: 0.3,
    extra: Ln(minor.join(""), { tone: "lo" }) + Ln(major.join(""), { tone: "mid" }) + Ln(restTick, { tone: "hi" }) + Dots([at([cx + COLLAR_R + 2, face, zb + 2.5]), at([cx + COLLAR_R + 2, face, stripTop - 2.5])], { size: 0.45, tone: "mid" }),
  });
  const th = fluidZ(zb, NEURON.threshold);
  box(`${id}.threshold`, { x: edge, y: cy - 1.1, w: 2, d: 2.2, r: 0.3 }, th - 0.7, 1.4, { tone: "hi" }, { steps: 2, bevel: 0 });
  TANKS[index] = { cx, cy, zb, g0, top: g1 + 12 };
}

// Sensory neurons, each on a pedestal with a stimulus key wired to it.
const KEYS = [];
SY.forEach((cy, index) => {
  const id = `sense${index}`;
  const ped = { x: SX - 15, y: cy - 15, w: 30, d: 30, r: 3 };
  const screws = k.corners(ped, 3.4);
  box(`${id}.pedestal`, ped, 0, ZB_SENSE, { tone: "mid" }, { bevel: 0.6, steps: 4, inner: Ln(k.sideSeam(ped, 2.4, P, 4), { tone: "faint" }), extra: Dots(screws.map(([x, y]) => at([x, y, ZB_SENSE])), { size: 0.5, tone: "mid" }) });
  tank(id, index, SX, cy, ZB_SENSE);
  const key = { x: SX + 24, y: cy - 7, w: 16, d: 14, r: 2 };
  box(`${id}.keybox`, key, 0, 7, { tone: "mid" }, { bevel: 0.5, steps: 3, extra: Ln(k.planOutline(k.insetPlan(key, 1.6), 7, P, 3), { tone: "faint" }) + Dots([at([key.x + 2.2, key.y + 2.2, 7]), at([key.x + key.w - 2.2, key.y + key.d - 2.2, 7])], { size: 0.45 }) });
  const kx = key.x + key.w / 2;
  cyl(`${id}.bezel`, kx, cy, 4.8, 7, 1, { tone: "lo" });
  const capShape = record(A.cylinder(kx, cy, 3.6, 8, 2.4, { name: `${id}.button` }));
  put(`${id}.button`, [kx, cy, 9.2], `<g data-key="${index}" class="nb-key">${S(k.cylinder(kx, cy, 3.6, 8, 2.4, P, 32, 0.4), { tone: "hi" })}${Ln(k.ring(kx, cy, 2.2, 10.4, P, 24), { tone: "lo" })}</g>`, [capShape], { bias: 0.2 });
  // the sensory nerve: a short cable from the key to the pedestal
  const wire = [[key.x, cy, 3.5], [ped.x + ped.w, cy, 3.5]];
  R.route(`${id}.nerve`, wire, 0.7, { owner: `${id}.nerve`, limp: true, piece: "bench" });
  tubePieces(wire, 0.7, P, { maxLength: 9 }).forEach((piece, i) => put(`${id}.nerve:${i}`, piece.mid, tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { route: `${id}.nerve`, chunk: i }));
  KEYS[index] = { x: kx, y: cy };
});

// Neuron D on its dendrite block; the three input lines land on the block's face.
const blockScrews = k.corners(BLOCK, 4);
box("dblock", BLOCK, 0, BLOCK_H, { tone: "mid" }, {
  steps: 4,
  bevel: 0.8,
  inner: Ln(k.sideSeam(BLOCK, 4, P, 4), { tone: "faint" }),
  extra: Ln(k.planOutline(k.insetPlan(BLOCK, 3.4), BLOCK_H, P, 4), { tone: "faint" }) + Dots(blockScrews.map(([x, y]) => at([x, y, BLOCK_H])), { size: 0.5, tone: "mid" }),
});
tank("d", 3, DX, DY, ZB_D);

// The leak: a needle valve on the block's front face, open to the bench.
{
  const F = G.frameAlong([110, BLOCK.y + BLOCK.d, 9], [0, 1, 0]);
  disc("leak.boss", F, 0, 1.6, 3.2, { tone: "mid" });
  disc("leak.body", F, 1.6, 4.2, 1.8, { tone: "mid" });
  const KF = G.frameAlong([110, BLOCK.y + BLOCK.d + 4.2, 9], [0, 1, 0]);
  disc("leak.knob", KF, 0, 2.4, 2.6, { tone: "hi" }, { extra: k.fadedSvg(G.ribsOf(KF, 0, 2.4, 2.6, 22, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
}

// Input lines (axons) with a synapse valve near D on each low leg.
const VALVES = [];
SY.forEach((cy, index) => {
  const name = `axon${index}`;
  const control = [[SX, cy, TANKS[index].top], [SX, cy, HIGH_Z], [DROP_X, cy, HIGH_Z], [DROP_X, cy, PORT_Z], [BLOCK.x, cy, PORT_Z]];
  const probe = G.fillet(control, 8, 12, { P, tube: LINE_R });
  const total = G.pathLength(probe);
  const along = total - (BLOCK.x - VALVE_X);
  const half = LINE_R * 2.4;
  const { line } = pipe(name, control, LINE_R, { gaps: [[along - half, along + half]], touch: [`rest${index}`] });
  const centre = G.pointAlong(line, along);
  const F = G.frameAlong(centre, [1, 0, 0]);
  const r = LINE_R;
  const crown = r * 1.85 * 1.08;
  const bulge = (x) => r * 1.45 + (crown - r * 1.45) * Math.sqrt(Math.max(0, 1 - (x / (r * 1.6)) ** 2));
  const bulgeSlope = (x) => {
    if (Math.abs(x) >= r * 1.6 - 1e-9) return 0;
    const t = Math.max(-0.995, Math.min(0.995, x / (r * 1.6)));
    return (-(crown - r * 1.45) * t) / (r * 1.6 * Math.sqrt(1 - t * t));
  };
  const meridian = [[-half, 0], [-half, r * 1.45], ...Array.from({ length: 17 }, (_, i) => {
    const x = r * 1.6 * Math.sin(((i - 8) / 8) * (Math.PI / 2));
    return [x, bulge(x), 1];
  }), [half, r * 1.45], [half, 0]];
  const ends = [...G.dotsOf(F, -half, r * 1.2, 8, P, { all: true }), ...G.dotsOf(F, half, r * 1.2, 8, P, { all: true })].filter((_, i) => i % 2 === 0);
  put(`syn${index}.body`, centre, `<g class="nb-valve" data-valve="${index}">${S(G.lathe(meridian, F, P, { steps: 36, smooth: { slope: bulgeSlope, rows: 3 } }), { tone: "hi" })}${Dots(ends, { size: 0.4, tone: "mid" })}</g>`, [record(A.body(F, meridian, { name: `syn${index}.body`, owner: name }))]);
  const neck0 = PORT_Z + crown - 0.3;
  const neck1 = neck0 + 2.6;
  cyl(`syn${index}.neck`, VALVE_X, cy, 1.5, neck0, neck1 - neck0, { tone: "mid" }, { steps: 20 });
  const DR = 10.5;
  const dial0 = neck1;
  const dialTop = dial0 + 5;
  const dt = k.radialTicks(VALVE_X, cy, DR - 2.4, 20, 5, dialTop, [1, 1.9], P, -0.75 * Math.PI, 1.5 * Math.PI);
  cyl(`syn${index}.dial`, VALVE_X, cy, DR, dial0, 5, { tone: "hi" }, {
    steps: 64,
    bevel: 0.6,
    extra:
      Ln(k.knurl(VALVE_X, cy, DR, dialTop - 2.2, dialTop, 60, P, 0.3), { tone: "lo" }) +
      Ln(k.ring(VALVE_X, cy, DR - 2.4, dialTop, P, 64), { tone: "lo" }) +
      Ln(dt.minor, { tone: "lo" }) +
      Ln(dt.major, { tone: "mid" }) +
      Ln(k.ring(VALVE_X, cy, 1.3, dialTop, P, 16), { tone: "mid" }),
    inner: Ln(k.sideArc(VALVE_X, cy, DR, dialTop - 2.2, P, 40), { tone: "faint" }),
  });
  VALVES[index] = { along: f2(along), x: VALVE_X, y: cy, top: dialTop, r: DR - 3 };
});

// Pipe rests: each low leg lies tangent on a saddle block screwed to the plate.
SY.forEach((cy, index) => {
  const plan = { x: -12, y: cy - 4.5, w: 9, d: 9, r: 1 };
  const top = PORT_Z - LINE_R;
  box(`rest${index}`, plan, 0, top, { tone: "lo" }, { steps: 2, bevel: 0.4, inner: Ln(k.sideSeam(plan, 1.6, P, 2), { tone: "faint" }), extra: Dots([at([plan.x + 1.8, cy, top]), at([plan.x + plan.w - 1.8, cy, top])], { size: 0.4, tone: "mid" }) });
});

// D's own axon, to the spike counter.
const OUT = pipe("axonD", [[DX, DY, TANKS[3].top], [DX, DY, 126], [OUT_X, 0, 126], [OUT_X, 0, COUNTER_H + 3]], 2, { flangeR: 3.6 });
box("counter", COUNTER, 0, COUNTER_H, { tone: "mid" }, {
  steps: 3,
  bevel: 0.6,
  inner: Ln(k.sideSeam(COUNTER, 6, P, 3), { tone: "faint" }),
  extra: Dots(k.corners(COUNTER, 2.6).map(([x, y]) => at([x, y, COUNTER_H])), { size: 0.45, tone: "mid" }),
});
{
  const KF = G.frameAlong([COUNTER.x + COUNTER.w, 0, 12], [1, 0, 0]);
  disc("counter.reset.boss", KF, 0, 1, 3.4, { tone: "mid" });
  const RF = G.frameAlong([COUNTER.x + COUNTER.w + 1, 0, 12], [1, 0, 0]);
  disc("counter.reset", RF, 0, 2.6, 2.4, { tone: "hi" }, { extra: k.fadedSvg(G.ribsOf(RF, 0, 2.6, 2.4, 20, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
}
cyl("counter.boss", OUT_X, 0, 4.6, COUNTER_H, 3, { tone: "mid" });
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
{
  const fy = COUNTER.y + COUNTER.d + 0.02;
  const m = planeMatrix([COUNTER.x + 5, fy, 22], [1, 0, 0], [0, 0, -1]);
  put("counter.window", [COUNTER.x + 13, fy, 18], `<g transform="${m}"><rect class="nb-window" x="0" y="0" width="16" height="9" rx="0.8"/><text class="nb-digits" data-count x="8" y="6.6" font-size="6.2" text-anchor="middle">000</text></g>`, [record(A.box([COUNTER.x + 5, fy - 0.05, 13], [COUNTER.x + 21, fy, 22], { name: "counter.window" }))], { bias: 0.3 });
}

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item) => `<g class="it" data-name="${item.name}"${item.attrs ?? ""}>${item.svg}</g>`);

const LABEL_TEXT =
  "A bench with four glass-tube neurons. In each tube the fluid level is the cell's membrane potential, read against a millivolt scale. Three sensory neurons, for food, a bell and a light, each have a stimulus key. Their axons are pipes that run over and down to a dendrite block under the fourth neuron, D, and each passes through a valve, the synapse, whose dial shows its strength. D's own axon runs to a spike counter.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="nb-bench">${groups.join("")}</g>`] });

const DATA = {
  P,
  slow: SLOW,
  tanks: TANKS.map(({ cx, cy, zb, g0 }) => ({ cx, cy, zb, g0 })),
  valves: VALVES,
  routes: ROUTES,
  fluidR: FLUID_R,
  range: [V_LO, V_HI],
};

const CSS = readFileSync(join(HERE, "neuron-bench.css"), "utf8");
const MODEL = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));

const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "A neuron that learns",
    hint: "1 food · 2 bell · 3 light · space pairs",
    readout: `rest · bell ${SYN.start[1].toFixed(1)} mV`,
    keys: [
      { mark: "lit", label: "A spike: the level jumps past threshold and a pulse runs down the axon" },
      { mark: "raised", label: "Synapse valves: the dial is the strength, in mV added to D per pulse" },
      { mark: "dim", label: "Leak: the needle valve that drains D back to rest" },
    ],
    caption:
      `How a brain works, one neuron at a time. Each tube is a nerve cell: inputs raise its voltage, a leak drains it back to −70 mV with a ${NEURON.tauM} ms time constant, and when it reaches about −55 mV it fires an all-or-nothing spike to about +40 mV, then is locked out for ${NEURON.refractory} ms. Neuron D starts out answering only food. Ring the bell just before the food four times and the bell's synapse strengthens each time (an input that arrives just before the cell fires grows stronger, Hebb's rule as measured by spike-timing-dependent plasticity), until the bell alone makes D fire. The light, never paired, stays at ${SYN.start[2]} mV. Your brain does this with about 86 billion neurons and some 100 trillion synapses, on roughly 20 watts. The bench runs ${SLOW} times slower than life.`,
    body: `<div class="iso-stage nb-stage" tabindex="0" role="group" aria-label="Neuron bench. Press 1 for food, 2 for the bell, 3 for the light, Space to ring the bell just before the food, and R to reset the synapses.">${svg}<span class="nb-sr" role="status" aria-live="polite" data-status></span></div>`,
  });

const CREDIT = `<style>.credit{margin:40px 0 0;color:var(--anatomy-muted);font:11px/1.4 var(--anatomy-mono);letter-spacing:.04em}.credit a{color:var(--anatomy-text);text-decoration:none;border-bottom:1px solid var(--anatomy-faint)}.credit a:hover{color:var(--anatomy-strong);border-color:var(--anatomy-mid)}</style><p class="credit">Made by <a href="https://www.littlenicethings.com/">Studio Little Nice Things</a> · <a href="https://buymeacoffee.com/littlenicethings">Support future experiments ☕️</a></p>`;
const page = k.pageHtml({ title: "Neuron bench", theme: THEME, body: body + CREDIT, script: kitScript() + MODEL + LIVE, width: 680 });
const name = THEME === "light" ? "neuron-bench-light.html" : "neuron-bench.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `${R.solids.length} solids`, `scale ${KS.toFixed(3)}`);

// Each axon rises coaxially off its tank's cap boss; the tall glass counts as a "rod" for crowding. Checked at 8x.
A.auditOrExit(R, P, { crowd: [["axon0", "sense0.glass"], ["axon1", "sense1.glass"], ["axon2", "sense2.glass"], ["axonD", "d.glass"]] });
