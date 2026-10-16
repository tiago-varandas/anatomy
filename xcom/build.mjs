import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import * as A from "../kit/audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Seven floating platforms in true isometric: azimuth 45°, elevation 35.26°, so every edge runs at 30° on screen.
// x runs to the lower right, y to the lower left, z up. The front corner of each platform is (+x, +y).
// A point at height h on one platform is hidden by the platform above when (x + t, y + t) falls inside it,
// with t = GAP − PT − h, so the gap is wide enough that only the far corner of each platform is ever covered.
const W = 900;
const H = 1200;
const SIDE = 168; // label columns
const TOP = 18;
const FOOT = 14;
const PW = 300;
const PD = 180;
const PT = 16;
const GAP = 200;
const LAYERS = ["INTERFACE", "BUILDING BLOCKS", "SOCIAL GRAPH", "FEED ENGINE", "TRUST & SAFETY", "BUSINESS MODEL", "INFRASTRUCTURE"];
const topZ = (i) => (6 - i) * GAP; // i = 0 is the interface at the top
const PLAT = { x: -PW / 2, y: -PD / 2, w: PW, d: PD, r: 10 };
const CARD_Z = 52; // the popped-out post, above the interface

const extent = [...k.boxCorners(PLAT, -PT, topZ(0) + CARD_Z + 6)];
const P = k.fitProjection(extent, W - 2 * SIDE, H - TOP - FOOT, { pad: 4, azimuth: 45, elevation: 35.264 });
{
  // top-align the stack under the title and centre it across
  const pts = extent.map((p) => k.iso(p, P));
  const minY = Math.min(...pts.map((p) => p[1]));
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  P.origin = [P.origin[0] + (W - (maxX + minX)) / 2, P.origin[1] + TOP - minY];
}
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const f2 = (v) => Math.round(v * 100) / 100;
const path3 = (pts, closed = false) => k.pathOf(pts.map(at), closed);
function planeMatrix(o, ex, ey) {
  const p0 = at(o);
  const px = at(G.add3(o, ex));
  const py = at(G.add3(o, ey));
  const v = (x) => x.toFixed(4);
  return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
}
const onTop = (z, x, y) => planeMatrix([x, y, z + 0.05], [1, 0, 0], [0, 1, 0]);

// the post card is the exploded view's one lifted part: it floats above its slot by design
const R = A.recorder(P, { ground: (shape) => A.grounded(shape) || shape.name === "post" });
const record = R.solid;
let layer = 0;
let accent = false;
function put(name, ref, svg, shapes = [], { bias = 0, acc = accent } = {}) {
  return R.put({ piece: "stack", name: R.nameFor(name), at: ref, bias, svg, shapes, cls: `it L${layer}${acc ? " acc" : ""}` });
}
const box = (name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 1, steps = 3, bevel = 0.4, extra = "", inner = "", bias = 0, acc } = {}) => {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [record(A.slab(plan, z0, z1 - z0, { name }, steps))], { bias, acc });
};
const cyl = (name, cx, cy, r, z, h, style = {}, { steps = 40, bevel = 0, extra = "", inner = "", bias = 0, acc } = {}) => {
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [record(A.cylinder(cx, cy, r, z, h, { name }))], { bias, acc });
};
const extr = (name, ring, z, h, style = {}, { extra = "", bias = 0, convex = false, acc } = {}) => {
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  put(name, [cx, cy, z + h / 2], S(k.extrude(ring, z, h, P, { convex }), { tone: "mid", ...style }) + extra, [record(A.extruded(ring, z, h, { name }))], { bias, acc });
};
// a shape standing upright: a polygon in (x, z) given thickness along y
const YF = (x, z) => G.frameOf([x, 0, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const stand = (name, x, z, poly, y0, y1, style = {}, { extra = "", bias = 0, acc } = {}) => {
  const F = YF(x, z);
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  put(name, [x + cx, (y0 + y1) / 2, z + cz], S(G.prismOf(F, poly, y0, y1, P), { tone: "mid", ...style }) + extra, [record(A.prism(F, poly, y0, y1, { name }))], { bias, acc });
};
const turned = (name, F, profile, style = {}, { extra = "", bias = 0, acc } = {}) => {
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(G.solidOf(profile, F, P), { tone: "mid", ...style }) + extra, [record(A.solid(F, profile, { name }))], { bias, acc });
};
const ball = (name, c, r, style = {}, { bias = 0, acc } = {}) => put(name, c, S(G.sphereOf(c, r, P, { steps: 32 }), { tone: "mid", ...style }), [record(A.ball(c, r, { name }))], { bias, acc });
const UP = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);

// ---------- labels: an anchor in the drawing and a short name ----------
const LABELS = [];
const label = (text, p, side) => LABELS.push({ text, p, layer, side });
const PTS = {};

// lines that lie in a platform's own top are drawn with it
const GRAPH_N = [[-110, -50], [-40, -62], [40, -56], [112, -30], [-115, 32], [-45, 14], [36, 22], [108, 50], [-18, 64]];
const BLOCKED = 7;
const GRAPH_E = [[0, 1], [1, 2], [2, 3], [0, 5], [4, 5], [5, 6], [6, 2], [1, 5], [6, 8], [5, 8], [3, 6], [6, BLOCKED]];
const CDN_C = [-44, 44];
const CDN_EDGE = [[-120, 70], [-80, 78], [10, 74]];
function plateDecor(i, z) {
  if (i === 2) {
    const lines = [];
    const heads = [];
    for (const [a, b] of GRAPH_E) {
      const pa = GRAPH_N[a];
      const pb = GRAPH_N[b];
      const d = G.unit3([pb[0] - pa[0], pb[1] - pa[1], 0]);
      const s = [pa[0] + d[0] * 13.5, pa[1] + d[1] * 13.5];
      const e = [pb[0] - d[0] * 14, pb[1] - d[1] * 14];
      lines.push(k.lineOnTop(s, [e[0] - d[0] * 6, e[1] - d[1] * 6], z, P));
      const nrm = [-d[1], d[0]];
      heads.push(k.pathOf([[e[0], e[1]], [e[0] - d[0] * 7 + nrm[0] * 3.4, e[1] - d[1] * 7 + nrm[1] * 3.4], [e[0] - d[0] * 7 - nrm[0] * 3.4, e[1] - d[1] * 7 - nrm[1] * 3.4]].map(([x, y]) => at([x, y, z])), true));
    }
    return `<path class="xs-edge" d="${lines.join("")}"/><path class="xs-arrow" d="${heads.join("")}"/>`;
  }
  if (i === 6) {
    return Ln(CDN_EDGE.map(([nx, ny]) => {
      const d = G.unit3([nx - CDN_C[0], ny - CDN_C[1], 0]);
      return k.lineOnTop([CDN_C[0] + d[0] * 6, CDN_C[1] + d[1] * 6], [nx - d[0] * 2.5, ny - d[1] * 2.5], z, P);
    }).join(""), { tone: "mid", className: "xs-link" }) + Dots(CDN_EDGE.flatMap(([nx, ny]) => {
      const d = G.unit3([nx - CDN_C[0], ny - CDN_C[1], 0]);
      return [at([CDN_C[0] + d[0] * 6, CDN_C[1] + d[1] * 6, z]), at([nx - d[0] * 2.5, ny - d[1] * 2.5, z])];
    }), { size: 0.8, tone: "mid" });
  }
  return "";
}

// ---------- the platforms ----------
const back = [];
for (let i = 0; i < 7; i++) {
  layer = i + 1;
  const z = topZ(i);
  back.push(`<g class="L${layer}"><path class="iso-halo xs-shadow" d="${k.haloOf(k.insetPlan(PLAT, 14), z - PT - 40, 1, P)}"/></g>`);
  accent = false;
  box(`stand.plate${layer}`, [PLAT.x, PLAT.y, z - PT], [PLAT.x + PW, PLAT.y + PD, z], { tone: "mid" }, {
    r: PLAT.r,
    steps: 6,
    bevel: 1.2,
    inner: Ln(k.sideSeam(PLAT, z - PT + 4, P, 6), { tone: "faint" }),
    extra:
      Ln(k.planOutline(k.insetPlan(PLAT, 7), z, P, 6), { tone: "faint" }) +
      Dots(k.corners(PLAT, 7).map(([x, y]) => at([x, y, z])), { size: 0.55 }) +
      plateDecor(i, z) +
      // the layer's number and name on its front-left edge
      `<g transform="${planeMatrix([PLAT.x + 18, PLAT.y + PD + 0.05, z - 2.6], [1, 0, 0], [0, 0, -1])}"><rect class="xs-namebar" x="0" y="0" width="4" height="${PT - 5.2}" rx="1"/><text class="xs-layer" x="10" y="${PT - 8.6}">${String(layer).padStart(2, "0")}  ${LAYERS[i]}</text></g>`,
  });
}

// ---------- 1 · INTERFACE ----------
layer = 1;
{
  const z = topZ(0);
  const scr = { x: -138, y: -80, w: 276, d: 160, r: 7 };
  accent = false;
  box("device", [scr.x, scr.y, z], [scr.x + scr.w, scr.y + scr.d, z + 7], { tone: "mid" }, { r: 7, steps: 5, bevel: 0.8, inner: Ln(k.sideSeam(scr, z + 3.5, P, 5), { tone: "faint" }) });
  // the screen, drawn in the device's top plane: three columns across x, the page running down y
  const sx0 = scr.x + 7;
  const sy0 = scr.y + 7;
  const sw = scr.w - 14;
  const sh = scr.d - 14;
  const ZS = z + 7;
  const ui = [];
  ui.push(`<rect class="xs-screen" width="${sw}" height="${sh}" rx="3"/>`);
  ui.push(`<rect class="xs-col" x="4" y="4" width="30" height="${sh - 8}" rx="2"/>`);
  for (let i = 0; i < 6; i++) ui.push(`<circle class="xs-icon${i === 0 ? " xs-on" : ""}" cx="19" cy="${16 + i * 20}" r="${i === 0 ? 5.5 : 4.5}"/>`);
  ui.push(`<rect class="xs-btn" x="8" y="${sh - 24}" width="22" height="9" rx="4.5"/>`);
  const cx0 = 40;
  const cw = 140;
  ui.push(`<rect class="xs-composer" x="${cx0}" y="5" width="${cw}" height="28" rx="3"/><circle class="xs-avatar" cx="${cx0 + 11}" cy="16" r="5.5"/><rect class="xs-line" x="${cx0 + 22}" y="13" width="66" height="4" rx="2"/><rect class="xs-btn" x="${cx0 + cw - 30}" y="22" width="25" height="7.5" rx="3.7"/>`);
  for (let i = 0; i < 3; i++) {
    const y = 38 + i * 34;
    ui.push(`<rect class="xs-card${i === 0 ? " xs-slot" : ""}" x="${cx0}" y="${y}" width="${cw}" height="30" rx="3"/><circle class="xs-avatar" cx="${cx0 + 10}" cy="${y + 9}" r="5"/><rect class="xs-line" x="${cx0 + 20}" y="${y + 5.5}" width="42" height="3.4" rx="1.7"/><rect class="xs-line xs-dim" x="${cx0 + 20}" y="${y + 12}" width="${96 - i * 12}" height="3" rx="1.5"/><rect class="xs-line xs-dim" x="${cx0 + 20}" y="${y + 18}" width="${74 + i * 10}" height="3" rx="1.5"/>`);
  }
  const rx0 = cx0 + cw + 6;
  const rw = sw - rx0 - 4;
  ui.push(`<rect class="xs-search" x="${rx0}" y="5" width="${rw}" height="13" rx="6.5"/><circle class="xs-glass" cx="${rx0 + 7.5}" cy="11.5" r="2.8"/>`);
  ui.push(`<rect class="xs-col" x="${rx0}" y="23" width="${rw}" height="${sh - 27}" rx="3"/><rect class="xs-line xs-strong" x="${rx0 + 5}" y="29" width="34" height="4" rx="2"/>`);
  for (let i = 0; i < 5; i++) ui.push(`<rect class="xs-line xs-dim" x="${rx0 + 5}" y="${40 + i * 18}" width="${18 + ((i * 7) % 20)}" height="2.6" rx="1.3"/><rect class="xs-line" x="${rx0 + 5}" y="${45 + i * 18}" width="${34 + ((i * 11) % 24)}" height="3.4" rx="1.7"/>`);
  const slot = { x: sx0 + cx0, y: sy0 + 38, w: cw, d: 30 };
  const CARD = { x: 14, y: -52, w: 144, d: 94 };
  const proj = Ln([[[CARD.x, CARD.y], [slot.x, slot.y]], [[CARD.x, CARD.y + CARD.d], [slot.x, slot.y + slot.d]]].map(([a, b]) => path3([[a[0], a[1], z + CARD_Z], [b[0], b[1], ZS]])).join(""), { tone: "lo", className: "xs-proj", free: true }); // construction lines: they end in the air on purpose
  put("screen", [0, 0, ZS], `<g transform="${onTop(ZS, sx0, sy0)}">${ui.join("")}</g>` + proj, [record(A.slab({ x: sx0, y: sy0, w: sw, d: sh, r: 3 }, ZS, 0.3, { name: "screen" }, 3))], { bias: 0.3 });
  const tl = (u, v) => [sx0 + u, sy0 + v, ZS];
  label("Navigation", tl(19, 76), "L");
  label("Composer", tl(cx0 + 60, 12), "L");
  label("Timeline", tl(cx0 + 70, 110), "L");
  label("Search", tl(rx0 + rw / 2, 11.5), "R");
  label("Trending", tl(rx0 + 20, 70), "R");
  // the post lifted out of its slot and enlarged
  const PZ = z + CARD_Z;
  const card = { x: 14, y: -52, w: 144, d: 94, r: 6 }; // the post floats: it is the exploded view's one lifted part
  accent = true;
  const u0 = card.x + 7;
  const v0 = card.y + 7;
  const pc = [];
  pc.push(`<rect class="xs-face" width="${card.w - 14}" height="${card.d - 14}" rx="3"/>`);
  pc.push(`<circle class="xs-avatar xs-big" cx="10" cy="10" r="8"/>`);
  pc.push(`<rect class="xs-line xs-strong" x="23" y="4.5" width="34" height="4.6" rx="2.3"/><rect class="xs-line xs-dim" x="61" y="5" width="28" height="3.8" rx="1.9"/>`);
  pc.push(`<rect class="xs-line" x="23" y="14.5" width="100" height="3.4" rx="1.7"/><rect class="xs-line" x="23" y="21" width="80" height="3.4" rx="1.7"/>`);
  pc.push(`<rect class="xs-image" x="23" y="28" width="103" height="36" rx="3"/><path class="xs-mount" d="M27 62 L48 44 L62 55 L77 39 L122 62 Z"/><circle class="xs-sun" cx="110" cy="37" r="4.6"/>`);
  const ACT = ["Reply", "Repost", "Like", "Views", "Bookmark", "Share"];
  const ax = (i) => 26 + i * 19.5;
  // the action row as small line icons: reply, repost, like, views, bookmark, share
  const ICON = [
    (x, y) => `M${x - 3.4} ${y + 3.2}L${x - 2.4} ${y + 1}A3.6 3 0 1 1 ${x - 0.6} ${y + 2.3}Z`,
    (x, y) => `M${x - 3.6} ${y - 0.6}V${y - 2.4}H${x + 2.4}M${x + 1} ${y - 3.6}L${x + 2.4} ${y - 2.4}L${x + 1} ${y - 1.2}M${x + 3.6} ${y + 0.6}V${y + 2.4}H${x - 2.4}M${x - 1} ${y + 1.2}L${x - 2.4} ${y + 2.4}L${x - 1} ${y + 3.6}`,
    (x, y) => `M${x} ${y + 3.2}C${x - 5} ${y}${x - 3.6} ${y - 4}${x} ${y - 1.6}C${x + 3.6} ${y - 4}${x + 5} ${y}${x} ${y + 3.2}Z`,
    (x, y) => `M${x - 2.6} ${y + 3}V${y + 0.6}M${x} ${y + 3}V${y - 3}M${x + 2.6} ${y + 3}V${y - 1}`,
    (x, y) => `M${x - 2.4} ${y - 3.2}H${x + 2.4}V${y + 3.4}L${x} ${y + 1.6}L${x - 2.4} ${y + 3.4}Z`,
    (x, y) => `M${x} ${y + 1}V${y - 3.4}M${x - 2} ${y - 1.6}L${x} ${y - 3.6}L${x + 2} ${y - 1.6}M${x - 3.2} ${y + 0.4}V${y + 3.2}H${x + 3.2}V${y + 0.4}`,
  ];
  ACT.forEach((_, i) => pc.push(`<path class="xs-act" d="${ICON[i](ax(i), 73)}"/>`));
  box("post", [card.x, card.y, PZ], [card.x + card.w, card.y + card.d, PZ + 4], { tone: "hi" }, { r: 6, steps: 5, bevel: 0.6, extra: `<g transform="${onTop(PZ + 4, u0, v0)}">${pc.join("")}</g>` });
  accent = false;
  const pf = (u, v) => [u0 + u, v0 + v, PZ + 4];
  label("Avatar", pf(10, 10), "R");
  label("Name & handle", pf(46, 7), "R");
  label("Post text", pf(90, 16), "R");
  label("Image", pf(90, 50), "R");
  label("Reply · Repost · Like", pf(ax(1), 73), "R");
  label("Views · Bookmark · Share", pf(ax(4), 73), "R");
  PTS.composer = [sx0 + cx0 + 30, sy0 + 26, ZS + 1.7];
  PTS.slot = [sx0 + cx0 + 30, sy0 + 58, ZS + 1.7];
}

// ---------- 2 · BUILDING BLOCKS ----------
layer = 2;
{
  const z = topZ(1);
  accent = true;
  const cell = (c, r) => [-112 + c * 56, -38 + r * 78];
  {
    const [x, y] = cell(0, 0);
    box("blk.post", [x - 20, y - 15, z], [x + 20, y + 15, z + 4], { tone: "hi" }, { r: 3, extra: Ln(k.ring(x - 11, y - 6, 4, z + 4, P, 20), { tone: "mid" }) + Ln([0, 1, 2].map((i) => k.lineOnTop([x - 3, y - 7 + i * 6], [x + 14 - i * 5, y - 7 + i * 6], z + 4, P)).join(""), { tone: "lo", free: true }) });
    label("Post", [x, y, z + 4]);
  }
  {
    const [x, y] = cell(1, 0);
    extr("blk.reply", k.roundedPlan({ x: x - 18, y: y - 14, w: 36, d: 24, r: 8 }, 5), z, 9, { tone: "hi" }, { convex: true });
    extr("blk.replytail", [[x - 12, y + 10], [x - 3, y + 10], [x - 15, y + 18]], z, 8.4, { tone: "hi" }, { convex: true });
    label("Reply", [x, y - 2, z + 9]);
  }
  {
    const [x, y] = cell(2, 0);
    for (const [a0, a1, name] of [[Math.PI * 0.12, Math.PI * 0.92, "blk.repostA"], [Math.PI * 1.12, Math.PI * 1.92, "blk.repostB"]]) {
      const pts = Array.from({ length: 16 }, (_, i) => {
        const a = a0 + ((a1 - a0) * i) / 15;
        return [x + 16 * Math.cos(a), y + 13 * Math.sin(a), z + 2.45];
      });
      R.route(name, pts, 2.4, { owner: name, piece: "stack", limp: true, touch: ["stand.plate2", `${name}.head`], ends: [false, true] });
      tubePieces(pts, 2.4, P, { maxLength: 12 }).forEach((p, i) => put(`${name}:${i}`, p.mid, tubeSvg(p, { tone: "hi" }), [A.tube(p.points, p.radii)]));
      const end = pts[pts.length - 1];
      const d = G.unit3(G.sub3(end, pts[pts.length - 2]));
      const nrm = [-d[1], d[0], 0];
      extr(`${name}.head`, [G.add3(end, G.mul3(nrm, 5)), G.add3(end, G.mul3(d, 7)), G.add3(end, G.mul3(nrm, -5))].map((p) => [p[0], p[1]]), z, 4.8, { tone: "hi" }, { convex: true });
    }
    label("Repost", [x + 16, y, z + 2.4]);
  }
  {
    const [x, y] = cell(3, 0);
    box("blk.quote", [x - 20, y - 15, z], [x + 20, y + 15, z + 4], { tone: "mid" }, { r: 3 });
    box("blk.quoted", [x - 12, y - 5, z + 4], [x + 16, y + 11, z + 7], { tone: "hi" }, { r: 2, extra: Ln(k.lineOnTop([x - 8, y], [x + 11, y], z + 7, P), { tone: "lo", free: true }) });
    label("Quote", [x, y, z + 7]);
  }
  {
    const [x, y] = cell(4, 0);
    const heart = Array.from({ length: 48 }, (_, i) => {
      const t = (i / 48) * Math.PI * 2;
      return [16 * Math.pow(Math.sin(t), 3), 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 17];
    });
    stand("blk.heart", x, z, heart, y - 4, y + 4, { tone: "hi" });
    label("Like", [x, y + 4, z + 18]);
  }
  {
    const [x, y] = cell(0, 1);
    stand("blk.bookmark", x, z, [[-10, 0], [0, 8], [10, 0], [10, 32], [-10, 32]], y - 3, y + 3, { tone: "hi" });
    label("Bookmark", [x, y + 3, z + 22]);
  }
  {
    const [x, y] = cell(1, 1);
    box("blk.list", [x - 16, y - 20, z], [x + 16, y + 20, z + 4], { tone: "hi" }, { r: 3, extra: Dots([0, 1, 2].map((i) => at([x - 9, y - 11 + i * 11, z + 4])), { size: 1.5, tone: "hi" }) + Ln([0, 1, 2].map((i) => k.lineOnTop([x - 4, y - 11 + i * 11], [x + 10, y - 11 + i * 11], z + 4, P)).join(""), { tone: "lo", free: true }) });
    label("Lists", [x, y, z + 4]);
  }
  {
    const [x, y] = cell(2, 1);
    for (const [dx, dy, s] of [[-11, -7, 0.85], [11, -7, 0.85], [0, 7, 1]]) {
      cyl("blk.body", x + dx, y + dy, 6.5 * s, z, 11 * s, { tone: "hi" }, { steps: 24 });
      ball("blk.head", [x + dx, y + dy, z + 11 * s + 4.6 * s], 4.6 * s, { tone: "hi" });
    }
    label("Communities", [x, y + 7, z + 20]);
  }
  {
    const [x, y] = cell(3, 1);
    const env = { x: x - 20, y: y - 14, w: 40, d: 28, r: 2 };
    box("blk.envelope", [env.x, env.y, z], [env.x + env.w, env.y + env.d, z + 5], { tone: "hi" }, { r: 2, extra: Ln(path3([[env.x + 1.5, env.y + 1.5, z + 5], [x, y + 4, z + 5], [env.x + env.w - 1.5, env.y + 1.5, z + 5]]), { tone: "mid", free: true }) });
    label("Messages", [x, y, z + 5]);
  }
  {
    const [x, y] = cell(4, 1);
    cyl("blk.micbase", x, y, 10, z, 3, { tone: "mid" });
    cyl("blk.micpost", x, y, 1.8, z + 3, 10, { tone: "mid" }, { steps: 16 });
    const MF = UP([x, y, z + 13]);
    turned("blk.mic", MF, [[0, 3.4], [2.5, 6.4], [11, 6.4, 1], [14, 5.6, 1], [16.6, 3.4, 1], [18, 0]], { tone: "hi" }, { extra: k.fadedSvg(G.ribsOf(MF, 3, 11, 6.4, 18, P, { fade: [0.1, 0.55] }), { tone: "lo" }) });
    label("Live audio", [x, y, z + 28]);
  }
  accent = false;
}

// ---------- 3 · SOCIAL GRAPH ----------
layer = 3;
{
  const z = topZ(2);
  const N = GRAPH_N;
  N.forEach(([x, y], i) => {
    const blocked = i === BLOCKED;
    const glyph = `<g transform="${onTop(z + 6, x, y)}"><g transform="rotate(-45)"><circle class="xs-head${blocked ? " xs-muted" : ""}" cx="0" cy="-2.6" r="3.8"/><path class="xs-shoulder${blocked ? " xs-muted" : ""}" d="M-7.4 7 A7.4 6.2 0 0 1 7.4 7 Z"/></g>${blocked ? '<path class="xs-slash" d="M-10 10 L10 -10"/>' : ""}</g>`;
    cyl(`graph.node${i}`, x, y, 13, z, 6, { tone: blocked ? "lo" : "hi" }, { steps: 40, bevel: 0.5, extra: glyph, acc: !blocked });
  });
  label("Accounts", [N[2][0], N[2][1], z + 6]);
  label("Follows", [(N[5][0] + N[8][0]) / 2, (N[5][1] + N[8][1]) / 2, z]);
  label("Blocked", [N[BLOCKED][0], N[BLOCKED][1], z + 6]);
}

// ---------- 4 · FEED ENGINE ----------
layer = 4;
{
  const z = topZ(3);
  accent = true;
  // candidates: a funnel on three legs, near the right corner where the journey comes in
  const fx = 96;
  const fy = -46;
  cyl("eng.funnelbase", fx, fy, 11, z, 3, { tone: "mid" }, { acc: false, bevel: 0.4 });
  const FF = UP([fx, fy, z + 3]);
  turned("eng.spout", FF, [[0, 3.6], [8, 3.6]], { tone: "mid" }, { acc: false });
  turned("eng.funnel", FF, [[8, 4.4], [12, 6, 1], [20, 10, 1], [30, 16, 1], [38, 21, 1], [42, 22.5], [44, 22.5]], { tone: "hi" }, { extra: `<path class="xs-void" d="${G.circleOf(FF, 44, 20.5, P, 64)}"/>` });
  label("Candidates", [fx + 15, fy + 13, z + 40]);
  // ranking: two meshing gears on posts
  const gear = (cx, cy, r, teeth, phase) => {
    const ring = [];
    for (let i = 0; i < teeth * 4; i++) {
      const a = phase + (i / (teeth * 4)) * Math.PI * 2;
      ring.push([cx + (i % 4 < 2 ? r + 4.5 : r) * Math.cos(a), cy + (i % 4 < 2 ? r + 4.5 : r) * Math.sin(a)]);
    }
    return ring;
  };
  const GEARS = [[22, -22, 21, 10, 0], [-14, 14, 15, 8, 0.25]];
  for (const [gx, gy, r, n, ph] of GEARS) {
    cyl("eng.shaft", gx, gy, 3, z, 14, { tone: "mid" }, { steps: 16, acc: false });
    extr("eng.gear", gear(gx, gy, r, n, ph), z + 14, 7, { tone: "hi" }, { extra: Ln(k.ring(gx, gy, r * 0.5, z + 21, P, 32), { tone: "mid" }) + Dots([at([gx, gy, z + 21])], { size: 1.6, tone: "hi" }) });
  }
  label("Ranking", [22, -22, z + 21]);
  // filters: a sieve, its holes on a grid
  const sx = -66;
  const sy = 30;
  cyl("eng.sievebase", sx, sy, 16, z, 8, { tone: "mid" }, { acc: false });
  const holes = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (i * i + j * j <= 10) holes.push(at([sx + i * 5.5, sy + j * 5.5, z + 16]));
  cyl("eng.sieve", sx, sy, 22, z + 8, 8, { tone: "hi" }, { steps: 56, bevel: 0.6, extra: Ln(k.ring(sx, sy, 19, z + 16, P, 48), { tone: "mid" }) + Dots(holes, { size: 0.9, tone: "mid" }) });
  label("Filters", [sx, sy, z + 16]);
  // two conveyors leaving the sieve toward the front: For You and Following
  for (const [bx, by, name] of [[-128, -6, "For You"], [-30, 70, "Following"]]) {
    const belt = { x: bx - 16, y: by - 13, w: 32, d: 26, r: 3 };
    for (const ly of [belt.y + 3, belt.y + belt.d - 7]) box("eng.beltleg", [belt.x + 3, ly, z], [belt.x + belt.w - 3, ly + 4, z + 5], { tone: "lo" }, { r: 0.5, acc: false });
    box("eng.belt", [belt.x, belt.y, z + 5], [belt.x + belt.w, belt.y + belt.d, z + 10], { tone: "mid" }, { r: 3, acc: false, extra: Ln(Array.from({ length: 4 }, (_, i) => k.lineOnTop([belt.x, belt.y + 5 + i * 5.5], [belt.x + belt.w, belt.y + 5 + i * 5.5], z + 10, P)).join(""), { tone: "lo" }) });
    box("eng.item", [bx - 8, by - 7, z + 10], [bx + 8, by + 7, z + 12], { tone: "hi" }, { r: 1 });
    label(name, [bx, by, z + 12]);
  }
  accent = false;
  PTS.funnel = [fx, fy, z + 3 + 44 + 2];
  PTS.gears = [22, -22, z + 21 + 1.7];
  PTS.sieve = [sx, sy, z + 16 + 1.7];
  PTS.belt = [-30, 70, z + 12 + 1.7];
}

// ---------- 5 · TRUST & SAFETY ----------
layer = 5;
{
  const z = topZ(4);
  accent = true;
  // a shield standing on its point in a small foot
  box("ts.shieldfoot", [-104, 4, z], [-80, 16, z + 4], { tone: "mid" }, { r: 2, acc: false });
  const shield = [[-20, 44], [20, 44], [20, 24], [14, 10], [0, 4], [-14, 10], [-20, 24]];
  stand("ts.shield", -92, z, shield, 7, 13, { tone: "hi" }, { extra: `<path class="xs-emblem" d="${path3([[-92, 13.05, z + 36], [-92, 13.05, z + 14]])}"/><path class="xs-emblem" d="${path3([[-102, 13.05, z + 27], [-82, 13.05, z + 27]])}"/>` });
  label("Safety rules", [-92, 13, z + 40]);
  // a verification badge: a scalloped disc standing up, with a check
  box("ts.badgefoot", [-40, -10, z], [-16, 0, z + 4], { tone: "mid" }, { r: 2, acc: false });
  const scal = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const r = 18 + 2.2 * Math.cos(a * 12);
    return [r * Math.cos(a), 24 + r * Math.sin(a)];
  });
  stand("ts.badge", -28, z, scal, -8, -2, { tone: "hi" }, { extra: `<path class="xs-check" d="${path3([[-37, -1.95, z + 24], [-31, -1.95, z + 18], [-19, -1.95, z + 31]])}"/>` });
  label("Verification", [-28, -2, z + 40]);
  // a community note: a sticky note lying askew
  const ang = 0.12;
  const rot = ([u, v]) => [44 + u * Math.cos(ang) - v * Math.sin(ang), 34 + u * Math.sin(ang) + v * Math.cos(ang)];
  extr("ts.note", [[-24, -24], [24, -24], [24, 14], [14, 24], [-24, 24]].map(rot), z, 2.2, { tone: "hi" }, { convex: true, extra: Ln([-12, -2, 8].map((v, i) => path3([[-16, v], [i === 2 ? 4 : 14, v]].map((p) => [...rot(p), z + 2.2]))).join(""), { tone: "lo", free: true }) });
  label("Community Notes", [44, 34, z + 2.2]);
  // a report flag on its pole, toward the right corner
  cyl("ts.flagbase", 104, -30, 8, z, 3, { tone: "mid" }, { acc: false });
  cyl("ts.pole", 104, -30, 1.6, z + 3, 44, { tone: "mid" }, { steps: 12, acc: false });
  stand("ts.flag", 104, z, [[1.6, 46], [30, 41], [21, 33], [30, 25], [1.6, 30]], -31, -29, { tone: "hi" });
  label("Reports", [124, -30, z + 36]);
  accent = false;
}

// ---------- 6 · BUSINESS MODEL ----------
layer = 6;
{
  const z = topZ(5);
  accent = true;
  // an ad billboard on two posts, its face to the front-left
  for (const px of [-118, -76]) cyl("biz.post", px, -14, 2.4, z, 22, { tone: "mid" }, { steps: 14, acc: false });
  stand("biz.board", -97, z, [[-30, 22], [30, 22], [30, 54], [-30, 54]], -18, -12, { tone: "hi" }, {
    extra: `<g transform="${planeMatrix([-127, -11.95, z + 54], [1, 0, 0], [0, 0, -1])}"><rect class="xs-ad" x="3" y="3" width="54" height="26" rx="2"/><rect class="xs-adtext" x="8" y="8" width="26" height="4.5" rx="2"/><rect class="xs-adtext xs-dim" x="8" y="16" width="18" height="3.2" rx="1.6"/><rect class="xs-adbtn" x="37" y="19" width="15" height="6" rx="3"/></g>`,
  });
  label("Ads", [-97, -12, z + 44]);
  // a subscription card
  const card = { x: -56, y: 30, w: 56, d: 36, r: 4 };
  box("biz.card", [card.x, card.y, z], [card.x + card.w, card.y + card.d, z + 3], { tone: "hi" }, { r: 4, steps: 4, extra: Ln(k.lineOnTop([card.x, card.y + 26], [card.x + card.w, card.y + 26], z + 3, P), { tone: "mid" }) });
  box("biz.chip", [card.x + 8, card.y + 7, z + 3], [card.x + 19, card.y + 15, z + 4], { tone: "mid" }, { r: 1.5, acc: false });
  label("Subscriptions", [card.x + 36, card.y + 12, z + 3]);
  // creator payouts: a stack of coins and a short one beside it
  for (let i = 0; i < 6; i++) {
    const cx = 34 + (i % 2) * 1;
    const cy = -30 + (i % 3) * 0.7;
    cyl("biz.coin", cx, cy, 13, z + i * 3.6, 3.6, { tone: "hi" }, { steps: 40, inner: Ln(k.knurl(cx, cy, 13, z + i * 3.6 + 0.5, z + i * 3.6 + 3.1, 32, P, 0.4), { tone: "faint" }) });
  }
  for (let i = 0; i < 2; i++) cyl("biz.coinlow", 62, -6, 13, z + i * 3.6, 3.6, { tone: "hi" });
  label("Creator payouts", [34, -30, z + 21.6]);
  // the API: a socket block and a plug pulled out of it, its cable running away on the plate
  box("biz.socket", [96, 10, z], [124, 16, z + 30], { tone: "mid" }, { r: 2, steps: 3, acc: false, extra: Dots([at([98, 16, z + 27]), at([122, 16, z + 27]), at([98, 16, z + 3]), at([122, 16, z + 3])], { size: 0.55, tone: "hi" }) });
  box("biz.plug", [100, 16, z + 9], [120, 32, z + 25], { tone: "hi" }, { r: 3, steps: 3 });
  const cablePts = G.fillet([[110, 32, z + 17], [110, 56, z + 17], [110, 70, z + 2.25], [70, 76, z + 2.25]], 7, 8, { P, tube: 2.2 });
  R.route("biz.cable", cablePts, 2.2, { owner: "biz.cable", piece: "stack", limp: true, touch: ["stand.plate6", "biz.plug"], ends: [true, false] });
  tubePieces(cablePts, 2.2, P, { maxLength: 14 }).forEach((p, i) => put(`biz.cable:${i}`, p.mid, tubeSvg(p, { tone: "mid" }), [A.tube(p.points, p.radii)]));
  label("API", [110, 24, z + 25]);
  accent = false;
}

// ---------- 7 · INFRASTRUCTURE ----------
layer = 7;
{
  const z = topZ(6);
  accent = true;
  // two server racks at the left
  for (const ry of [-34, 4]) {
    const rack = { x: -128, y: ry, w: 30, d: 32, r: 2 };
    box("inf.rack", [rack.x, rack.y, z], [rack.x + rack.w, rack.y + rack.d, z + 58], { tone: "mid" }, {
      r: 2,
      steps: 3,
      bevel: 0.6,
      inner: Ln([10, 20, 30, 40, 50].map((zz) => k.sideSeam(rack, z + zz, P, 3)).join(""), { tone: "lo" }),
      extra: Dots([5, 15, 25, 35, 45, 55].map((zz) => at([rack.x + rack.w - 4, rack.y + rack.d, z + zz])), { size: 1.1, tone: "hi" }),
    });
  }
  label("Servers", [-113, 20, z + 58]);
  // databases: two stacks of drums near the right corner, where the journey comes down
  const DB = [[64, -46], [100, -20]];
  for (const [dx, dy] of DB) for (let i = 0; i < 3; i++) cyl("inf.db", dx, dy, 15, z + i * 12.5, 12.5, { tone: "hi" }, { steps: 48, bevel: 0.6, inner: Ln(k.sideArc(dx, dy, 15, z + i * 12.5 + 5.75, P, 32), { tone: "faint" }) });
  label("Databases", [64, -46, z + 37]);
  // the CDN: a globe with its meridians, wired to edge nodes on the plate
  const gc = [...CDN_C, z + 34];
  cyl("inf.stand", gc[0], gc[1], 9, z, 3, { tone: "mid" }, { acc: false });
  cyl("inf.stem", gc[0], gc[1], 1.8, z + 3, 15, { tone: "mid" }, { steps: 12, acc: false });
  const GF = UP(gc);
  const merid = [0, 1, 2].map((i) => {
    const a = (i * Math.PI) / 3;
    return G.arcOf(G.frameOf(gc, [Math.cos(a), Math.sin(a), 0], [0, 0, 1], [-Math.sin(a), Math.cos(a), 0]), 0, 16, P);
  }).join("") + [-8, 0, 8].map((s) => G.arcOf(GF, s, Math.sqrt(16 * 16 - s * s), P)).join("");
  put("inf.globe", gc, S(G.sphereOf(gc, 16, P, { steps: 40 }), { tone: "hi" }) + Ln(merid, { tone: "mid" }), [record(A.ball(gc, 16, { name: "inf.globe" }))]);
  for (const [nx, ny] of CDN_EDGE) cyl("inf.edge", nx, ny, 5, z, 5, { tone: "hi" }, { steps: 20 });
  label("CDN", [gc[0], gc[1], gc[2] + 16]);
  // search: a stack of index cards with a magnifying glass over it
  const ix = 48;
  const iy = 30;
  for (let i = 0; i < 4; i++) box("inf.index", [ix - 20 + i * 1.5, iy - 15 - i * 1.5, z + i * 2.6], [ix + 20 + i * 1.5, iy + 15 - i * 1.5, z + i * 2.6 + 2.6], { tone: "hi" }, { r: 2, extra: i === 3 ? Ln([0, 1, 2, 3].map((r) => k.lineOnTop([ix - 12 + 4.5, iy - 9 - 4.5 + r * 5.5], [ix + 8 + 4.5 - r * 3, iy - 9 - 4.5 + r * 5.5], z + 10.4, P)).join(""), { tone: "lo", free: true }) : "" });
  const top = z + 4 * 2.6;
  const lens = [ix + 6, iy - 6, top];
  const LF = UP(lens);
  put("inf.lens", [lens[0], lens[1], top + 1.4], S(G.ringBand(0, 2.8, 11, 14.5, LF, P), { tone: "hi" }) + `<path class="xs-lensglass" d="${G.circleOf(LF, 2.8, 11, P, 48)}"/>`, [record(A.ring(LF, 0, 2.8, 11, 14.5, { name: "inf.lens" }))], { bias: 0.5 });
  const hdir = G.unit3([1, 1, 0]);
  const HF = G.frameAlong(G.add3([lens[0], lens[1], top + 2.6], G.mul3(hdir, 14.5)), hdir);
  put("inf.handle", G.add3(HF.o, G.mul3(hdir, 9)), S(G.disc(0, 18, 2.6, HF, P), { tone: "hi" }), [record(A.disc(HF, 0, 18, 2.6, { name: "inf.handle" }))], { bias: 0.4 });
  label("Search index", [ix + 10, iy + 6, z + 10.4]);
  accent = false;
  PTS.db = [64, -46, z + 37.5 + 2];
  PTS.index = [ix + 6, iy - 6, z + 4 * 2.6 + 2];
}

// ---------- the post's journey: a glowing line, chunked and depth-sorted with everything else ----------
// It drops down the right-hand corner (+x, −y) and climbs the left-hand corner (−x, +y): outside every
// platform's footprint, so no platform ever covers those runs.
const D = PTS;
const RX = PLAT.x + PW + 34; // down lane
const RXI = PLAT.x + PW + 20; // up lane, beside it
const RY = PLAT.y - 26;
const LX = PLAT.x - 26;
const LY = PLAT.y + PD + 26;
const air = (i, h) => topZ(i) + h;
const JOURNEY = [
  D.composer,
  [D.composer[0], D.composer[1], air(0, 24)],
  [RX, RY, air(0, 24)],
  [RX, RY, air(6, 52)],
  [D.db[0] + 14, D.db[1] - 10, air(6, 52)],
  D.db,
  [D.db[0] - 12, D.db[1] + 12, air(6, 46)],
  [D.index[0] - 14, D.index[1] - 4, air(6, 36)],
  D.index,
  [D.index[0] + 16, D.index[1] - 16, air(6, 40)],
  [RXI, RY, air(6, 40)],
  [RXI, RY, air(3, 64)],
  [D.funnel[0], D.funnel[1], air(3, 64)],
  D.funnel,
  [D.funnel[0] - 30, D.funnel[1] + 12, D.funnel[2] + 3],
  [D.gears[0], D.gears[1], air(3, 34)],
  D.gears,
  [D.sieve[0], D.sieve[1], air(3, 30)],
  D.sieve,
  [D.belt[0], D.belt[1], air(3, 26)],
  D.belt,
  [D.belt[0], D.belt[1], air(3, 26)],
  [LX, LY, air(3, 26)],
  [LX, LY, air(0, 36)],
  [D.slot[0], D.slot[1], air(0, 36)],
  D.slot,
];
const STEPS = [
  { n: 1, p: D.composer, name: "Compose and post" },
  { n: 2, p: D.db, name: "Store" },
  { n: 3, p: D.index, name: "Index for search" },
  { n: 4, p: D.funnel, name: "Gather candidates" },
  { n: 5, p: D.gears, name: "Rank and filter" },
  { n: 6, p: D.slot, name: "Serve to timelines" },
];
const route = G.fillet(JOURNEY.filter((p, i) => i === 0 || G.len3(G.sub3(p, JOURNEY[i - 1])) > 0.5), 5, 6, { P, tube: 1.6 });
layer = 0;
const JR = 1.6;
R.route("journey", route, JR, { owner: "journey", piece: "stack", limp: true, ends: [false, false], touch: ["screen", "device", "post", "inf.db", "inf.index", "inf.lens", "eng.funnel", "eng.gear", "eng.sieve", "eng.item", "eng.belt"] });
tubePieces(route, JR, P, { maxLength: 8, caps: false }).forEach((p, i) => {
  const d = k.pathOf(p.points.map(at));
  put(`journey:${i}`, p.mid, `<path class="xs-jglow" d="${d}"/><path class="xs-jcore" d="${d}"/>`, [A.tube(p.points, p.radii)], { acc: false });
});
const jd = k.pathOf(route.map(at));

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const groups = R.items.map((item) => `<g class="${item.cls}">${item.svg}</g>`);

// ---------- labels in two columns, each on its anchor's side ----------
const ROW = 15;
function columnOf(list, x, align) {
  list.sort((a, b) => a.a[1] - b.a[1]);
  let y = TOP;
  for (const l of list) {
    l.y = Math.max(l.a[1], y);
    y = l.y + ROW;
  }
  let limit = H - FOOT;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].y = Math.min(list[i].y, limit);
    limit = list[i].y - ROW;
  }
  const dir = align === "end" ? 1 : -1;
  return list.map((l) => {
    const knee = x + dir * 8;
    return `<g class="xs-label L${l.layer}"><path class="xs-leader" d="M${f2(l.a[0])} ${f2(l.a[1])}L${f2(knee + dir * 12)} ${f2(l.y)}L${f2(knee)} ${f2(l.y)}"/><circle class="xs-pin" cx="${f2(l.a[0])}" cy="${f2(l.a[1])}" r="1.9"/><text x="${f2(x + dir * 4)}" y="${f2(l.y + 3.8)}" text-anchor="${align}">${l.text}</text></g>`;
  });
}
LABELS.forEach((l) => (l.a = at(l.p)));
const plateX = [PLAT.x, PLAT.x + PW].flatMap((x) => [PLAT.y, PLAT.y + PD].map((y) => at([x, y, 0])[0]));
const midX = W / 2;
const COL_L = Math.min(...plateX) - 58;
const COL_R = Math.max(...plateX) + 58;
const labelSvg = [...columnOf(LABELS.filter((l) => (l.side ?? (l.a[0] < midX ? "L" : "R")) === "L"), COL_L, "end"), ...columnOf(LABELS.filter((l) => (l.side ?? (l.a[0] < midX ? "L" : "R")) === "R"), COL_R, "start")];

const stepSvg = STEPS.map((s) => {
  const [x, y] = at(s.p);
  return `<g class="xs-step"><circle cx="${f2(x)}" cy="${f2(y)}" r="8"/><text x="${f2(x)}" y="${f2(y + 3.5)}" text-anchor="middle">${s.n}</text></g>`;
}).join("");

const LABEL =
  "An isometric exploded view of a social network in seven floating layers. From the top: the interface, a three-column screen with a post card lifted out of the timeline; the building blocks of a post; the social graph of accounts and follows, one of them blocked; the feed engine, a funnel of candidates, ranking gears, a filter sieve and two conveyors for For You and Following; trust and safety, a shield, a verification badge, a community note and a report flag; the business model, an ad board, a subscription card, a coin stack for creator payouts and a plug for the API; and the infrastructure, server racks, databases, a globe for the CDN and a magnifying glass over a search index. A glowing line traces a post from the composer down to storage, up through the feed engine and back to the timeline, in six numbered steps.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL, body: [`<g class="xs-back">${back.join("")}</g>`, `<g class="xs-stack">${groups.join("")}</g>`, `<g class="xs-labels">${labelSvg.join("")}</g>`, `<g class="xs-journey" aria-hidden="true"><path class="xs-pulse" pathLength="1000" d="${jd}"/>${stepSvg}</g>`] });

const CSS = readFileSync(join(HERE, "xcom.css"), "utf8");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anatomy of x.com</title>
<style>${k.ISO_CSS}${CSS}</style></head><body class="iso" data-theme="light"><main class="xs-page">
<header class="xs-head"><p class="xs-fig">Fig 4</p><h1>Anatomy of x.com</h1><p class="xs-sub">Seven layers between writing a post and seeing it in a timeline</p></header>
<figure class="xs-figure">${svg}
<figcaption>
<ol class="xs-key">${STEPS.map((s) => `<li><span>${s.n}</span>${s.name}</li>`).join("")}</ol>
<p class="xs-caption">The post's journey follows the "For You" pipeline X described when it open-sourced its recommendation code in March 2023. About 1,500 candidate posts are gathered for each timeline, roughly half from accounts you follow and half from accounts you don't. A neural network of about 48 million parameters ranks them, and filters then drop posts from blocked or muted accounts, posts you've already seen and posts that break the rules before the timeline is served. The layers are a general picture of how a service like this is built, not a diagram of X's own systems. No logos or real people are shown.</p>
</figcaption>
</figure>
<p class="credit">Made by <a href="https://www.littlenicethings.com/">Studio Little Nice Things</a> · <a href="https://buymeacoffee.com/littlenicethings">Support future experiments ☕️</a></p>
</main></body></html>`;
writeFileSync(join(HERE, "xcom.html"), page);
// the dark page is the same drawing on the dark tokens
writeFileSync(join(HERE, "xcom-dark.html"), page.replace('<body class="iso" data-theme="light">', '<body class="iso" data-theme="dark">').replace("<title>Anatomy of x.com</title>", '<title>Anatomy of x.com</title><meta name="color-scheme" content="dark">'));
console.log("wrote xcom.html and xcom-dark.html", `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `${R.solids.length} solids`, `${LABELS.length} labels`);
A.auditOrExit(R, P, { cover: ["post"] });
