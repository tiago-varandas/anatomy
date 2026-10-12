
const DATA = __DATA__;
const PJ = DATA.P;
const stage = document.querySelector(".nb-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const status = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const NAMES = ["food", "bell", "light"];

const fluids = [];
svg.querySelectorAll("[data-fluid]").forEach((el) => (fluids[+el.dataset.fluid] = el));
const chunksOf = (route) => [...svg.querySelectorAll(`.it[data-route="${route}"]`)].map((el) => ({ el, from: +el.dataset.from, to: +el.dataset.to, hot: false }));
const lines = [0, 1, 2].map((i) => chunksOf(`axon${i}`));
const outLine = chunksOf("axonD");
const valves = [];
svg.querySelectorAll("[data-valve]").forEach((el) => (valves[+el.dataset.valve] = el));
const keys = [];
svg.querySelectorAll("[data-key]").forEach((el) => (keys[+el.dataset.key] = el));
const counter = svg.querySelector("[data-count]");
const needles = DATA.valves.map((v, i) => {
  const item = svg.querySelector(`.it[data-name="syn${i}.dial"]`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "iso-line nb-needle");
  path.setAttribute("data-tone", "hi");
  path.setAttribute("data-free", "end");
  item.appendChild(path);
  return { item, path, shown: SYN.start[i], drawn: null };
});

const zOf = (t, v) => t.zb + 8 + ((v - DATA.range[0]) / (DATA.range[1] - DATA.range[0])) * 72;
const SPAN = 1.5 * Math.PI;
const FROM = -0.75 * Math.PI;
function needleD(i, w) {
  const v = DATA.valves[i];
  const a = FROM + (Math.max(0, Math.min(SYN.max, w)) / SYN.max) * SPAN;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return lineOnTop([v.x + s * 1.3, v.y - c * 1.3], [v.x + s * v.r, v.y - c * v.r], v.top + 0.15, PJ);
}

let net = makeNet();
const drawnZ = [null, null, null, null];
let queue = [];
let label = "rest";
let action = null;
let resetting = false;
let pressed = [-1e9, -1e9, -1e9];
let clock = 0;
let tourClock = 0;
let touring = !still.matches;
let idleTimer = 0;
let frame = 0;
let last = 0;
let visible = false;

function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}
function announce(text) {
  status.textContent = text;
  stage.setAttribute("aria-valuetext", text);
}

function stim(i) {
  stimulate(net, i);
  pressed[i] = clock;
}
function act(kind) {
  if (kind === "reset") {
    resetting = true;
    label = "reset";
    action = null;
    announce("Synapses reset: food 20, bell 5, light 5 mV.");
    return;
  }
  resetting = false;
  if (kind === "pair") {
    stim(1);
    queue.push({ at: net.t + 2, i: 0 });
  } else stim(kind);
  const pairs = kind === "pair" ? (action && action.kind === "pair" ? action.pairs + 1 : 1) : 0;
  label = kind === "pair" ? `bell + food ${pairs}` : `${NAMES[kind]} alone`;
  if (kind === 0) label = "food";
  action = { kind, pairs, t: net.t, spikes: net.count, fired: net.fired[3], said: false };
}

// The idle tour: control stimuli, the unconditioned response, four pairings, the test, the control again.
const TOUR = [
  [0.2, "reset"],
  [1.6, 2],
  [4.2, 1],
  [6.8, 0],
  [9.4, "pair"],
  [12.0, "pair"],
  [14.6, "pair"],
  [17.2, "pair"],
  [20.0, 1],
  [22.6, 2],
];
const TOUR_LENGTH = 25.4;
let tourIndex = 0;

function outcome() {
  if (!action) return "";
  const fired = net.fired[3] > action.t;
  if (fired) return " · D fires";
  if (net.t - action.t > 14) return " · no spike";
  return "";
}

function draw(dt) {
  const t = net.t;
  // fluid columns
  DATA.tanks.forEach((tank, i) => {
    const v = net.n[i].v;
    const z = zOf(tank, v);
    if (drawnZ[i] === null || Math.abs(drawnZ[i] - z) > 0.04) {
      drawnZ[i] = z;
      fluids[i].innerHTML = solidSvg(cylinder(tank.cx, tank.cy, DATA.fluidR, tank.g0 + 0.3, z - tank.g0 - 0.3, PJ, 40), { tone: "hi" });
    }
    const hot = t - net.fired[i] < 7;
    if (hot !== fluids[i].hasAttribute("data-hot")) fluids[i].toggleAttribute("data-hot", hot);
  });
  // pulses along the axons
  const light = (chunks, s0, s1) => chunks.forEach((c) => (c.want = c.want || (c.to > s0 && c.from < s1)));
  lines.forEach((chunks) => chunks.forEach((c) => (c.want = false)));
  outLine.forEach((c) => (c.want = false));
  const valveHot = [false, false, false];
  for (const pulse of net.pulses) {
    const share = (t - pulse.at) / DELAY.axon;
    if (share > 1.08) continue;
    const total = DATA.routes[`axon${pulse.line}`].total;
    const s = Math.min(1, share) * total;
    light(lines[pulse.line], s - 16, s + 0.5);
    if (Math.abs(s - DATA.valves[pulse.line].along) < 10) valveHot[pulse.line] = true;
  }
  for (const spike of net.out) {
    const share = (t - spike.at) / DELAY.out;
    if (share > 1.08) continue;
    const s = Math.min(1, share) * DATA.routes.axonD.total;
    light(outLine, s - 14, s + 0.5);
  }
  for (const chunks of [...lines, outLine])
    for (const c of chunks)
      if (c.want !== c.hot) {
        c.hot = c.want;
        c.el.toggleAttribute("data-hot", c.hot);
      }
  // synapse dials: the needle follows the weight like a gauge (0.25 s), and lights when it learns
  needles.forEach((n, i) => {
    n.shown = still.matches ? net.w[i] : n.shown + (net.w[i] - n.shown) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(n.shown - net.w[i]) < 0.01) n.shown = net.w[i];
    if (n.drawn === null || Math.abs(n.drawn - n.shown) > 0.005) {
      n.drawn = n.shown;
      n.path.setAttribute("d", needleD(i, n.shown));
    }
    const learning = t - net.learned[i] < 14 || Math.abs(n.shown - net.w[i]) > 0.05;
    if (learning !== n.item.hasAttribute("data-learn")) n.item.toggleAttribute("data-learn", learning);
    const hot = valveHot[i] || learning;
    if (hot !== valves[i].hasAttribute("data-hot")) valves[i].toggleAttribute("data-hot", hot);
  });
  // keys
  keys.forEach((el, i) => {
    const down = clock - pressed[i] < 0.22;
    const want = down ? translateAlong(PJ, [0, 0, -1.4]) : "";
    if ((el.getAttribute("transform") || "") !== want) {
      if (want) el.setAttribute("transform", want);
      else el.removeAttribute("transform");
    }
  });
  const text = String(net.count % 1000).padStart(3, "0");
  if (counter.textContent !== text) counter.textContent = text;
  const result = outcome();
  say(`${label}${result} · bell ${net.w[1].toFixed(1)} mV`);
  if (action && result && !action.said) {
    action.said = true;
    announce(`${label}${result}. Bell synapse ${net.w[1].toFixed(1)} millivolts.`);
  }
}

function quiet() {
  return !queue.length && !resetting && net.pulses.length === 0 && net.out.length === 0 && net.n.every((n) => Math.abs(n.v - NEURON.rest) < 0.05 && Math.abs(n.q) < 0.01) && needles.every((n, i) => n.shown === net.w[i]) && clock - Math.max(...pressed) > 0.3;
}

function advance(simDt) {
  let left = simDt;
  while (left > 0) {
    const next = queue.length ? Math.min(...queue.map((q) => q.at)) - net.t : Infinity;
    const step = Math.min(left, Math.max(0.01, next));
    stepNet(net, step);
    left -= step;
    queue = queue.filter((q) => {
      if (q.at <= net.t + 1e-6) {
        stimulate(net, q.i);
        pressed[q.i] = clock;
        return false;
      }
      return true;
    });
  }
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring) {
    tourClock += dt;
    while (tourIndex < TOUR.length && tourClock >= TOUR[tourIndex][0]) act(TOUR[tourIndex++][1]);
    if (tourClock >= TOUR_LENGTH) {
      tourClock = 0;
      tourIndex = 0;
    }
  }
  if (resetting) {
    net.w = net.w.map((w, i) => w + (SYN.start[i] - w) * (1 - Math.exp(-dt / 0.45)));
    if (net.w.every((w, i) => Math.abs(w - SYN.start[i]) < 0.01)) {
      net.w = [...SYN.start];
      resetting = false;
    }
  }
  advance((dt * 1000) / DATA.slow);
  draw(dt);
  frame = visible && (touring || !quiet()) ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};

// Under reduced motion an action plays out at once: the result, not the animation.
function settleNow() {
  advance(60);
  needles.forEach((n, i) => (n.shown = net.w[i]));
  if (resetting) {
    net.w = [...SYN.start];
    resetting = false;
  }
  draw(1);
}

function user(kind) {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (still.matches) return;
    touring = true;
    tourClock = 0;
    tourIndex = 0;
    run();
  }, 9000);
  act(kind);
  if (still.matches) settleNow();
  else run();
}

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

stage.addEventListener("keydown", (event) => {
  const map = { 1: 0, 2: 1, 3: 2 };
  let kind = null;
  if (event.key in map) kind = map[event.key];
  if (event.key === " " || event.key === "Enter") kind = "pair";
  if (event.key === "r" || event.key === "R" || event.key === "Escape") kind = "reset";
  if (kind === null) return;
  event.preventDefault();
  user(kind);
});
keys.forEach((el, i) =>
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    stage.focus({ preventScroll: true });
    user(i);
  }),
);
stage.addEventListener("focus", () => announce(`${label}. Bell synapse ${net.w[1].toFixed(1)} millivolts, food ${net.w[0].toFixed(1)}, light ${net.w[2].toFixed(1)}.`));
draw(0);
