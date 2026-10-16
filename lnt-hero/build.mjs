// A landing-page hero for Studio Little Nice Things: a watchmaker's bench block in walnut with a
// dark felt tray, a watch movement open in its holder, and one wheel — in the studio's mint —
// lifted out of its jewel by a pair of tweezers. Small, precise parts, put together with care.
// The art sits in the right of a 1200 × 640 canvas; the left stays free for the headline.
//
//   node build.mjs            light (#f7f7f7, the site's page) → lnt-hero.svg, lnt-hero.html
//   node build.mjs --dark     dark                              → lnt-hero-dark.svg, lnt-hero-dark.html
//   node build.mjs --audit    prove the geometry

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";
import * as a from "../kit/asset.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const dark = process.argv.includes("--dark");
const PAPER = dark ? "#0e1011" : "#f7f7f7";
const MINT = "#8acbc7";

const W = 1200;
const H = 640;
const SAFE = { x: 0, y: 0, w: 480, h: H };
const REGION = { x: 510, y: 24, w: 664, h: 592 };

// ---------- world: x to the lower right, y to the lower left, z up; 1 unit ≈ 0.25 mm ----------
const BLOCK = { x: -108, y: -96, w: 216, d: 176, r: 9 };
const BLOCK_Z = 26;
const TRAY = { x: -94, y: -82, w: 152, d: 152, r: 10 };
const FELT_Z = BLOCK_Z + 5;
const HOLD = [-18, -4]; // movement centre
const HOLD_R = 60;
const PLATE_R = 50;
const Z0 = FELT_Z + 9 + 4; // top of the main plate
const STAND = [86, -58];
const LOUPE_TOP = [-6, -42, 92];

const fitPts = [...k.boxCorners(BLOCK, -6, BLOCK_Z), [STAND[0], STAND[1], 118], [LOUPE_TOP[0], LOUPE_TOP[1], 104], [-30, -18, 178]];
const P = a.fitInto(fitPts, REGION, { pad: 6, azimuth: 42, elevation: 36 });
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (pts, style) => k.dotsSvg(pts, style);
const path3 = (pts, closed = false) => k.pathOf(pts.map(at), closed);
const UP = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);

// ---------- recording: every part goes in with its true shape; the audit settles the order ----------
const LIFTED = new Set(["lift.wheel", "lift.pinion", "tw.bladeA", "tw.bladeB", "tw.joint"]);
const R = A.recorder(P, { ground: (shape) => A.grounded(shape) || LIFTED.has(shape.name) });
let tone = "";
function put(name, ref, svg, shapes = [], { bias = 0, cls = tone } = {}) {
  return R.put({ piece: "hero", name: R.nameFor(name), at: ref, bias, svg, shapes, cls });
}
const rec = (shape) => R.solid(shape);
const box = (name, plan, z0, h, style = {}, { steps = 4, bevel = 0.4, extra = "", inner = "", bias = 0, cls } = {}) =>
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + h / 2], S(k.slabOf(plan, z0, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [rec(A.slab(plan, z0, h, { name }, steps))], { bias, cls });
const cyl = (name, cx, cy, r, z, h, style = {}, { steps = 40, bevel = 0, extra = "", inner = "", bias = 0, cls } = {}) =>
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [rec(A.cylinder(cx, cy, r, z, h, { name }))], { bias, cls });
const extr = (name, ring, z, h, style = {}, { extra = "", bias = 0, convex = false, cls } = {}) => {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return put(name, [cx, cy, z + h / 2], S(k.extrude(ring, z, h, P, { convex }), { tone: "mid", ...style }) + extra, [rec(A.extruded(ring, z, h, { name }))], { bias, cls });
};
const turned = (name, F, profile, style = {}, { extra = "", bias = 0, cls } = {}) => {
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  return put(name, G.add3(F.o, G.mul3(F.a, mid)), S(G.solidOf(profile, F, P), { tone: "mid", ...style }) + extra, [rec(A.solid(F, profile, { name }))], { bias, cls });
};
const rod = (name, from, to, r, style = {}, { cls } = {}) => {
  const d = G.sub3(to, from);
  const len = G.len3(d);
  const F = G.frameAlong(from, G.unit3(d));
  return put(name, G.lerp3(from, to, 0.5), S(G.disc(0, len, r, F, P), { tone: "mid", ...style }), [rec(A.disc(F, 0, len, r, { name }))], { cls });
};

// a blob: the convex hull of circles, the outline of a bridge or a cock
const blob = (circles, steps = 20) => G.hullOf(circles.flatMap(([x, y, r]) => Array.from({ length: steps }, (_, i) => [x + r * Math.cos((i / steps) * Math.PI * 2), y + r * Math.sin((i / steps) * Math.PI * 2)])));
// a toothed wheel's outline
const gearRing = (cx, cy, r, teeth, phase = 0) => {
  const out = [];
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const t = phase + (i / n) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r - Math.max(0.9, r * 0.09);
    out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  return out;
};
// a wheel's crossing: the windows between its spokes, as filled paths on its top face
function windows(cx, cy, rIn, rOut, spokes, z, phase = 0) {
  const out = [];
  const half = (Math.PI / spokes) * 0.62;
  for (let i = 0; i < spokes; i++) {
    const c = phase + (i / spokes) * Math.PI * 2 + Math.PI / spokes;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const t = c - half + (2 * half * j) / 10;
      pts.push([cx + rOut * Math.cos(t), cy + rOut * Math.sin(t)]);
    }
    for (let j = 10; j >= 0; j--) {
      const t = c - half * 0.7 + (1.4 * half * j) / 10;
      pts.push([cx + rIn * Math.cos(t), cy + rIn * Math.sin(t)]);
    }
    out.push(k.pathOf(pts.map(([x, y]) => at([x, y, z + 0.02])), true));
  }
  return `<path class="lnt-window" d="${out.join("")}"/>`;
}
// a screw head on a top face: a ring, a slot ending on it, a dot
const screw = (x, y, z, r = 2.4, turn = 0.6) =>
  Ln(k.ring(x, y, r, z, P, 18), { tone: "mid" }) + Ln(k.lineOnTop([x - r * Math.cos(turn), y - r * Math.sin(turn)], [x + r * Math.cos(turn), y + r * Math.sin(turn)], z, P), { tone: "hi" });
// a jewel: a mint ring with a dark hole
const jewel = (x, y, z, r = 2.2) => `<g class="ac-jewel">${S(k.cylinder(x, y, r, z, 0.4, P, 20), { tone: "mid", crease: "none" })}${Dots([at([x, y, z + 0.4])], { size: 0.7, tone: "hi" })}</g>`;

// ---------- base: halo, feet, the walnut block ----------
const back = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BLOCK, -10), -6, 4, P)}"/>`];
tone = "ac-wood";
for (const [x, y] of k.corners(BLOCK, 22)) {
  cyl("stand.foot", x, y, 9, -6, 1.6, { tone: "lo" }, { steps: 28, cls: "ac-ebony" });
  cyl("stand.foot", x, y, 7, -4.4, 4.4, { tone: "mid" }, { steps: 28, cls: "ac-ebony" });
}
box("stand.block", BLOCK, 0, BLOCK_Z, { tone: "mid" }, {
  steps: 6,
  bevel: 1.4,
  inner: Ln(k.sideSeam(BLOCK, 5, P, 6), { tone: "faint" }),
  extra:
    Ln(k.planOutline(k.insetPlan(BLOCK, 5), BLOCK_Z, P, 6), { tone: "faint" }) +
    // a small brass plate on the front edge, its two screws
    "",
});
// the tray: a floor, the felt, four walls
tone = "ac-tray";
box("tray.floor", TRAY, BLOCK_Z, 2, { tone: "mid" }, { steps: 6 });
const FELT = k.insetPlan(TRAY, 5);
box("tray.felt", FELT, BLOCK_Z + 2, 3, { tone: "mid" }, { steps: 5, bevel: 0, cls: "ac-felt", extra: Ln(k.planOutline(k.insetPlan(FELT, 4), FELT_Z, P, 5), { tone: "lo", className: "lnt-stitch" }) });
const WALL = 5;
const WH = 8;
for (const [name, plan] of [
  ["tray.wallBack", { x: TRAY.x, y: TRAY.y, w: TRAY.w, d: WALL, r: 2 }],
  ["tray.wallLeft", { x: TRAY.x, y: TRAY.y + WALL, w: WALL, d: TRAY.d - 2 * WALL, r: 0.5 }],
  ["tray.wallRight", { x: TRAY.x + TRAY.w - WALL, y: TRAY.y + WALL, w: WALL, d: TRAY.d - 2 * WALL, r: 0.5 }],
  ["tray.wallFront", { x: TRAY.x, y: TRAY.y + TRAY.d - WALL, w: TRAY.w, d: WALL, r: 2 }],
]) box(name, plan, BLOCK_Z + 2, WH, { tone: "mid" }, { steps: 3, bevel: 0.5 });
tone = "";

// ---------- the movement holder: a ring on the felt with four clamp jaws ----------
const [hx, hy] = HOLD;
cyl("hold.ring", hx, hy, HOLD_R, FELT_Z, 9, { tone: "mid" }, { steps: 72, bevel: 0.8, inner: Ln(k.sideArc(hx, hy, HOLD_R, FELT_Z + 4.5, P, 72), { tone: "faint" }), extra: Ln(k.ring(hx, hy, HOLD_R - 4, FELT_Z + 9, P, 72), { tone: "faint" }) });
for (let i = 0; i < 4; i++) {
  const t = Math.PI / 4 + (i * Math.PI) / 2;
  const jx = hx + (PLATE_R + 6) * Math.cos(t);
  const jy = hy + (PLATE_R + 6) * Math.sin(t);
  const ring = [[-6, -4], [6, -4], [6, 4], [-6, 4]].map(([u, v]) => [jx + u * Math.cos(t) - v * Math.sin(t), jy + u * Math.sin(t) + v * Math.cos(t)]);
  extr("hold.jaw", ring, FELT_Z + 9, 5, { tone: "mid" }, { convex: true, extra: screw(jx + 2 * Math.cos(t), jy + 2 * Math.sin(t), FELT_Z + 14, 1.8, t) });
}

// ---------- the movement: main plate, wheels, bridges, balance ----------
const MOV = { x: hx, y: hy };
const p = (x, y) => [MOV.x + x, MOV.y + y];
const plateTop = Z0;
cyl("mov.plate", MOV.x, MOV.y, PLATE_R, Z0 - 4, 4, { tone: "hi" }, {
  steps: 80,
  cls: "ac-steel",
  bevel: 0.6,
  extra:
    Ln(k.ring(MOV.x, MOV.y, PLATE_R - 3, Z0, P, 80), { tone: "faint" }) +
    // perlage: overlapping circular graining, fading toward the plate's edge
    k.fadedSvg(
      (() => {
        const out = [];
        for (let i = -12; i <= 12; i++)
          for (let j = -12; j <= 12; j++) {
            const x = i * 4.2 + (j % 2) * 2.1;
            const y = j * 3.7;
            const r = Math.hypot(x, y);
            if (r > PLATE_R - 7) continue;
            out.push([k.ring(MOV.x + x, MOV.y + y, 2.6, Z0, P, 14), 0.32 * Math.min(1, (PLATE_R - 7 - r) / 10)]);
          }
        return out;
      })(),
      { tone: "faint" },
    ) +
    // the empty jewel of the lifted wheel, with the soft shadow the wheel throws on the plate
    `<path class="iso-halo lnt-lifthalo" d="${k.haloOf({ x: p(-26, 20)[0] - 11, y: p(-26, 20)[1] - 11, w: 22, d: 22, r: 11 }, Z0, 0.1, P)}"/>` +
    jewel(...p(-26, 20), Z0, 2.4),
});
// wheels under the bridges: barrel, centre, fourth, escape
const WHEELS = [
  { name: "mov.barrel", c: [-24, -20], r: 17, teeth: 40, spokes: 0, h: 4.5 },
  { name: "mov.centre", c: [6, -2], r: 11, teeth: 30, spokes: 4, h: 1.6 },
  { name: "mov.fourth", c: [24, 22], r: 8, teeth: 24, spokes: 4, h: 1.4 },
  { name: "mov.escape", c: [36, -2], r: 6, teeth: 15, spokes: 3, h: 1.2 },
];
for (const wl of WHEELS) {
  const [x, y] = p(...wl.c);
  const top = Z0 + 0.2 + wl.h;
  let extra = wl.spokes ? windows(x, y, wl.r * 0.3, wl.r * 0.72, wl.spokes, top, 0.4) + Ln(k.ring(x, y, wl.r * 0.72, top, P, 40), { tone: "lo" }) : Ln(k.ring(x, y, wl.r - 3, top, P, 48), { tone: "lo" }) + Ln(k.ring(x, y, wl.r * 0.45, top, P, 36), { tone: "faint" });
  extra += Dots([at([x, y, top])], { size: 0.8, tone: "hi" });
  extr(wl.name, gearRing(x, y, wl.r, wl.teeth), Z0 + 0.2, wl.h, { tone: "hi" }, { extra, cls: "ac-brass" });
  cyl(`${wl.name}.seat`, x, y, 2.6, Z0, 0.2, { tone: "lo" }, { steps: 16 });
}
// pillars and bridges; bridges stand 1 above the wheels on their pillars
const BR_Z = Z0 + 6.2;
const BR_H = 3.2;
const pillar = (x, y) => cyl("mov.pillar", x, y, 2.6, Z0, BR_Z - Z0, { tone: "mid" }, { steps: 18 });
function bridge(name, circles, pillars, jewels, screws) {
  const ring = blob(circles.map(([x, y, r]) => [...p(x, y), r]));
  for (const [x, y] of pillars) pillar(...p(x, y));
  const top = BR_Z + BR_H;
  const ins = blob(circles.map(([x, y, r]) => [...p(x, y), r - 1.6]));
  extr(name, ring, BR_Z, BR_H, { tone: "hi" }, {
    convex: true,
    cls: "ac-steel",
    extra: Ln(k.pathOf(ins.map(([x, y]) => at([x, y, top])), true), { tone: "faint" }) + jewels.map(([x, y]) => jewel(...p(x, y), top, 2.4)).join("") + screws.map(([x, y, t]) => screw(...p(x, y), top, 2.4, t)).join(""),
  });
}
bridge("mov.barrelBridge", [[-42, -6, 8], [-24, -20, 10], [-8, -34, 8]], [[-42, -6], [-8, -34]], [[-24, -20]], [[-42, -6, 0.4], [-8, -34, 1.9]]);
bridge("mov.trainBridge", [[0, -18, 6.5], [6, -2, 6.5], [24, 22, 6], [42, 12, 6.5]], [[0, -18], [42, 12]], [[6, -2], [24, 22]], [[0, -18, 2.4], [42, 12, 1.1]]);
// the balance: a rim under its cock, its arms swinging
const [bx, by] = p(10, -34);
const BAL_Z = Z0 + 1.2;
cyl("mov.balance", bx, by, 13, BAL_Z, 1.4, { tone: "hi" }, {
  steps: 56,
  cls: "ac-brass",
  extra: a.amSwing(
    `<circle class="lnt-arm" r="10.6"/><path class="lnt-arm" d="M-10.6 0H10.6M-5.3 -9.18L5.3 9.18M-5.3 9.18L5.3 -9.18"/><circle class="lnt-hub" r="2.2"/>` +
      Array.from({ length: 12 }, (_, i) => `<circle class="lnt-timing" cx="${(11.8 * Math.cos((i * Math.PI) / 6)).toFixed(2)}" cy="${(11.8 * Math.sin((i * Math.PI) / 6)).toFixed(2)}" r="0.55"/>`).join(""),
    a.planeMatrix([bx, by, BAL_Z + 1.45], [1, 0, 0], [0, 1, 0], P),
    { from: -150, to: 150, period: 1600 },
  ),
});
cyl("mov.balanceSeat", bx, by, 2.4, Z0, 1.2, { tone: "lo" }, { steps: 16 });
bridge("mov.cock", [[30, -28, 6.5], [10, -34, 5]], [[30, -28]], [[10, -34]], [[30, -28, 0.9]]);
// a crown wheel and ratchet on the barrel bridge, steel
{
  const [x, y] = p(-24, -20);
  const top = BR_Z + BR_H;
  extr("mov.ratchet", gearRing(x, y, 9, 28, 0.1), top, 1.6, { tone: "hi" }, { extra: Ln(k.ring(x, y, 5, top + 1.6, P, 32), { tone: "lo" }) + screw(x, y, top + 1.6, 2.6, 2.2) });
}
// the winding stem: out of the plate's edge toward the front
{
  const dir = G.unit3([0.26, 0.97, 0]);
  const o = [MOV.x + dir[0] * PLATE_R, MOV.y + dir[1] * PLATE_R, Z0 - 2];
  const F = G.frameAlong(o, dir);
  turned("mov.stem", F, [[0, 1.2], [10, 1.2], [10.1, 3.4], [11, 4.2, 1], [15, 4.2, 1], [15.9, 3.4], [16, 1.6], [18, 1.6]], { tone: "hi" }, { extra: k.fadedSvg(G.ribsOf(F, 11, 15, 4.2, 16, P, { fade: [0.15, 0.6] }), { tone: "lo" }) });
}

// ---------- the subject: the third wheel, lifted in the tweezers ----------
const [lx, ly] = p(-26, 20);
const LZ = Z0 + 36;
const LIFT = [];
{
  const ringPts = gearRing(lx, ly, 12.5, 40, 0.2);
  const top = LZ + 1.6;
  LIFT.push(put("lift.pinion", [lx, ly, LZ - 4], S(k.cylinder(lx, ly, 2, LZ - 8, 8, P, 16), { tone: "mid" }) + S(k.cylinder(lx, ly, 0.8, LZ - 11, 3, P, 12), { tone: "hi" }), [rec(A.cylinder(lx, ly, 2, LZ - 8, 8, { name: "lift.pinion" })), rec(A.cylinder(lx, ly, 0.8, LZ - 11, 3, { name: "lift.pinion" }))], { cls: "" }));
  LIFT.push(put("lift.wheel", [lx, ly, LZ + 0.8], S(k.extrude(ringPts, LZ, 1.6, P, { convex: false }), { tone: "hi" }) + windows(lx, ly, 3.4, 9.2, 5, top, 0.2) + Ln(k.ring(lx, ly, 9.2, top, P, 48), { tone: "lo" }) + Dots([at([lx, ly, top])], { size: 0.9, tone: "hi" }), [rec(A.extruded(ringPts, LZ, 1.6, { name: "lift.wheel" }))], { cls: "ac-brand" }));
}
// tweezers: two steel blades from the wheel's rim up to a joint
{
  const d = G.unit3([0.12, -0.34, 0.93]);
  const u0 = G.unit3([1, -1, 0]);
  const u = G.unit3(G.sub3(u0, G.mul3(d, G.dot3(u0, d))));
  const tipZ = LZ + 0.8;
  const K = G.add3([lx, ly, tipZ], G.mul3(d, 96));
  for (const [side, name] of [[1, "tw.bladeA"], [-1, "tw.bladeB"]]) {
    const tip = G.add3([lx, ly, tipZ], G.mul3(u, side * 13.3));
    const end = G.add3(K, G.mul3(u, side * 2.4));
    const ax = G.unit3(G.sub3(end, tip));
    const v = G.unit3(G.cross3(ax, u));
    const F = G.frameOf(tip, ax, u, v);
    const len = G.len3(G.sub3(end, tip));
    // a blade narrows to a fine tip; it is a little thicker than it is wide near the tip
    const poly = [[-0.5, -0.45], [0.5, -0.45], [0.5, 0.45], [-0.5, 0.45]];
    const near = [[-1.1, -0.5], [1.1, -0.5], [1.1, 0.5], [-1.1, 0.5]];
    LIFT.push(put(name, G.lerp3(tip, end, 0.5), S(G.prismOf(F, poly, 0, 14, P), { tone: "hi" }) + S(G.prismOf(F, near, 14, len, P), { tone: "hi" }), [rec(A.prism(F, poly, 0, 14, { name })), rec(A.prism(F, near, 14, len, { name }))], { cls: "" }));
  }
  const JF = G.frameAlong(G.add3(K, G.mul3(d, 1.2)), d);
  LIFT.push(put("tw.joint", G.add3(K, G.mul3(d, 5)), S(G.disc(0, 10, 3.6, JF, P), { tone: "hi" }), [rec(A.disc(JF, 0, 10, 3.6, { name: "tw.joint" }))], { cls: "" }));
}

// ---------- the loupe on its stand, leaning over the balance ----------
{
  const [sx, sy] = STAND;
  cyl("loupe.base", sx, sy, 18, BLOCK_Z, 4, { tone: "mid" }, { steps: 48, bevel: 0.8, extra: Ln(k.ring(sx, sy, 14, BLOCK_Z + 4, P, 48), { tone: "faint" }), cls: "ac-ebony" });
  const CZ = BLOCK_Z + 76;
  cyl("loupe.post", sx, sy, 2.4, BLOCK_Z + 4, CZ - BLOCK_Z - 4, { tone: "hi" }, { steps: 18 });
  cyl("loupe.postTop", sx, sy, 2.4, CZ + 8, 5, { tone: "hi" }, { steps: 18, extra: Dots([at([sx, sy, CZ + 13])], { size: 0.6, tone: "mid" }) });
  cyl("loupe.collar", sx, sy, 4.4, CZ, 8, { tone: "mid" }, { steps: 24, inner: Ln(k.knurl(sx, sy, 4.4, CZ + 1.4, CZ + 6.6, 20, P, 0.4), { tone: "lo" }) + Ln(k.sideArc(sx, sy, 4.4, CZ + 1.4, P, 24) + k.sideArc(sx, sy, 4.4, CZ + 6.6, P, 24), { tone: "lo" }), cls: "ac-ebony" });
  // the barrel hangs nose-down, tilted toward the balance
  const axis = G.unit3([-0.18, 0.1, -1]);
  const LF = G.frameAlong(LOUPE_TOP, axis);
  turned("loupe.barrel", LF, [[0, 9.4], [1.2, 9.8], [3.4, 9.8], [4.2, 8.8, 1], [10, 7.2, 1], [14, 6.2, 1], [15.6, 6]], { tone: "hi" }, { cls: "ac-ebony", extra: `<path class="lnt-glass" d="${G.circleOf(LF, 0.02, 8.2, P, 48)}"/>` + Ln(G.circleOf(LF, 0.02, 8.2, P, 48), { tone: "mid" }) });
  // the arm runs from the collar to a clamp on the barrel's side
  const side = G.unit3(G.sub3([sx, sy, 0], [LOUPE_TOP[0], LOUPE_TOP[1], 0]));
  const clampAt = G.add3(G.add3(LOUPE_TOP, G.mul3(axis, 2.2)), G.mul3(side, 9.8));
  const armStart = [sx - side[0] * 4.4, sy - side[1] * 4.4, CZ + 4];
  rod("loupe.arm", armStart, clampAt, 1.8, { tone: "hi" });
}

// ---------- echoes: a parts dish and a screwdriver ----------
{
  const DF = UP([84, 30, BLOCK_Z]);
  turned("dish", DF, [[0, 12], [1.2, 13], [4.6, 17, 1], [5.6, 18.4], [6, 18.4]], { tone: "hi" }, { extra: `<path class="lnt-dishin" d="${G.circleOf(DF, 6, 16.6, P, 48)}"/>` + Ln(G.circleOf(DF, 6, 16.6, P, 48), { tone: "lo" }) + Dots([[79, 26], [88, 32], [83, 36]].map(([x, y]) => at([x, y, BLOCK_Z + 1.4])), { size: 1.2, tone: "hi" }), cls: "" });
  // the screwdriver lies on the felt along the front, its handle in mint
  const dir = [1, 0, 0];
  const o = [-96, 75.4, BLOCK_Z + 3.6];
  const F = G.frameAlong(o, dir);
  turned("driver.cap", F, [[0, 2.6], [0.6, 3.4], [3.4, 3.4], [3.5, 3.2]], { tone: "hi" });
  turned("driver.handle", F, [[3.5, 3.2], [3.6, 3.6], [44, 3.6], [46, 2.6]], { tone: "hi" }, { cls: "ac-brand", extra: k.fadedSvg(G.ribsOf(F, 6, 42, 3.6, 22, P, { fade: [0.1, 0.5], seams: true }), { tone: "lo" }) });
  turned("driver.blade", F, [[46, 1], [70, 1], [72, 0.5], [72.4, 0.5]], { tone: "hi" });
}

// ---------- order and output ----------
A.settle(R, P);
R.items.sort((p1, p2) => p1.key - p2.key);
const lifted = new Set(LIFT.map((i) => i.name));
const parts = [];
let liftBuf = [];
const flush = () => {
  if (!liftBuf.length) return;
  parts.push(a.amFloat(liftBuf.join(""), P, { rise: 3, period: 5200 }));
  liftBuf = [];
};
for (const item of R.items) {
  const g = item.cls ? `<g class="${item.cls}">${item.svg}</g>` : item.svg;
  if (lifted.has(item.name)) liftBuf.push(g);
  else {
    flush();
    parts.push(g);
  }
}
flush();

const CSS = `
.lnt-window{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
.lnt-arm{fill:none;stroke:var(--anatomy-hi);stroke-width:1.1;stroke-linecap:round;vector-effect:non-scaling-stroke}
.lnt-hub{fill:var(--anatomy-hi)}
.lnt-timing{fill:var(--anatomy-mid)}
.lnt-glass{fill:var(--anatomy-shade-3);fill-opacity:.55}
.lnt-dishin{fill:var(--anatomy-shade-1)}
.lnt-stitch{stroke-dasharray:2.4 2}
.lnt-lifthalo{filter:blur(3px);opacity:.55}
`;
const name = dark ? "lnt-hero-dark" : "lnt-hero";
const svg = a.assetSvg({
  width: W,
  height: H,
  label: "An isometric watchmaker's bench block in walnut with a dark felt tray. A watch movement sits open in its holder; a pair of tweezers lifts one mint-coloured wheel out of its jewel. A loupe on a stand leans over the swinging balance; a parts dish and a mint-handled screwdriver lie on the felt.",
  body: [...back, ...parts].join(""),
  paper: PAPER,
  accents: {
    brand: MINT,
    jewel: { hex: "#5fb3ad", mode: "body" },
    felt: dark ? "#24403e" : "#3b5d5a",
    tray: dark ? "#2a2d30" : "#5a5f63",
    wood: dark ? "#6b4a2f" : "#8a5a3b",
    brass: "#c9b27c",
    steel: dark ? "#8d969f" : "#c3c9cf",
    ebony: dark ? "#08080a" : "#2f3236",
  },
  weight: 0.8,
  css: CSS,
  id: name,
});
writeFileSync(join(HERE, `${name}.svg`), svg);
writeFileSync(join(HERE, `${name}.html`), a.previewHtml({ title: name, svg, paper: PAPER, width: W, safe: SAFE }));
console.log(`wrote ${name}.svg (${(svg.length / 1024).toFixed(0)} KB) and ${name}.html · ${R.items.length} items · ${R.solids.length} solids`);
A.auditOrExit(R, P, {});
