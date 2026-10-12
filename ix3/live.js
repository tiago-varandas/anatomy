
const D = __DATA__;
const PJ = D.P;
const stage = document.querySelector(".cx-stage");
const svg = stage.querySelector("svg");
const car = svg.querySelector(".cx-car");
const readout = document.querySelector("[data-readout]");
const status = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const partButtons = [...document.querySelectorAll(".cx-part")];
const STAGGER = D.stagger;
const SPRING = D.spring;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const nodes = [...car.querySelectorAll(":scope > .it")].map((el) => {
  const m = el.dataset.m.split(",").map(Number);
  return { el, piece: el.dataset.piece, key: +el.dataset.k, m, lift: dot(m, D.V), shown: "" };
});
let order = nodes.map((_, i) => i);
const piece = Object.fromEntries(STAGGER.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
const cells = [...svg.querySelectorAll(".cx-cell")];
const spokes = Object.fromEntries([...svg.querySelectorAll("[data-spokes]")].map((el) => [el.dataset.spokes, el.querySelector("path")]));
const chargeLine = nodes.filter((n) => n.el.dataset.route === "charge.cable");
const chargerPct = svg.querySelector('[data-charger="pct"]');
const chargerKw = svg.querySelector('[data-charger="kw"]');
const hvLines = nodes.filter((n) => n.el.dataset.route === "hv.front" || n.el.dataset.route === "hv.rear");

let clock = 0;
let apart = false;
let selected = null;
let mode = "parked"; // parked · drive · charge
let armed = null;
let soc = 0.8;
const drive = { v: 0, x: 0, throttle: 0, braking: false, t: 0, at100: null, power: 0, phase: "" };
let chargeKw = 0;
let chargeMin = 0;
let touring = !still.matches;
let tourClock = 0;
let tourStep = 0;
let idleTimer = 0;
let visible = false;
let frame = 0;
let last = 0;

const fmt = (v) => Math.round(v).toLocaleString("en-US");
function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}
function announce(text) {
  status.textContent = text;
  stage.setAttribute("aria-valuetext", text);
}

function setApart(on) {
  if (apart === on) return;
  apart = on;
  const goal = on ? 1 : 0;
  const list = (on ? STAGGER : [...STAGGER].reverse()).filter((id) => piece[id].target !== goal || piece[id].pending);
  let index = 0;
  for (const id of on ? STAGGER : [...STAGGER].reverse()) {
    if (piece[id].target === goal && !piece[id].pending) continue;
    if (piece[id].target === goal) piece[id].pending = null;
    else piece[id].pending = { value: goal, at: clock + (still.matches ? 0 : index++ * SPRING.stagger) };
  }
  void list;
  announce(on ? "Taking apart: body, cabin, four corners, two drive units, battery." : "Putting it back together.");
  run();
}

function select(id) {
  if (id === "stand") id = null;
  if (selected === id) return;
  selected = id;
  for (const node of nodes) {
    if (id && node.piece === id) node.el.setAttribute("data-on", "");
    else node.el.removeAttribute("data-on");
  }
  if (id) stage.setAttribute("data-focus", "");
  else stage.removeAttribute("data-focus");
  partButtons.forEach((b) => (b.dataset.part === id ? b.setAttribute("data-on", "") : b.removeAttribute("data-on")));
  if (id) announce(D.pieces[id].say);
}

function steer(state, dt, calm) {
  if (state.pending && clock >= state.pending.at) {
    state.target = state.pending.value;
    state.pending = null;
  }
  if (calm) {
    state.x = state.target;
    state.v = 0;
    return false;
  }
  for (let i = 0; i < SPRING.substeps; i++) {
    const h = dt / SPRING.substeps;
    state.v += ((state.target - state.x) * SPRING.stiffness - state.v * SPRING.damping) * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.target - state.x) < 2e-4 && Math.abs(state.v) < 2e-4) {
    state.x = state.target;
    state.v = 0;
    return state.pending !== null;
  }
  return true;
}

function place() {
  for (const node of nodes) {
    const share = piece[node.piece].x;
    const tx = (D.EX[0] * node.m[0] + D.EY[0] * node.m[1] + D.EZ[0] * node.m[2]) * share;
    const ty = (D.EX[1] * node.m[0] + D.EY[1] * node.m[1] + D.EZ[1] * node.m[2]) * share;
    const text = share === 0 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== node.shown) {
      node.shown = text;
      if (text) node.el.setAttribute("transform", text);
      else node.el.removeAttribute("transform");
    }
  }
  const next = nodes.map((_, i) => i).sort((a, b) => nodes[a].key + nodes[a].lift * piece[nodes[a].piece].x - (nodes[b].key + nodes[b].lift * piece[nodes[b].piece].x));
  if (next.some((index, i) => index !== order[i])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    car.appendChild(fragment);
    order = next;
  }
}

const together = () => STAGGER.every((id) => piece[id].x === 0 && piece[id].target === 0 && !piece[id].pending);

function startDrive() {
  if (!together()) {
    armed = "drive";
    setApart(false);
    return;
  }
  armed = null;
  mode = "drive";
  Object.assign(drive, { v: 0, x: drive.x, throttle: 1, braking: false, t: 0, at100: null, phase: "launch" });
  stage.setAttribute("data-mode", "drive");
  announce("Launch: full power, both motors.");
  run();
}
function startCharge() {
  if (!together()) {
    armed = "charge";
    setApart(false);
    return;
  }
  armed = null;
  mode = "charge";
  soc = 0.1;
  chargeMin = 0;
  stage.setAttribute("data-mode", "charge");
  announce("Plugged in to a 400 kilowatt charger at 10 percent.");
  run();
}
function park() {
  mode = "parked";
  stage.removeAttribute("data-mode");
  drive.throttle = 0;
  drive.braking = false;
}

function stepModes(dt, calm) {
  if (armed && together()) (armed === "drive" ? startDrive : startCharge)();
  if (mode === "drive") {
    if (calm) {
      drive.at100 = 4.9;
      drive.v = 0;
      park();
      announce("0 to 100 kilometres per hour in 4.9 seconds.");
      return;
    }
    drive.t += dt;
    drive.power = stepDrive(drive, dt);
    if (drive.at100 === null && drive.v >= 100 / 3.6) {
      drive.at100 = drive.t;
      drive.throttle = 0;
      drive.braking = true;
      drive.phase = "brake";
      announce(`100 kilometres per hour in ${drive.t.toFixed(1)} seconds.`);
    }
    if (drive.braking && drive.v <= 0) park();
  }
  if (mode === "charge") {
    const minutes = calm ? 30 : dt * 2; // the time-lapse: 2 minutes of charging per second
    chargeKw = stepCharge({ get soc() { return soc; }, set soc(v) { soc = v; } }, minutes);
    chargeMin += minutes;
    if (soc >= 0.8) {
      chargeKw = 0;
      park();
      announce("80 percent after 21 minutes. Unplugged.");
    }
  }
}

let litCols = -1;
let litCharge = null;
function draw() {
  // wheels: the spokes turn with the distance driven
  const phase = -drive.x / WHEEL_R;
  for (const w of D.wheels) {
    const el = spokes[w.id];
    if (!el) continue;
    const want = phase.toFixed(3);
    if (el.dataset.phase !== want) {
      el.dataset.phase = want;
      el.setAttribute("d", GL.spokesOf(w.F, w.face, 6.9, 25.1, 10, PJ, { sweep: 0.22, phase: w.F.a[1] > 0 ? phase : -phase }));
    }
  }
  // cells: columns light up to the state of charge, front to back
  const cols = Math.round(soc * D.cells);
  if (cols !== litCols) {
    litCols = cols;
    cells.forEach((el, i) => el.toggleAttribute("data-full", i < cols));
  }
  const charging = mode === "charge";
  if (charging !== litCharge) {
    litCharge = charging;
    chargeLine.forEach((n) => n.el.toggleAttribute("data-hot", charging));
  }
  const pctText = `${(soc * 100).toFixed(0)}%`;
  if (chargerPct.textContent !== pctText) chargerPct.textContent = pctText;
  const kwText = charging ? `${fmt(chargeKw)} kW` : "ready";
  if (chargerKw.textContent !== kwText) chargerKw.textContent = kwText;
  const driving = mode === "drive" && drive.throttle > 0;
  hvLines.forEach((n) => n.el.toggleAttribute("data-hot", driving));
  // readout from the same instant of the model
  let text;
  if (selected) text = D.pieces[selected].say;
  else if (armed) text = "closing up · arming";
  else if (!together()) text = apart && STAGGER.every((id) => piece[id].x === piece[id].target) ? "apart · 8 assemblies" : apart ? "taking apart" : "closing up";
  else if (mode === "drive") {
    const kmh = drive.v * 3.6;
    text = drive.phase === "launch" ? `launch · ${kmh.toFixed(0)} km/h · ${drive.t.toFixed(1)} s · ${fmt(drive.power)} kW` : `0–100 in ${drive.at100.toFixed(1)} s · braking ${kmh.toFixed(0)} km/h`;
  } else if (mode === "charge") text = `charging · ${(soc * 100).toFixed(0)}% · ${fmt(chargeKw)} kW · ${chargeMin.toFixed(0)} min`;
  else text = `parked · ${(soc * 100).toFixed(0)}% · ${fmt(CAR.range * soc)} km`;
  say(text);
}

// The idle tour: a launch, a look inside, then a fast charge.
const TOUR = [
  [1.2, () => startDrive()],
  [10.5, () => setApart(true)],
  [12.6, () => select("battery")],
  [14.6, () => select("front")],
  [16.4, () => select(null)],
  [17.0, () => setApart(false)],
  [19.6, () => startCharge()],
];
const TOUR_LENGTH = 34;

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (touring) {
    tourClock += dt;
    while (tourStep < TOUR.length && tourClock >= TOUR[tourStep][0]) TOUR[tourStep++][1]();
    if (tourClock >= TOUR_LENGTH) {
      tourClock = 0;
      tourStep = 0;
    }
  }
  let moving = false;
  for (const id of STAGGER) moving = steer(piece[id], dt, calm) || moving;
  stepModes(dt, calm);
  place();
  draw();
  const busy = moving || mode !== "parked" || armed || STAGGER.some((id) => piece[id].pending);
  frame = visible && (touring || busy) ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (still.matches) return;
    select(null);
    touring = true;
    tourClock = 0;
    tourStep = 0;
    run();
  }, 12000);
}

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

const ORDER = ["body", "cabin", "battery", "front", "rear", "fl", "fr", "rl", "rr"];
stage.addEventListener("keydown", (event) => {
  let handled = true;
  if (event.key === " " || event.key === "Enter") {
    park();
    setApart(!apart);
  } else if (event.key === "d" || event.key === "D") startDrive();
  else if (event.key === "c" || event.key === "C") startCharge();
  else if (event.key === "ArrowRight" || event.key === "ArrowDown") select(ORDER[(ORDER.indexOf(selected) + 1) % ORDER.length]);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") select(ORDER[(ORDER.indexOf(selected) - 1 + ORDER.length) % ORDER.length]);
  else if (event.key === "Escape") select(null);
  else handled = false;
  if (!handled) return;
  event.preventDefault();
  takeOver();
  run();
});
svg.addEventListener("pointermove", (event) => {
  const it = event.target.closest && event.target.closest(".it");
  const id = it ? it.dataset.piece : null;
  if (id && id !== "stand") {
    takeOver();
    select(id);
    run();
  }
});
svg.addEventListener("pointerleave", () => {
  select(null);
  run();
});
svg.addEventListener("click", () => {
  takeOver();
  park();
  setApart(!apart);
});
partButtons.forEach((b) =>
  b.addEventListener("click", () => {
    takeOver();
    select(selected === b.dataset.part ? null : b.dataset.part);
    run();
  }),
);
draw();
