
const DATA = __DATA__;
const stage = document.querySelector(".rs-stage");
const readout = document.querySelector("[data-readout]");
const status = stage.querySelector("[data-status]");
const buttons = [...document.querySelectorAll(".rs-btn")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LIGHT = (document.body.getAttribute("data-theme") || "dark") === "light";
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- flipbooks: doors, the guard and the lever show the pose nearest their angle ----------
const flip = (root, angles) => {
  const poses = angles.map((a) => root.querySelector(`[data-a="${a}"]`));
  let shown = poses.findIndex((p) => p && p.hasAttribute("data-show"));
  return (deg) => {
    let best = 0;
    angles.forEach((a, i) => {
      if (Math.abs(a - deg) < Math.abs(angles[best] - deg)) best = i;
    });
    if (best !== shown) {
      if (poses[shown]) poses[shown].removeAttribute("data-show");
      poses[best].setAttribute("data-show", "");
      shown = best;
    }
  };
};

// ---------- the views: four drawings of the one car, a quarter turn apart ----------
// The state (the tank, the car, the run, the pieces, the doors and the switch) is one; each view holds
// its own elements and draws that state from its own camera. Only the view on screen is drawn.
function makeView(el, VD) {
  const by = (sel) => [...el.querySelectorAll(sel)];
  const byRoute = (name) => by(`.it[data-route="${name}"]`);
  const carG = el.querySelector(".rs-carsvg .rs-car");
  const backSvg = el.querySelector("svg.iso-svg:not(.rs-layer)");
  const knob = el.querySelector("[data-knob]");
  const nodes = [...carG.querySelectorAll(":scope > .it")].map((it) => {
    const m = it.dataset.m.split(",").map(Number);
    return { el: it, piece: it.dataset.piece, key: +it.dataset.k, m, lift: dot(m, VD.V), shown: "" };
  });
  return {
    el,
    D: VD,
    screenOf: (m) => [VD.EX[0] * m[0] + VD.EY[0] * m[1] + VD.EZ[0] * m[2], VD.EX[1] * m[0] + VD.EY[1] * m[1] + VD.EZ[1] * m[2]],
    carG,
    shadowG: backSvg.querySelector(".rs-shadow"),
    nodes,
    order: nodes.map((_, i) => i),
    supply: [...VD.supply.flatMap(byRoute), ...by('.it[data-air="hub"]'), ...by('.it[data-air^="tank."]'), ...by('.it[data-air="cabin"]'), ...by('.it[data-air="lever"]')],
    noz: VD.nozzles.map((n) => ({
      els: [...n.routes.flatMap(byRoute), ...by(`.it[data-valve="${n.id}"]`), ...by(`.it[data-nozzle="${n.id}"]`), ...by(n.routes.includes("air.rear") ? '.it[data-air="rear"]' : n.routes.includes("air.front") ? '.it[data-air="front"]' : ".none")],
      led: el.querySelector(`[data-led="${n.id}"]`),
      fb: el.querySelector(`[data-jet="${n.id}"]`),
    })),
    filling: [...byRoute("air.fill"), ...by('.it[data-air="fill"]')],
    doorSet: VD.doors.map((id) => flip(el.querySelector(`.it[data-door="${id}"]`), VD.doorPoses)),
    guardSet: flip(el.querySelector(".it[data-guard]"), VD.guardPoses),
    leverSet: flip(el.querySelector(".it[data-switch]"), VD.switchPoses),
    hoseChunks: by('.it[data-route="hose"]').map((c) => ({ el: c, from: +c.dataset.from, to: +c.dataset.to, fitting: c.dataset.fitting })),
    knob,
    knobMove: knob.querySelector(".rs-knob-move"),
    gaugeNeedle: el.querySelector("[data-gauge] path"),
    cartNeedle: el.querySelector("[data-cartneedle]"),
    spokes: Object.fromEntries(by("[data-spokes]").map((s) => [s.dataset.spokes, s.querySelector("path")])),
    gl: undefined,
    shown: {},
  };
}
const views = [...stage.querySelectorAll(".rs-view")].map((el, i) => makeView(el, DATA.views[i]));
let viewIndex = 0;
let view = views[0];
let D = view.D; // the data of the view on screen; what the views share is the same in each
let PJ = D.P;

// ---------- the pieces the car comes apart into ----------
// Each piece rides its own spring along its move; the stagger sends them out in order and back in
// reverse, the way the build's audit replays them. The air system never moves.
const SPRING = D.spring;
const pieces = Object.fromEntries(D.stagger.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
pieces.panel.x = pieces.panel.target = 1; // the side panel starts off
let stageNow = 1; // 0 together, 1 the side panel off, 2 taken apart
const goalOf = (id, s) => (id === "panel" ? (s >= 1 ? 1 : 0) : s >= 2 ? 1 : 0);
function setStage(s) {
  stageNow = s;
  const changing = D.stagger.filter((id) => goalOf(id, s) !== (pieces[id].pending ? pieces[id].pending.value : pieces[id].target));
  const out = changing.filter((id) => goalOf(id, s) === 1);
  const back = changing.filter((id) => goalOf(id, s) === 0).reverse();
  [...back, ...out].forEach((id, i) => (pieces[id].pending = { value: goalOf(id, s), at: clock + i * SPRING.stagger }));
  go();
}
const moving = () => D.stagger.some((id) => { const p = pieces[id]; return p.pending || p.x !== p.target || p.v !== 0; });
const assembled = () => D.stagger.every((id) => id === "panel" || (!pieces[id].pending && pieces[id].target === 0 && pieces[id].x === 0));
function placePieces() {
  for (const n of view.nodes) {
    const share = pieces[n.piece] ? pieces[n.piece].x : 0;
    const [tx, ty] = view.screenOf(n.m).map((v) => v * share);
    const text = share === 0 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== n.shown) {
      n.shown = text;
      if (text) n.el.setAttribute("transform", text);
      else n.el.removeAttribute("transform");
    }
  }
  const nodes = view.nodes;
  const depth = (n) => n.key + n.lift * (pieces[n.piece] ? pieces[n.piece].x : 0);
  const next = nodes.map((_, i) => i).sort((a, b) => depth(nodes[a]) - depth(nodes[b]));
  if (next.some((index, i) => index !== view.order[i])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    view.carG.appendChild(fragment);
    view.order = next;
  }
}
function springStep(s, dt, calm) {
  if (calm) {
    s.x = s.target;
    s.v = 0;
    return false;
  }
  for (let i = 0; i < SPRING.substeps; i++) {
    const h = dt / SPRING.substeps;
    s.v += ((s.target - s.x) * SPRING.stiffness - s.v * SPRING.damping) * h;
    s.x += s.v * h;
  }
  if (Math.abs(s.target - s.x) < 2e-4 && Math.abs(s.v) < 2e-4) {
    s.x = s.target;
    s.v = 0;
    return false;
  }
  return true;
}

// ---------- the air path ----------
const NOZ = D.nozzles.map((n) => ({
  ...n,
  on: 0, // the valve's smoothed duty, for the lights and the plume
  plume: 0, // the plume's own envelope: it grows and dies more slowly than the valve
  dust: 0,
}));
const lit = new Map();
function light(els, on) {
  for (const el of els) {
    const was = lit.get(el) || false;
    if (was !== on) {
      lit.set(el, on);
      el.toggleAttribute("data-hot", on);
    }
  }
}

// ---------- the doors, the guard and the lever: their angles, shown by each view's flipbooks ----------
const doors = D.doors.map((id, i) => ({ id, a: 0, set: (deg) => view.doorSet[i](deg) }));
const guard = { a: 0, set: (deg) => view.guardSet(deg) };
const lever = { a: 32, set: (deg) => view.leverSet(deg) };
const LEVER_AT = { performance: -32, thrust: 0, rocket: 32 };

// ---------- the hose: it reels in along its own path before a run, out to the port to refill ----------
const hose = { x: 1, target: 1 };
function hoseAt(s) {
  const P = D.hosePath;
  for (let i = 1; i < P.length; i++) {
    if (s <= P[i][0] || i === P.length - 1) {
      const t = clamp((s - P[i - 1][0]) / Math.max(1e-6, P[i][0] - P[i - 1][0]), 0, 1);
      return [P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, P[i - 1][2] + (P[i][2] - P[i - 1][2]) * t];
    }
  }
  return [P[P.length - 1][1], P[P.length - 1][2]];
}
function placeHose() {
  const s = hose.x * D.hoseTotal;
  const key = Math.round(s * 4);
  if (key === view.shown.hose) return;
  view.shown.hose = key;
  const { knob, knobMove } = view;
  for (const c of view.hoseChunks) {
    const show = c.fitting === "1" ? hose.x > 0.999 : c.fitting === "0" ? true : c.from < s - 0.05;
    c.el.style.display = show ? "" : "none";
  }
  if (hose.x > 0.999 || hose.x < 0.002) knob.style.display = "none";
  else {
    knob.style.display = "";
    const [x, y] = hoseAt(s);
    knobMove.setAttribute("transform", `translate(${(x - D.knob[0]).toFixed(2)} ${(y - D.knob[1]).toFixed(2)})`);
  }
}

// ---------- the hub gauge and the cart gauge ----------
function placeGauges(p, cartBar) {
  const g = D.gauge;
  const a = (-135 + 270 * clamp(p / 350e5, 0, 1)) * (Math.PI / 180);
  // the dial's zero is toward the car's tail; the needle sweeps clockwise seen from above
  const tip = [g.x + Math.sin(a) * (g.r - 1), g.y + Math.cos(a) * (g.r - 1), g.z + 0.05];
  const c = iso([g.x, g.y, g.z + 0.05], PJ);
  const t = iso(tip, PJ);
  const d = `M${c[0].toFixed(2)} ${c[1].toFixed(2)}L${t[0].toFixed(2)} ${t[1].toFixed(2)}`;
  if (d !== view.shown.gauge) {
    view.shown.gauge = d;
    view.gaugeNeedle.setAttribute("d", d);
  }
  view.cartNeedle.setAttribute("transform", `rotate(${(-138 + 276 * clamp(cartBar / 400, 0, 1)).toFixed(1)} 6 6)`);
}

// ---------- wheels: spokes turn with the distance rolled ----------
function placeWheels(yMetres) {
  const phase = (yMetres * 100) / 34;
  const want = phase.toFixed(3);
  if (want === view.shown.spokes) return;
  view.shown.spokes = want;
  for (const w of D.wheels) {
    const el = view.spokes[w.id];
    if (el) el.setAttribute("d", GL.spokesOf(w.F, w.face, 6.6, D.rimR, 12, PJ, { sweep: 0.3, phase }));
  }
}

// ---------- state ----------
let tank = tankOf(1);
let car = carOf();
let run = null;
let version = "rocket";
let switching = null; // the guard and lever sequence after picking a version
let refill = null;
let armed = null; // a run waiting for the hose to reel in and the car to be whole
let apartNext = false; // taking apart, once the hose is in
let refillNext = false; // refilling, once the car is whole again
const pilot = { hold: false, left: false, right: false, turnL: false, turnR: false, presses: 0 }; // the hands-on flight's inputs
const pilotTurn = () => (car3d ? (pilot.turnL ? 1 : 0) - (pilot.turnR ? 1 : 0) : 0);
// the live 3D car: shown while the car is turned, or off its line, and faded in and out over the drawing
const car3d = (() => {
  try {
    return DATA.mesh ? makeCar3D(DATA.mesh) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
})();
let look3d = 0; // 0 the drawing, 1 the live car
let restoreStage = null; // the panel stage to go back to after the live car
// the orbit: where the car has been in this flight, and whether to show it
let orbitOn = false;
let orbit = [];
let next = null; // what the visitor asked for while something else finishes: "fly" or "launch"
const pilotMove = () => (pilot.right ? 1 : 0) - (pilot.left ? 1 : 0);
let clock = 0;
let visible = false;
let frame = 0;
let last = 0;
let touring = !still.matches;
let tourStep = 0;
let tourWait = 1.6; // the tour starts after a moment of stillness
let idleTimer = 0;
let lastAnnounce = "";
const restZ = -((SPEC.dryMass + FULL) * SPEC.g) / 4e5;
car.z = restZ; // parked on its springs, not floating at contact height
let summary = "";

function announce(text) {
  if (text === lastAnnounce) return;
  lastAnnounce = text;
  status.textContent = text;
}
const fmt = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function pick(v) {
  if (run || refill || armed) return; // no switching while a run is under way or waiting on the hose
  if (v === version && !switching) return;
  version = v;
  switching = { t: 0, from: lever.a, to: LEVER_AT[v] };
  summary = "";
  markButtons();
  announce(`${v[0].toUpperCase()}${v.slice(1)} selected: ${v === "rocket" ? "all ten nozzles, lift-off" : v === "thrust" ? "the rear four nozzles, launch" : "wheels only, launch"}.`);
  go();
}
function markButtons() {
  buttons.forEach((b) => b.toggleAttribute("data-on", b.dataset.act === version || (b.dataset.act === "apart" && stageNow === 2) || (b.dataset.act === "panel" && stageNow === 0) || (b.dataset.act === "orbit" && orbitOn)));
}
// a run waits for the hose to reel in and for the car to be whole again
function prepare(mode) {
  if (version !== "performance") doorTarget = 88;
  if (stageNow === 2) setStage(1);
  if (hose.target > 0 || hose.x > 0.001) hose.target = 0;
  if (hose.x > 0.001 || !assembled() || switching) {
    armed = mode;
    announce(stageNow === 2 || !assembled() ? "Putting the car back together." : "Reeling in the fill hose.");
    go();
    return;
  }
  start(mode);
}
// The visitor's asks never get lost: whatever is under way (the tour's run, the lever, a refill, the
// car being apart) finishes quickly first, then the ask runs.
function hurry() {
  if (run && run.mode !== "pilot") run.slow = Math.max(run.slow, 2.5);
}
function fire() {
  if (run && run.mode === "pilot") return;
  next = "launch";
  hurry();
  go();
}
// hands-on: hold to fly, from any version and any state; the switch turns to Rocket by itself,
// the tanks refill first if there is not enough air to lift, and a quick click still gives a short hop
function pressFly() {
  pilot.hold = true;
  pilot.presses += 1;
  if (still.matches) {
    // reduced motion: no flight to watch, so show where the automatic hop ends
    if (version !== "rocket") pick("rocket");
    if (!run && !refill && !armed) prepare("rocket");
    return;
  }
  if (run && run.mode === "pilot") return;
  next = "fly";
  hurry();
  // a refill may stop early when there is already air enough to fly
  if (refill && canFly(tank)) {
    refill = null;
    hose.target = 0;
  }
  go();
}
function releaseFly() {
  pilot.hold = false;
}
// runs the visitor's ask once nothing else is under way
function serveNext() {
  if (!next || run || armed || switching || apartNext || refillNext) return;
  if (next === "fly") {
    if (version !== "rocket") {
      pick("rocket");
      return;
    }
    if (refill) return;
    if (!canFly(tank)) {
      announce("Not enough air to lift: refilling first.");
      startRefill();
      return;
    }
    next = null;
    prepare("pilot");
  } else if (next === "launch") {
    if (refill) return;
    next = null;
    prepare(version);
  }
}
function toggleApart() {
  if (run || armed || refill) {
    announce("Land and stop first, then take it apart.");
    return;
  }
  if (stageNow === 2) {
    setStage(1);
    announce("Putting the car back together.");
  } else if (hose.x > 0.001) {
    hose.target = 0;
    apartNext = true;
    announce("Reeling in the fill hose, then taking the car apart.");
  } else {
    setStage(2);
    announce("Taken apart: the skin, the diffuser and the cabin lift off the air system, which stays where it is.");
  }
  markButtons();
  go();
}
// ---------- spinning: the camera steps a quarter turn around the car ----------
function spin(step = 1) {
  const from = view;
  viewIndex = (viewIndex + step + views.length) % views.length;
  view = views[viewIndex];
  D = view.D;
  PJ = D.P;
  // the arriving view takes the shared state: every cached drawing of it is stale
  view.shown = {};
  for (const n of view.nodes) n.shown = null;
  view.el.setAttribute("data-on", "");
  view.el.removeAttribute("aria-hidden");
  from.el.setAttribute("aria-hidden", "true");
  from.el.removeAttribute("data-on");
  if (from.gl && from.gl.drawn) {
    from.gl.far.clear();
    from.gl.near.clear();
    from.gl.drawn = false;
  }
  if (!still.matches) {
    // the view that leaves fades out over the one that arrives, on the figure's own clock
    from.fade = 1;
    from.el.setAttribute("data-leaving", "");
    from.el.style.opacity = "1";
  }
  doors.forEach((d) => d.set(d.a));
  guard.set(guard.a);
  lever.set(lever.a);
  placePieces();
  placeHose();
  draw();
  announce(`Seen from the ${view.D.name}.`);
  go();
}
function togglePanel() {
  setStage(stageNow === 0 ? 1 : 0);
  announce(stageNow ? "Side panel off, floating above the car." : "Back together, panel on.");
  markButtons();
}
function start(v) {
  armed = null;
  if (still.matches) {
    // reduced motion: run the whole thing at once and show where it ends
    const t0 = tank.m;
    const r = simulate(v, tank);
    tank = r.tank;
    summary = v === "rocket" ? `${fmt(r.airtime, 1)} s in the air` : v === "thrust" ? `peak ${fmt(r.car.peakG, 1)} g` : `peak ${fmt(r.car.peakG, 1)} g`;
    announce(`${v}: ${summary}, ${fmt(t0 - tank.m, 1)} kg of air used.`);
    draw();
    return;
  }
  if ((v === "rocket" || v === "pilot") && usableOf(tank) < 0.12) {
    summary = "not enough air to lift: refill";
    announce("Not enough air for a lift-off. Press F to refill.");
    draw();
    return;
  }
  car = carOf();
  car.z = restZ;
  if (v === "pilot") orbit = [];
  run = { ...runOf(v), used0: tank.m, airtime: 0, peakThrust: 0, peakZ: 0, slow: v === "rocket" || v === "pilot" ? 1 : 0.25, wait: v !== "performance" && doors[0].a < 80 ? 0.22 : 0 };
  summary = "";
  if (v !== "performance") doorTarget = 88;
  announce(v === "pilot" ? "Ready to fly: hold Space to climb, let go to settle, arrows to move." : v === "rocket" ? "Rocket: lift-off." : v === "thrust" ? "Thrust launch, at quarter speed." : "Performance launch, at quarter speed.");
  go();
}
function startRefill() {
  if (run || refill || armed) return;
  if (usableOf(tank) > 0.995) {
    announce("The tanks are full.");
    return;
  }
  if (stageNow === 2 || !assembled()) {
    // the port is in the tail: the car goes back together before the cart connects
    if (stageNow === 2) setStage(1);
    refillNext = true;
    announce("Putting the car back together to refill.");
    return;
  }
  refill = { phase: "hose", minutes: 0, from: tank.m };
  hose.target = 1;
  announce("Connecting the fill cart.");
  go();
}
let doorTarget = 0;

// ---------- the autopilot and the plume ----------
const duties = D.nozzles.map(() => 0);
function stepRun(dt) {
  const sub = 6;
  const h = (dt * run.slow) / sub;
  if (run.mode === "pilot") {
    if (run.presses !== pilot.presses) {
      run.presses = pilot.presses;
      run.kick = 0.6; // seconds of climb a press gives, held or not: a quick tap is a short hop
    }
    run.kick = Math.max(0, (run.kick || 0) - dt * run.slow);
    run.hold = pilot.hold || run.kick > 0;
    run.move = pilotMove();
    run.turn = pilotTurn();
  }
  // turned or off its line when the flight ends: the crew put it back, shown as a short tow
  if (run.phase === "towing") {
    run.towT += dt;
    const e = clamp(run.towT / 1.8, 0, 1);
    const k = 1 - e * e * (3 - 2 * e);
    // it settles onto its springs while it is moved
    for (let i = 0; i < sub; i++) stepCar(car, tank, NOZ.map(() => 0), 0, dt / sub);
    car.x = run.towFrom[0] * k;
    car.y = run.towFrom[1] * k;
    car.yaw = run.towFrom[2] * k;
    car.vx = car.vy = car.yawRate = 0;
    duties.fill(0);
    run.thrust = 0;
    if (e >= 1) {
      car.x = car.y = car.yaw = 0;
      run.phase = "done";
      run.tow = false;
    }
  } else {
    for (let i = 0; i < sub; i++) {
      const { duties: d, tyre } = RUNS[run.mode](run, car, tank);
      d.forEach((v, j) => (duties[j] = v));
      const { mdot, thrust } = stepCar(car, tank, d, tyre, h);
      stepTank(tank, mdot, 0, h);
      run.peakThrust = Math.max(run.peakThrust, thrust);
      if (car.air) run.airtime += h;
      run.peakZ = Math.max(run.peakZ, car.z - restZ);
      run.thrust = thrust;
      if (run.phase === "done") break;
    }
  }
  if (run.phase === "done" && run.tow) {
    run.phase = "towing";
    run.towT = 0;
    run.towFrom = [car.x, car.y, car.yaw];
    announce("Flight done: the crew put it back on the line.");
    return;
  }
  if (run.mode === "rocket") {
    if (run.phase === "hover" && run.said !== "hover") {
      run.said = "hover";
      announce("Hovering: the corner nozzles hold it level.");
    }
    if (run.phase === "land" && run.said !== "land") {
      run.said = "land";
      announce("Air reserve reached: landing.");
    }
  }
  if (run.mode === "pilot" && run.phase === "land" && run.said !== "land") {
    run.said = "land";
    announce("Air reserve reached: it lands itself.");
  }
  if (run.phase === "done") {
    const used = run.used0 - tank.m;
    summary =
      run.mode === "pilot"
        ? `${fmt(run.airtime, 1)} s in the air · ${fmt(used)} kg of air${run.out ? " · refill to fly again" : ""}`
        : run.mode === "rocket"
        ? `${fmt(run.airtime, 1)} s in the air · ${fmt(used)} kg of air`
        : run.mode === "thrust"
          ? `${fmt(car.peakG, 1)} g · 0–60 mph pace ${fmt(26.82 / (car.peakG * 9.81), 2)} s`
          : `${fmt(car.peakG, 1)} g · 0–60 mph pace ${fmt(26.82 / (car.peakG * 9.81), 2)} s`;
    announce(`${run.mode === "pilot" ? "Flight" : run.mode[0].toUpperCase() + run.mode.slice(1)} done: ${summary}. ${fmt(usableOf(tank) * 100)} percent of the air left.`);
    duties.fill(0);
    run = null;
    doorTarget = 0;
  }
}

// ---------- the tour ----------
const TOUR = [
  ["idle"], // a resumed tour first lets anything under way finish
  ["pick", "performance"], ["wait", 1.4], ["fire"], ["idle"], ["wait", 1.2],
  ["pick", "thrust"], ["wait", 1.4], ["fire"], ["idle"], ["wait", 1.2],
  ["pick", "rocket"], ["wait", 1.4], ["fire"], ["idle"], ["wait", 1.6],
  ["refill"], ["idle"], ["wait", 2],
  ["apart"], ["idle"], ["wait", 4], ["together"], ["idle"], ["wait", 2], ["spin"], ["wait", 2],
];
function stepTour(dt) {
  if (tourWait > 0) {
    tourWait -= dt;
    return;
  }
  const [what, arg] = TOUR[tourStep];
  if (what === "idle") {
    if (run || refill || armed || switching || apartNext || refillNext || moving() || hose.x !== hose.target) return;
  } else if (what === "wait") tourWait = arg;
  else if (what === "spin") spin(1);
  else if (what === "apart") {
    if (stageNow !== 2) toggleApart();
  } else if (what === "together") {
    if (stageNow === 2) toggleApart();
  }
  else if (what === "pick") pick(arg);
  else if (what === "fire") fire();
  else if (what === "refill") startRefill();
  tourStep = (tourStep + 1) % TOUR.length;
}
function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (still.matches) return;
    touring = true;
    tourStep = 0;
    tourWait = 0;
    go();
  }, 14000);
}

// ---------- the frame ----------
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (touring && !calm) stepTour(dt);
  let busy = false;
  // the switch: guard up, lever across, guard down
  if (switching) {
    busy = true;
    switching.t += dt;
    const t = switching.t;
    const ease = (x) => x * x * (3 - 2 * x);
    guard.a = 120 * (t < 0.3 ? ease(t / 0.3) : t < 0.75 ? 1 : 1 - ease(clamp((t - 0.75) / 0.3, 0, 1)));
    lever.a = switching.from + (switching.to - switching.from) * ease(clamp((t - 0.3) / 0.4, 0, 1));
    if (t >= 1.05 || calm) {
      guard.a = 0;
      lever.a = switching.to;
      switching = null;
    }
    guard.set(guard.a);
    lever.set(lever.a);
  }
  // the hose
  if (hose.x !== hose.target) {
    busy = true;
    const speed = 1 / 0.9;
    hose.x = calm ? hose.target : hose.x + clamp(hose.target - hose.x, -speed * dt, speed * dt);
  }
  placeHose();
  // the pieces: each starts when its stagger comes up, then follows its spring
  for (const id of D.stagger) {
    const p = pieces[id];
    if (p.pending && (calm || clock >= p.pending.at)) {
      p.target = p.pending.value;
      p.pending = null;
    }
    if (p.pending) busy = true;
    if (springStep(p, dt, calm)) busy = true;
  }
  placePieces();
  for (const v of views) {
    if (!v.fade) continue;
    busy = true;
    v.fade = calm ? 0 : Math.max(0, v.fade - dt / 0.32);
    v.el.style.opacity = (v.fade * v.fade * (3 - 2 * v.fade)).toFixed(3);
    if (v.fade === 0) {
      v.el.removeAttribute("data-leaving");
      v.el.style.opacity = "";
    }
  }
  if (armed && hose.x <= 0.001 && !switching && assembled()) start(armed);
  serveNext();
  if (next) busy = true;
  if (apartNext && hose.x <= 0.001) {
    apartNext = false;
    setStage(2);
    markButtons();
    announce("Taken apart: the skin, the diffuser and the cabin lift off the air system, which stays where it is.");
  }
  if (refillNext && assembled() && !run) {
    refillNext = false;
    startRefill();
  }
  // the run
  if (run) {
    busy = true;
    if (run.wait > 0) run.wait -= dt;
    else stepRun(dt);
    sampleOrbit();
  } else {
    duties.fill(0);
    stepTank(tank, 0, 0, dt);
  }
  // the live car takes over while the car is turned, off its line, being turned, or towed back; the side
  // panel goes back on for it, and comes off again after
  const turning = run && run.mode === "pilot" && car.air && pilotTurn() !== 0;
  const want3d = !!car3d && (Math.abs(car.yaw) > 0.003 || Math.abs(car.x) > 0.003 || turning || (run && run.phase === "towing"));
  if (want3d && stageNow !== 0 && restoreStage === null) {
    restoreStage = stageNow;
    setStage(0);
  }
  const target3d = want3d ? 1 : 0;
  if (look3d !== target3d) {
    busy = true;
    look3d = calm ? target3d : clamp(look3d + (Math.sign(target3d - look3d) * dt) / 0.25, 0, 1);
  }
  if (!want3d && look3d === 0 && restoreStage !== null) {
    setStage(restoreStage);
    restoreStage = null;
  }
  // refill: the cart's compressor, shown as a time-lapse
  if (refill) {
    busy = true;
    if (refill.phase === "hose" && hose.x >= 0.999) {
      refill.phase = "fill";
      announce("Filling from the cart.");
    }
    if (refill.phase === "fill") {
      const lapse = 300; // five minutes of filling every second
      const sub = 4;
      for (let i = 0; i < sub; i++) stepTank(tank, 0, SPEC.fill, (dt * lapse) / sub);
      refill.minutes += (dt * lapse) / 60;
      if (tank.m >= FULL) {
        tank = tankOf(1);
        refill = null;
        summary = "";
        announce("Full again: 300 bar.");
      }
    }
  }
  // doors swing to their target
  for (const d of doors) {
    const want = doorTarget;
    if (d.a !== want) {
      busy = true;
      d.a = calm ? want : d.a + clamp(want - d.a, -600 * dt, 600 * dt);
      d.set(d.a);
    }
  }
  // valve lights and plume envelopes: the light follows the valve; the fog builds and lingers
  NOZ.forEach((n, i) => {
    const target = duties[i];
    n.on += (target - n.on) * (1 - Math.exp(-dt / 0.03));
    const rise = target > n.plume ? 0.07 : 0.32;
    n.plume += (target - n.plume) * (1 - Math.exp(-dt / rise));
    const hit = n.kind !== "main" ? target : 0;
    n.dust += (hit * 0.9 - n.dust) * (1 - Math.exp(-dt / (hit > n.dust ? 0.15 : 1.4)));
    if (n.plume > 1e-3 || n.dust > 1e-3) busy = true;
    if (n.plume < 1e-4 && target === 0) n.plume = 0;
    if (n.dust < 1e-4 && hit === 0) n.dust = 0;
  });
  draw();
  frame = visible && (busy || touring) ? requestAnimationFrame(tick) : 0;
}
function go() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

// ---------- drawing the instant ----------
function draw() {
  const firing = NOZ.map((n) => n.on > 0.18);
  view.noz.forEach((e, i) => {
    light(e.els, firing[i]);
    if (e.led) e.led.toggleAttribute("data-on", firing[i]);
  });
  light(view.supply, firing.some(Boolean) || (refill && refill.phase === "fill"));
  light(view.filling, !!(refill && refill.phase === "fill"));
  // the car: across and along the pad and up, with its roll; the shadow stays on the pad
  const lift = Math.max(0, car.z - restZ) * 100;
  const along = car.y * 100;
  const across = car.x * 100;
  const [tx, ty] = view.screenOf([across, along, lift]);
  const c = iso([across, along, 45 + lift], PJ);
  const roll = (car.roll * 180) / Math.PI;
  const text = `translate(${tx.toFixed(2)} ${ty.toFixed(2)})${Math.abs(roll) > 0.02 ? ` rotate(${(-roll).toFixed(2)} ${c[0].toFixed(1)} ${c[1].toFixed(1)})` : ""}`;
  if (text !== view.shown.car) {
    view.shown.car = text;
    view.carG.setAttribute("transform", text);
  }
  // the drawing gives way to the live car while it is turned
  const lineAlpha = (1 - look3d).toFixed(3);
  if (lineAlpha !== view.shown.lineAlpha) {
    view.shown.lineAlpha = lineAlpha;
    view.carG.style.opacity = lineAlpha;
    view.carG.style.visibility = look3d > 0.999 ? "hidden" : "";
  }
  if (car3d) {
    if (look3d > 0.001) {
      const svg = view.carG.ownerSVGElement;
      if (car3d.canvas.previousSibling !== svg) svg.after(car3d.canvas);
      car3d.draw(D, { yaw: car.yaw, roll: car.roll, x: across, y: along, z: lift }, look3d);
    } else car3d.clear();
  }
  // the shadow: carried across the pad and turned with the car in the pad's plane
  const [sx, sy] = view.screenOf([across, along, 0]);
  const fade = 1 / (1 + lift / 45);
  const shadowText = `${sx.toFixed(2)},${sy.toFixed(2)},${fade.toFixed(3)},${car.yaw.toFixed(4)}`;
  if (shadowText !== view.shown.shadow) {
    view.shown.shadow = shadowText;
    let turn = "";
    if (Math.abs(car.yaw) > 1e-4) {
      // the pad's plane on screen is the map from (x, y) to EX·x + EY·y; turn it about the car's centre
      const [a, b] = D.EX;
      const [cc, d] = D.EY;
      const det = a * d - b * cc;
      const co = Math.cos(car.yaw);
      const si = Math.sin(car.yaw);
      // M = A · R · A⁻¹
      const ra = [a * co + cc * si, b * co + d * si, -a * si + cc * co, -b * si + d * co];
      const m = [(ra[0] * d - ra[2] * b) / det, (ra[1] * d - ra[3] * b) / det, (-ra[0] * cc + ra[2] * a) / det, (-ra[1] * cc + ra[3] * a) / det];
      const [ox, oy] = D.origin;
      turn = ` translate(${ox.toFixed(2)} ${oy.toFixed(2)}) matrix(${m.map((v) => v.toFixed(4)).join(" ")} 0 0) translate(${(-ox).toFixed(2)} ${(-oy).toFixed(2)})`;
    }
    view.shadowG.setAttribute("transform", `translate(${sx.toFixed(2)} ${sy.toFixed(2)})${turn}`);
    view.shadowG.style.opacity = fade.toFixed(3);
  }
  drawOrbit();
  placeWheels(car.y);
  placeGauges(tank.p, refill ? 330 - 20 * Math.min(1, refill.minutes / 20) : 330);
  // the readout: the model's numbers at this instant; estimates are marked ≈
  const bar = tank.p / 1e5;
  const pct = usableOf(tank) * 100;
  const kn = run ? (run.thrust || 0) / 1e3 : 0;
  const metres = lift / 100;
  let phase = "";
  const pieceMoving = moving();
  if (switching) phase = "switching";
  else if (armed) phase = assembled() ? "reeling in the hose" : "putting it back";
  else if (next && run && run.mode !== "pilot") phase = "finishing the run";
  else if (run && run.phase === "towing") phase = "back to the line";
  else if (run && run.mode === "pilot")
    phase =
      run.phase === "ready" ? "hold to fly" : run.phase === "fly" ? (!run.hold ? "settling" : car.z > PILOT.ceiling - 0.08 ? "hovering" : "climbing") : run.phase === "land" ? "landing · air low" : "rolling back";
  else if (run) phase = run.mode === "rocket" ? (run.phase === "lift" ? "lift-off" : run.phase === "hover" ? "hover" : run.phase === "land" ? "landing" : "rolling back") : run.phase === "launch" ? "launch · ¼ speed" : run.phase === "brake" ? "braking · ¼ speed" : "rolling back";
  else if (refill) phase = refill.phase === "hose" ? "connecting" : `filling · ${fmt(refill.minutes)} min`;
  else if (apartNext) phase = "reeling in the hose";
  else if (pieceMoving && stageNow === 2) phase = "taking apart";
  else if (pieceMoving && pieces.body.x > 0) phase = "putting it back";
  else if (stageNow === 2) phase = "taken apart";
  else if (summary) phase = summary;
  const heading = (car.yaw * 180) / Math.PI;
  const turnedBy = Math.abs(heading) >= 0.5 ? `${fmt(Math.abs(heading))}° ${heading > 0 ? "left" : "right"}` : "";
  const text2 = [version, phase, `≈${fmt(bar)} bar`, `${fmt(pct)}% air`, `≈${fmt(kn)} kN`, `${fmt(metres, 2)} m`, turnedBy].filter(Boolean).join(" · ");
  if (readout.textContent !== text2) readout.textContent = text2;
  const gl = glOf(view);
  if (gl) drawPlumes(gl, { x: across, y: along, z: lift });
  else view.noz.forEach((e, i) => e.fb && (e.fb.style.opacity = (Math.min(1, NOZ[i].plume) * 0.55).toFixed(3)));
}

// the car's turn on the pad and its roll, as a column-major 3×3: Rz(yaw) · Ry(-roll)
function poseRot() {
  const cy = Math.cos(car.yaw);
  const sy = Math.sin(car.yaw);
  const cr = Math.cos(-car.roll);
  const sr = Math.sin(-car.roll);
  return [cy * cr, sy * cr, -sr, -sy, cy, 0, cy * sr, sy * sr, cr];
}

// ---------- the orbit: the paths the car's two ends sweep, traced on the pad ----------
// The car turns about its own centre, so the centre's path stays inside the car, where it could only be
// drawn through the body. The orbit is what the nose and the tail sweep, with the centre's track between
// them, all traced on the pad: painted just after the pad's own markings, so the chocks, the cart, the
// hose, the car's shadow and the dust all lie on top of them, as they would on a real line on the pad.
const NOSE = -D.carExtent.y0;
const TAIL = D.carExtent.y1;
function orbitLayer(v) {
  if (v.orbit) return v.orbit;
  const backSvg = v.el.querySelector("svg.iso-svg:not(.rs-layer)");
  const [, , w, h] = backSvg.getAttribute("viewBox").split(/[ ,]+/).map(Number);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "rs-orbit");
  // the pad under the car shows through its open side and its wheel arches; the mask keeps the marks
  // there to the moments the car is up off the pad, so a parked car never has them in its middle; its
  // edge is soft, so a path fades in as it comes out from under the car
  const id = `rs-orbit-under-${views.indexOf(v)}`;
  g.innerHTML = `<filter id="${id}-soft" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="4"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><polygon fill="#000" filter="url(#${id}-soft)"/></mask><g mask="url(#${id})"></g>`;
  backSvg.querySelector('.it[data-name="stand.paint"]').after(g);
  v.orbit = { marks: g.lastChild, foot: g.querySelector("polygon"), shown: "", footShown: "", hideShown: "" };
  return v.orbit;
}
// a path's parts that lie on the pad: each segment cut to the pad's top, a little in from its edge
const PAD_IN = 3;
const onPad = ([x, y]) => x >= D.pad.x0 + PAD_IN && x <= D.pad.x1 - PAD_IN && y >= D.pad.y0 + PAD_IN && y <= D.pad.y1 - PAD_IN;
function padParts(points) {
  const lo = [D.pad.x0 + PAD_IN, D.pad.y0 + PAD_IN];
  const hi = [D.pad.x1 - PAD_IN, D.pad.y1 - PAD_IN];
  const parts = [];
  let part = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const d = [points[i][0] - a[0], points[i][1] - a[1]];
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 2 && t0 <= t1; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (a[k] < lo[k] || a[k] > hi[k]) t0 = 2;
        continue;
      }
      const ta = (lo[k] - a[k]) / d[k];
      const tb = (hi[k] - a[k]) / d[k];
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 > t1) {
      part = null;
      continue;
    }
    if (!part || t0 > 0) parts.push((part = [[a[0] + d[0] * t0, a[1] + d[1] * t0]]));
    part.push([a[0] + d[0] * t1, a[1] + d[1] * t1]);
    if (t1 < 1) part = null;
  }
  return parts;
}
function drawOrbit() {
  const layer = orbitLayer(view);
  const show = orbitOn && orbit.length > 1;
  const [ox, oy] = D.origin;
  const at = ([x, y]) => {
    const [sx, sy] = view.screenOf([x, y, 0]);
    return `${(ox + sx).toFixed(1)} ${(oy + sy).toFixed(1)}`;
  };
  if (show) {
    // the car's footprint now, 12 cm larger all round, and how much of what lies under it to hide: all
    // of it on the pad, none of it from 40 cm up
    const E = D.carExtent;
    const M = 12;
    const cx = car.x * 100;
    const cy = car.y * 100;
    const co = Math.cos(car.yaw);
    const si = Math.sin(car.yaw);
    const foot = [[E.x0 - M, E.y0 - M], [E.x1 + M, E.y0 - M], [E.x1 + M, E.y1 + M], [E.x0 - M, E.y1 + M]].map(([x, y]) => at([cx + x * co - y * si, cy + x * si + y * co])).join(" ");
    if (foot !== layer.footShown) {
      layer.footShown = foot;
      layer.foot.setAttribute("points", foot);
    }
    const up = clamp((Math.max(0, car.z - restZ) * 100 - 4) / 36, 0, 1);
    const hide = (1 - up * up * (3 - 2 * up)).toFixed(3);
    if (hide !== layer.hideShown) {
      layer.hideShown = hide;
      layer.foot.setAttribute("fill-opacity", hide);
    }
  }
  const key = show ? `${orbit.length}|${viewIndex}|${orbit[orbit.length - 1].t}` : "off";
  if (key === layer.shown) return;
  layer.shown = key;
  if (!show) {
    layer.marks.innerHTML = "";
    return;
  }
  // the nose sits NOSE ahead of the centre and the tail TAIL behind it; ahead is -y at no turn
  const endOf = (p, r) => [p.x + Math.sin(p.yaw) * r, p.y - Math.cos(p.yaw) * r];
  const tracks = { nose: orbit.map((p) => endOf(p, NOSE)), tail: orbit.map((p) => endOf(p, -TAIL)), track: orbit.map((p) => [p.x, p.y]) };
  let paths = "";
  const swept = {};
  for (const [name, points] of Object.entries(tracks)) {
    // the samples that moved: a car that only climbs leaves no path, not a dot
    const moved = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.4);
    const d = moved.length > 1 ? padParts(moved).map((part) => `M${part.map(at).join("L")}`).join("") : "";
    if (d) paths += `<path class="rs-orbit-${name}" d="${d}"/>`;
    swept[name] = !!d;
  }
  // on each end's path a dot every half second (the nose) or second (the tail), larger on the second,
  // and one where the path ends now; a dot that would sit on the last one is left out
  let dots = "";
  const shown = {};
  const mark = (name, p, r) => {
    if (!swept[name] || !onPad(p) || (shown[name] && Math.hypot(p[0] - shown[name][0], p[1] - shown[name][1]) < 3)) return;
    shown[name] = p;
    const [x, y] = at(p).split(" ");
    dots += `<circle class="rs-orbit-dot" cx="${x}" cy="${y}" r="${r}"${name === "tail" ? " data-tail" : ""}/>`;
  };
  let due = 0;
  orbit.forEach((p, i) => {
    if (p.t < due) return;
    due = p.t + 0.5;
    const whole = Math.abs(p.t - Math.round(p.t)) < 0.26;
    mark("nose", tracks.nose[i], whole ? 1.5 : 0.95);
    if (whole) mark("tail", tracks.tail[i], 1.1);
  });
  const last = orbit.length - 1;
  mark("nose", tracks.nose[last], 1.5);
  mark("tail", tracks.tail[last], 1.1);
  layer.marks.innerHTML = paths + dots;
}
function sampleOrbit() {
  if (!run || run.mode !== "pilot" || run.phase === "towing") return;
  const last = orbit[orbit.length - 1];
  const p = { x: car.x * 100, y: car.y * 100, z: Math.max(0, car.z - restZ) * 100, yaw: car.yaw, t: +car.t.toFixed(3) };
  if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 2 || Math.abs(p.yaw - last.yaw) > 0.02) orbit.push(p);
}

// ---------- WebGL: the cold-gas plumes and the dust they raise ----------
const N = D.nozzles.length;
const FRAG = `
uniform float uLight;
uniform float uNear;
uniform vec3 uExit[${N}];
uniform vec3 uDir[${N}];
uniform float uOn[${N}];
uniform float uDust[${N}];
uniform float uSize[${N}];
uniform float uSide[${N}];
uniform float uDeflY;
uniform float uDeflTop;
uniform vec2 uDeflX;
const int NJ = ${N};
float gauss(float d2, float s){ return exp(-d2 / (s * s)); }
// distance from this pixel's ray to a world point, in world units: the screen distance over uK
float rayDist2(vec2 vb, vec3 c){ vec2 d = (project(c) - vb) / uK; return dot(d, d); }
float segDist(vec2 p, vec2 a, vec2 b){ vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0., 1.); return length(p - a - ab * t); }
void main(){
  vec2 vb = viewOf(gl_FragCoord.xy);
  vec3 p0 = rayOf(vb);
  vec3 VV = towardViewer();
  float fog = 0.;
  float dust = 0.;
  float under = 0.;
  for (int i = 0; i < NJ; i++) {
    float on = uOn[i];
    float side = uSide[i];
    float mine = mix(1. - side, side, step(.5, uNear));
    vec3 e = uExit[i];
    vec3 d = uDir[i];
    float r0 = uSize[i];
    if (on > .002 && mine > .5) {
      // how far the jet runs before something stops it: the pad for the down jets, the deflector for the rear ones
      float stopAt = d.z < -.2 ? -e.z / d.z : (d.y > .5 ? max(10., uDeflY + e.z * .567 - e.y) : 140.);
      float len = min(stopAt, d.z < -.2 ? 180. : 150.);
      float decay = d.y > .5 ? 85. : (r0 < 4. ? 38. : 70.);
      float reach = (r0 + len * .22) * 3.4 + 40.;
      if (segDist(vb, project(e), project(e + d * (len + 70.))) / uK > reach) continue;
      for (int k = 0; k < 30; k++) {
        float u = (float(k) + .5) / 30.;
        float s = len * pow(u, 1.5);
        float ds = len * 1.5 * pow(u, .5) / 30.;
        vec3 c = e + d * s;
        // the jet leaves the lip clear and supersonic; it fogs as it drags in damp air and chills it
        float a = on * smoothstep(r0 * 1.6, r0 * 6., s) * exp(-s / decay);
        if (a < 1e-4) continue;
        float sig = r0 * .9 + s * .21;
        vec3 q = c * .05 - d * uTime * 3.4;
        float t1 = noise3(q);
        float t2 = noise3(q * 2.3 + 7.1);
        float sw = sig * (.82 + .36 * t2);
        float w = gauss(rayDist2(vb, c), sw) * ds / (sw * 1.77);
        if (w < 1e-5) continue;
        float turb = .3 + .95 * t1 + .5 * t2;
        fog += a * turb * w * 3.4;
        // where the ray passes the axis: below it the cloud is in its own shade
        float tc = dot(c - p0, VV);
        float dz = p0.z + tc * VV.z - c.z;
        under += a * turb * w * 3.4 * smoothstep(.6 * sw, -.6 * sw, dz);
      }
      // the rear jets turn up the deflector's face and roll over its top
      if (d.y > .5 && stopAt < 150.) {
        vec3 hit = e + d * stopAt;
        float a0 = on * exp(-stopAt / decay) * smoothstep(r0 * 1.6, r0 * 6., stopAt);
        for (int k = 0; k < 14; k++) {
          float u = (float(k) + .5) / 14.;
          float s = 80. * u;
          vec3 c = hit + vec3(0., .5, .86) * s + vec3(0., s * s * .003, s * s * .002);
          float sig = r0 * 1.6 + s * .34;
          float a = a0 * exp(-s / 60.) * smoothstep(0., 10., s);
          float t1 = noise3(c * .045 + vec3(0., 0., -uTime * 1.8));
          float w = gauss(rayDist2(vb, c), sig) * (80. / 14.) / (sig * 1.77);
          fog += a * (.35 + 1.1 * t1) * w * 1.9;
        }
      }
    }
    // the pad: where a down jet lands it spreads into a ragged rolling ring and lifts dust
    float du = uDust[i];
    if ((du > .002 || on > .002) && uNear < .5 && d.z < -.2) {
      vec3 g = e + d * (-e.z / d.z);
      float h = e.z;
      float R = 10. + h * .36 + 14. * du;
      for (int k = 0; k < 3; k++) {
        float z = 1.5 + float(k) * 4.5;
        vec3 q = onFloor(vb, z);
        vec2 rv = q.xy - g.xy;
        float r = length(rv);
        if (r > R * 2.6 + 30.) continue;
        vec3 dir = vec3(rv / max(r, 1e-3), 0.);
        float rag = .45 + .95 * noise3(vec3(dir.xy * 2.4, r * .05 - uTime * 1.2));
        float ring = gauss((r - R) * (r - R), 9. + R * .4) * rag + .45 * gauss(r * r, R * .9) * (.35 + .65 * rag);
        float layer = exp(-z / (5. + h * .04));
        fog += on * ring * layer * .38;
        dust += du * ring * layer * .55 * (.55 + .9 * noise3(vec3(q.xy * .07, uTime * .35)));
      }
    }
  }
  float fogA = 1. - exp(-fog * .9);
  float dustA = 1. - exp(-dust * 1.0);
  float shadeU = clamp(under / max(1e-4, fog), 0., 1.);
  vec4 ink;
  if (uLight < .5) {
    // dark: a cool grey-white mist, the dust a warm grey
    vec3 col = vec3(.74, .78, .84) * fogA * mix(1., .7, shadeU) + vec3(.36, .33, .29) * dustA;
    col = tonemap(col, 1.25);
    ink = vec4(col, max(col.r, max(col.g, col.b)));
  } else {
    // light: steam on paper, the crown near white, the edge grey, the underside in its own shade; dust a warm grey
    vec3 seen = mix(vec3(.84, .87, .90), vec3(.97, .975, .98), smoothstep(.15, .8, fogA));
    seen = mix(seen, vec3(.72, .76, .81), shadeU * .75);
    vec4 f = vec4(seen, 1.) * (fogA * .86);
    vec4 g = vec4(vec3(.73, .70, .65), 1.) * (dustA * .6);
    ink = f + g * (1. - f.a);
  }
  float a = ink.a;
  float nn = (hash12(gl_FragCoord.xy + fract(uTime * .61) * 91.) + hash12(gl_FragCoord.yx * 1.37 + fract(uTime * .37) * 57.) - 1.) / 255.;
  ink = max(ink + nn * smoothstep(0., 1.5 / 255., a), 0.);
  ink.rgb = min(ink.rgb, vec3(ink.a));
  gl_FragColor = ink;
}`;
// each view's pair of canvases: the far one under the car (far jets, the dust on the pad), the near one
// over it (the jets on the camera's side); they are made when the view first shows
function glOf(v) {
  if (v.gl !== undefined) return v.gl;
  v.gl = null;
  try {
    const VD = v.D;
    const make = (canvas, near) =>
      glLayer({
        canvas,
        fragment: FRAG,
        view: [VD.W, VD.H],
        camera: VD.camera,
        uniforms: ["uExit", "uDir", "uOn", "uDust", "uDeflY"],
        fixed: { uLight: LIGHT ? 1 : 0, uNear: near, uSize: new Float32Array(VD.nozzles.map((n) => n.size)), uSide: new Float32Array(VD.nozzles.map((n) => (n.near ? 1 : 0))), uDeflTop: VD.deflector.top, uDeflX: [VD.deflector.x0, VD.deflector.x1] },
      });
    const far = make(v.el.querySelector(".rs-far"), 0);
    const near = make(v.el.querySelector(".rs-near"), 1);
    if (far && near) {
      v.gl = { far, near, drawn: false };
      v.el.setAttribute("data-gl", "");
    }
  } catch (error) {
    console.error(error);
  }
  return v.gl;
}
function drawPlumes(layers, pose) {
  const active = NOZ.some((n) => n.plume > 1e-3 || n.dust > 1e-3);
  if (!active) {
    if (layers.drawn) {
      layers.far.clear();
      layers.near.clear();
      layers.drawn = false;
    }
    return;
  }
  const exits = new Float32Array(N * 3);
  const dirs = new Float32Array(N * 3);
  // each jet leaves its nozzle wherever the car has carried and turned it
  const R = poseRot();
  const turned = (v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  NOZ.forEach((n, i) => {
    const e = turned([n.exit[0], n.exit[1], n.exit[2] - 45]);
    exits.set([e[0] + pose.x, e[1] + pose.y, e[2] + 45 + pose.z], i * 3);
    dirs.set(turned(n.dir), i * 3);
  });
  const values = {
    uExit: exits,
    uDir: dirs,
    uOn: new Float32Array(NOZ.map((n) => n.plume)),
    uDust: new Float32Array(NOZ.map((n) => n.dust)),
    uDeflY: D.deflector.y0,
  };
  const t = still.matches ? 0.8 : clock;
  layers.far.draw(values, t);
  layers.near.draw(values, t);
  layers.drawn = true;
}

// ---------- input ----------
// The figure's keys work while it is on screen and focus is on the page, the figure or its buttons.
const KEYS = new Set(["1", "2", "3", " ", "Enter", "ArrowLeft", "ArrowRight", "a", "A", "d", "D", "f", "F", "s", "S", "q", "Q", "e", "E", "o", "O"]);
const ours = (el) => !el || el === document.body || el === document.documentElement || el === stage || buttons.includes(el);
document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || !visible || !ours(document.activeElement)) return;
  takeOver(); // any key stops the tour for a while
  if (!KEYS.has(event.key)) return;
  if (event.key === "Enter" && buttons.includes(document.activeElement)) return; // Enter presses the focused button
  event.preventDefault();
  if (event.repeat) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "1") pick("performance");
  else if (key === "2") pick("thrust");
  else if (key === "3") pick("rocket");
  else if (key === " ") {
    spaceAt = performance.now();
    pressFly();
  }
  else if (key === "Enter") fire();
  else if (key === "ArrowLeft") pilot.left = true;
  else if (key === "ArrowRight") pilot.right = true;
  else if (key === "a") togglePanel();
  else if (key === "d") toggleApart();
  else if (key === "f") startRefill();
  else if (key === "s") spin(event.shiftKey ? -1 : 1);
  else if (key === "q") pilot.turnL = true;
  else if (key === "e") pilot.turnR = true;
  else if (key === "o") toggleOrbit();
  go();
});
let spaceAt = -1e9;
document.addEventListener("keyup", (event) => {
  if (event.key === " " && buttons.includes(document.activeElement)) event.preventDefault();
  if (event.key === " ") releaseFly();
  else if (event.key === "ArrowLeft") pilot.left = false;
  else if (event.key === "ArrowRight") pilot.right = false;
  else if (event.key === "q" || event.key === "Q") pilot.turnL = false;
  else if (event.key === "e" || event.key === "E") pilot.turnR = false;
});
addEventListener("blur", () => {
  releaseFly();
  pilot.left = pilot.right = pilot.turnL = pilot.turnR = false;
});
function toggleOrbit() {
  orbitOn = !orbitOn;
  markButtons();
  announce(orbitOn ? "Orbit on: the paths the nose and the tail sweep, and the centre's track, traced on the pad." : "Orbit off.");
  go();
}
// a control pressed while the figure is off screen brings the figure back into view first
function reveal() {
  if (!visible) stage.scrollIntoView({ block: "center", behavior: still.matches ? "auto" : "smooth" });
}
const HOLD = {
  fly: [pressFly, releaseFly],
  back: [() => (pilot.left = true), () => (pilot.left = false)],
  fwd: [() => (pilot.right = true), () => (pilot.right = false)],
  turnL: [() => (pilot.turnL = true), () => (pilot.turnL = false)],
  turnR: [() => (pilot.turnR = true), () => (pilot.turnR = false)],
};
buttons.forEach((b) => {
  const act = b.dataset.act;
  if (HOLD[act]) {
    const [down, up] = HOLD[act];
    b.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      takeOver();
      reveal();
      b.setPointerCapture?.(event.pointerId);
      down();
      go();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(type, () => up());
    b.addEventListener("contextmenu", (event) => event.preventDefault());
    // a keyboard press on the button: a press and a release, which still gives the fly button's short hop
    b.addEventListener("click", (event) => {
      if (event.detail !== 0 || performance.now() - spaceAt < 1000) return;
      takeOver();
      down();
      up();
      go();
    });
    return;
  }
  b.addEventListener("click", () => {
    takeOver();
    reveal();
    if (act === "launch") fire();
    else if (act === "spin") spin(1);
    else if (act === "orbit") toggleOrbit();
    else if (act === "panel") togglePanel();
    else if (act === "apart") toggleApart();
    else if (act === "refill") startRefill();
    else pick(act);
    go();
  });
});
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) go();
}, { rootMargin: "120px 0px" }).observe(stage);
addEventListener("resize", () => go());
markButtons();
lever.set(lever.a);
guard.set(0);
glOf(view);
placePieces();
placeHose();
draw();
