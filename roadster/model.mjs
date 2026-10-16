// The Roadster's cold-gas thruster system as one small pure model: a tank of compressed air,
// a regulator, ten nozzles with fast on/off valves, and the car they push. SI units inside.
// What Tesla confirmed at the reveal is marked CONFIRMED; everything else is an estimate,
// because Tesla gave no pressure, nozzle size, thrust per thruster or mass.

export const SPEC = {
  airVolume: 0.6, // m³ — CONFIRMED: "600 liters of compressed air" (Lars Moravy, Tesla)
  tankPressure: 300e5, // Pa — estimate: a common rating for carbon-overwrapped air cylinders
  regulator: 40e5, // Pa — estimate: nozzle feed pressure
  dropout: 1.1, // the regulator holds its setpoint while the tank has 10% more
  T0: 293, // K
  R: 287, // J/(kg·K), air
  gamma: 1.4,
  warm: 60, // s — estimate: the tank's gas warms back toward T0 from the walls
  dryMass: 1814, // kg — estimate: "4,000+ lb" was posted by Marques Brownlee, not Tesla
  g: 9.81,
  grip: 1.7, // g — estimate from Tesla's "0–60 mph under 1.6 s" for the Performance version
  brake: 1.6, // g
  fill: 0.1, // kg/s — estimate: the cart's booster compressor, about 300 m³/h of free air
  rollInertia: 880, // kg·m², estimate
  yawInertia: 3950, // kg·m², estimate: the car as a 2-tonne slab 4.4 m long and 2 m wide
  driverOffset: 0.016, // m — the single seat sits left of centre, so the mass does too
};

// Ten nozzles. pos in metres in the car's frame (x to its left, y to its tail, z up from the
// ground at rest); out is where the exhaust goes. Thrust pushes the car the other way.
// Thrust per nozzle is an estimate: about 80 kN in all, a reported (unconfirmed) figure.
const cant = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
export const NOZZLES = [
  ...[-0.56, -0.18, 0.18, 0.56].map((x, i) => ({ id: `main${i}`, kind: "main", pos: [x, 2.06, 0.27], out: [0, 1, 0], max: 12e3, exit: 0.052 })),
  ...[1, -1].map((s) => ({ id: s > 0 ? "liftL" : "liftR", kind: "lift", pos: [s * 0.89, 0.12, 0.16], out: [0, 0, -1], max: 11e3, exit: 0.052 })),
  ...[[1, -1], [-1, -1], [1, 1], [-1, 1]].map(([s, e]) => ({
    id: `${e < 0 ? "f" : "r"}${s > 0 ? "L" : "R"}`,
    kind: "corner",
    pos: [s * 0.866, e * 1.915, 0.203],
    out: cant(s * 0.27, e * 0.36, -1),
    max: 2.5e3,
    exit: 0.025,
  })),
];

// Ideal thrust coefficient for air expanding from pc to 1 bar through a matched nozzle.
const CF = (pc) => {
  const g = SPEC.gamma;
  const r = Math.max(1, pc / 1e5);
  return Math.sqrt(((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1)) * (1 - Math.pow(1 / r, (g - 1) / g)));
};
const GAMMA_FN = (() => {
  const g = SPEC.gamma;
  return Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
})();
const CF_REG = CF(SPEC.regulator);
// throat area of each nozzle from its thrust at the regulator's pressure
for (const n of NOZZLES) n.throat = n.max / (CF_REG * SPEC.regulator);

export const airMass = (p, T = SPEC.T0) => (p * SPEC.airVolume) / (SPEC.R * T);
export const FULL = airMass(SPEC.tankPressure);
// air left when the regulator can no longer hold its pressure, if the blow-down were adiabatic
export const RESIDUAL = FULL * Math.pow((SPEC.regulator * SPEC.dropout) / SPEC.tankPressure, 1 / SPEC.gamma);

export function tankOf(fraction = 1) {
  const m = FULL * fraction;
  return { m, T: SPEC.T0, p: (m * SPEC.R * SPEC.T0) / SPEC.airVolume };
}

// Feed pressure the nozzles see: the regulator's setpoint while the tank can hold it.
export const feedOf = (tank) => Math.min(SPEC.regulator, tank.p / SPEC.dropout);

// Thrust and mass flow of one nozzle at a valve duty (0 closed, 1 open).
export function nozzleOf(n, tank, duty) {
  const pc = feedOf(tank);
  if (duty <= 0 || pc <= 1.2e5) return { F: 0, mdot: 0 };
  const F = duty * CF(pc) * pc * n.throat;
  const mdot = (duty * pc * n.throat * GAMMA_FN) / Math.sqrt(SPEC.R * tank.T);
  return { F, mdot };
}

// The usable share of the air above what the regulator needs, 0..1, for the readout.
export const usableOf = (tank) => Math.max(0, Math.min(1, (tank.m - RESIDUAL) / (FULL - RESIDUAL)));

// Advance the tank: gas leaves (adiabatic for what stays), the walls warm it back, the cart fills it.
export function stepTank(tank, mdotOut, mdotIn, dt) {
  const m0 = tank.m;
  const m1 = Math.max(1e-3, m0 + (mdotIn - mdotOut) * dt);
  let T = tank.T;
  if (mdotOut > 0) T *= Math.pow(m1 / m0, SPEC.gamma - 1);
  T += ((SPEC.T0 - T) * dt) / SPEC.warm;
  tank.m = m1;
  tank.T = T;
  tank.p = (m1 * SPEC.R * T) / SPEC.airVolume;
  return tank;
}

// ---------- the car ----------
export function carOf() {
  return { x: 0, vx: 0, y: 0, vy: 0, z: 0, vz: 0, roll: 0, rollRate: 0, yaw: 0, yawRate: 0, air: false, peakG: 0, t: 0 };
}
const CONTACT_K = 4e5; // N/m, tyres and springs together
const CONTACT_C = 2.6e4; // N·s/m

// One step of the car under the given valve duties and tyre command (N along the car's +y, its tail,
// signed). Forces are summed in the car's own frame and turned by its heading (yaw, about z, positive
// turning the nose to the car's left); x and y are the pad's, z up.
export function stepCar(car, tank, duties, tyre, dt) {
  const m = SPEC.dryMass + tank.m;
  let Fxb = 0;
  let Fyb = 0;
  let Fz = 0;
  let M = 0;
  let Mz = 0;
  let mdot = 0;
  let thrust = 0;
  NOZZLES.forEach((n, i) => {
    const { F, mdot: md } = nozzleOf(n, tank, duties[i] || 0);
    if (!F) return;
    const fx = -F * n.out[0];
    const fy = -F * n.out[1];
    const fz = -F * n.out[2];
    Fxb += fx;
    Fyb += fy;
    Fz += fz;
    M += fz * (n.pos[0] - SPEC.driverOffset);
    Mz += n.pos[0] * fy - n.pos[1] * fx;
    mdot += md;
    thrust += F;
  });
  // ground: a stiff spring-damper while the tyres touch
  const contact = car.z <= 0 ? Math.max(0, -CONTACT_K * car.z - CONTACT_C * car.vz) : 0;
  const weight = m * SPEC.g;
  const N = contact + (car.z <= 0 && car.vz <= 0 && Fz < weight ? 0 : 0);
  const onGround = car.z <= 0.002;
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  let Fx = Fxb * c - Fyb * s;
  let Fy = Fxb * s + Fyb * c;
  if (onGround) {
    const limit = SPEC.grip * Math.max(N, weight - Fz);
    const along = Math.max(-limit, Math.min(limit, tyre));
    // the tyres push along the car, and hold it against sliding sideways
    const side = Math.max(-limit, Math.min(limit, -(car.vx * c + car.vy * s) * m * 20));
    Fx += -s * along + c * side;
    Fy += c * along + s * side;
  }
  const ax = Fx / m;
  const ay = Fy / m;
  const az = (Fz + N - weight) / m;
  car.vx += ax * dt;
  car.x += car.vx * dt;
  car.vy += ay * dt;
  car.y += car.vy * dt;
  car.vz += az * dt;
  car.z += car.vz * dt;
  if (car.z < -0.06) {
    car.z = -0.06;
    car.vz = Math.max(0, car.vz);
  }
  // roll: lift on either side of the offset centre of mass; on the ground the springs resist it
  const rollAcc = (M - (onGround ? 6e4 * car.roll + 7e3 * car.rollRate : 0)) / SPEC.rollInertia;
  car.rollRate += rollAcc * dt;
  car.roll += car.rollRate * dt;
  // yaw: the corner nozzles' couple turns it in the air; on the pad the tyres stop it turning
  const yawAcc = (Mz - (onGround ? 4e4 * car.yawRate : 0)) / SPEC.yawInertia;
  car.yawRate += yawAcc * dt;
  car.yaw += car.yawRate * dt;
  const aAlong = -s * ax + c * ay;
  car.air = !onGround;
  car.g = Math.hypot(aAlong, Math.max(0, az)) / SPEC.g;
  car.peakG = Math.max(car.peakG, Math.abs(aAlong) / SPEC.g);
  car.t += dt;
  return { mdot, thrust };
}

// ---------- the three runs ----------
// Each run is a little autopilot: it reads the car and the tank and returns valve duties and a
// tyre force for this instant. Valves are on/off; a duty is the share of each 50 ms they are open.
export const RUNS = {
  // wheels only: launch at the grip limit to 10 mph, brake, creep back to the line
  performance(run, car, tank) {
    const m = SPEC.dryMass + tank.m;
    const duties = NOZZLES.map(() => 0);
    if (run.phase === "launch") {
      if (-car.vy >= 4.5) run.phase = "brake";
      return { duties, tyre: -SPEC.grip * m * SPEC.g };
    }
    return creep(run, car, m, duties);
  },
  // the rear four fire two 40 ms pulses on top of the tyres
  thrust(run, car, tank) {
    const m = SPEC.dryMass + tank.m;
    const duties = NOZZLES.map(() => 0);
    if (run.phase === "launch") {
      const t = car.t;
      const on = (t > 0.03 && t < 0.07) || (t > 0.11 && t < 0.15);
      NOZZLES.forEach((n, i) => (duties[i] = n.kind === "main" && on ? 1 : 0));
      if (t >= 0.17) run.phase = "brake";
      return { duties, tyre: -SPEC.grip * m * SPEC.g };
    }
    return creep(run, car, m, duties);
  },
  // all ten: lift off, a short push from the rear four, the corners stop the drift and hold the
  // car level, and it hovers until only the air to land is left, then sets down
  rocket(run, car, tank) {
    const m = SPEC.dryMass + tank.m;
    const W = m * SPEC.g;
    const duties = NOZZLES.map(() => 0);
    if (!["lift", "hover", "land"].includes(run.phase)) return creep(run, car, m, duties);
    const scale = feedOf(tank) / SPEC.regulator;
    const liftMax = NOZZLES.filter((n) => n.kind === "lift").reduce((a, n) => a + n.max * -n.out[2], 0) * scale;
    const cornerMax = NOZZLES.filter((n) => n.kind === "corner").reduce((a, n) => a + n.max * -n.out[2], 0) * scale;
    // the descent takes about a second at hover thrust, and cold gas gives about 500 m/s:
    // the hover ends when only that much air is left above what the regulator needs
    const reserve = RESIDUAL + (1.05 * W) / 500;
    if (run.phase === "lift" && car.z > 0.6) run.phase = "hover";
    if (run.phase === "hover" && tank.m <= reserve) run.phase = "land";
    if (run.phase === "land" && !car.air) {
      run.phase = "brake";
      return creep(run, car, m, duties);
    }
    let want;
    if (run.phase === "land") {
      // a speed-held descent, slowing for the touchdown
      const vt = car.z > 0.3 ? -1.4 : -0.5;
      want = m * (SPEC.g + 7 * (vt - car.vz));
    } else want = W + m * (7 * (0.8 - car.z) - 5.2 * car.vz);
    const up = Math.max(0, Math.min(liftMax + cornerMax, want));
    const liftShare = Math.min(1, up / (liftMax + cornerMax * 0.35));
    const cornerBase = Math.max(0.35, (up - liftShare * liftMax) / Math.max(1, cornerMax));
    // roll: lean the duty toward the low side
    run.rollI = (run.rollI ?? 0) + car.roll * (1 / 600);
    const rollFix = Math.max(-0.35, Math.min(0.35, -car.roll * 0.8 - car.rollRate * 0.35 - run.rollI * 1.1));
    // drift: the front corners, canted forward, brake the push the rear four gave
    const brake = clamp01(-car.vy * 2.5);
    NOZZLES.forEach((n, i) => {
      const side = Math.sign(n.pos[0]);
      if (n.kind === "lift") {
        // the right-hand valve opens 30 ms after the left at lift-off: the tilt the corners take out
        const late = side < 0 && car.t < 0.03;
        duties[i] = late ? 0 : clamp01(liftShare * (1 + side * rollFix));
      } else if (n.kind === "corner") {
        const front = n.pos[1] < 0;
        duties[i] = clamp01(cornerBase * 0.6 + (front ? brake * 0.6 : -brake * 0.4));
      } else if (n.kind === "main") duties[i] = run.phase === "lift" && car.t > 0.05 && car.t < 0.07 ? 1 : 0;
      if (want <= 0 && n.kind !== "main") duties[i] = 0;
    });
    return { duties, tyre: 0 };
  },
  // hands-on: the pilot holds lift to climb and lets go to settle, asks to go forward or back (run.move:
  // +1 forward, -1 back) and to turn (run.turn: +1 left, -1 right). The autopilot turns those asks into
  // valve duties. The two lift nozzles hold the height and the roll. The four corners, canted out and
  // fore or aft, work in patterns that do not disturb one another: all four together lift; front against
  // rear brake or push back; left against right push sideways; the two diagonals against each other make
  // a pure turning couple. The rear four push forward. It lands by itself when only the air to land is left.
  pilot(run, car, tank) {
    const m = SPEC.dryMass + tank.m;
    const W = m * SPEC.g;
    const duties = NOZZLES.map(() => 0);
    if (!["ready", "fly", "land"].includes(run.phase)) return creep(run, car, m, duties);
    const scale = feedOf(tank) / SPEC.regulator;
    const low = tank.m <= flyReserveOf(tank);
    const forward = run.move || 0;
    const turn = run.turn || 0;
    const c = Math.cos(car.yaw);
    const sn = Math.sin(car.yaw);
    // the car's own axes on the pad: its tail (+y) and its left (+x)
    const vAlong = -sn * car.vx + c * car.vy;
    const vSide = c * car.vx + sn * car.vy;
    // along the car: the asked speed, slowed near the edge of the pad's safe area so the car can stop in
    // it. Going forward only the front corners can brake it, about 0.6 m/s²; going back the rear four brake hard.
    const reach = (dx, dy) => {
      const tx = dx > 1e-6 ? (PILOT.side - car.x) / dx : dx < -1e-6 ? (-PILOT.side - car.x) / dx : Infinity;
      const ty = dy > 1e-6 ? (PILOT.back - car.y) / dy : dy < -1e-6 ? (PILOT.front - car.y) / dy : Infinity;
      return Math.max(0, Math.min(tx, ty));
    };
    let vyt = -forward * PILOT.speed;
    if (vyt < 0) vyt = Math.max(vyt, -Math.sqrt(2 * 0.45 * reach(sn, -c)));
    if (vyt > 0) vyt = Math.min(vyt, Math.sqrt(2 * 1.5 * reach(-sn, c)));
    const settled = () => Math.abs(car.yaw) < 0.005 && Math.abs(car.x) < 0.005;
    if (run.phase === "ready") {
      if (run.hold && !low) {
        run.phase = "fly";
        run.flights = (run.flights ?? 0) + 1;
      } else {
        // on its wheels between flights: the brakes hold it; after a pause it rolls home, or, turned or
        // off its line, the session ends and the crew put it back on the line
        if (run.hold || forward || turn) run.idleSince = car.t;
        if (car.t - (run.idleSince ?? 0) > PILOT.home || (low && !car.air)) {
          run.out = low;
          if (!settled()) {
            run.phase = "done";
            run.tow = true;
            return { duties, tyre: -vAlong * m * 6 };
          }
          run.phase = "brake";
          return creep(run, car, m, duties);
        }
        return { duties, tyre: -vAlong * m * 6 };
      }
    }
    if (run.phase === "fly" && low) run.phase = "land";
    if (car.air) run.wasAir = true;
    // back on the pad: a forced landing ends the flight; otherwise wait for the next hold
    if (!car.air && car.vz <= 0.01 && (run.phase === "land" ? run.wasAir : !run.hold)) {
      run.wasAir = false;
      run.idleSince = car.t;
      if (run.phase === "land") {
        run.out = true;
        if (!settled()) {
          run.phase = "done";
          run.tow = true;
          return { duties, tyre: -vAlong * m * 6 };
        }
        run.phase = "brake";
        return creep(run, car, m, duties);
      }
      run.phase = "ready";
      return { duties, tyre: -vAlong * m * 6 };
    }
    let vt;
    if (run.phase === "land") vt = car.z > 0.35 ? -1.5 : -0.6;
    else if (run.hold) vt = PILOT.climb * clamp01((PILOT.ceiling - car.z) / 0.5);
    else vt = car.z > 0.4 ? -1.4 : -0.5;
    const want = m * (SPEC.g + 7 * (vt - car.vz));
    const liftMax = NOZZLES.filter((n) => n.kind === "lift").reduce((a, n) => a + n.max * -n.out[2], 0) * scale;
    const cornerMax = NOZZLES.filter((n) => n.kind === "corner").reduce((a, n) => a + n.max * -n.out[2], 0) * scale;
    const up = Math.max(0, Math.min(liftMax + cornerMax, want));
    const liftShare = Math.min(1, up / (liftMax + cornerMax * 0.35));
    const cornerBase = Math.max(0.35, (up - liftShare * liftMax) / Math.max(1, cornerMax));
    run.rollI = (run.rollI ?? 0) + car.roll * (1 / 600);
    const rollFix = Math.max(-0.35, Math.min(0.35, -car.roll * 0.8 - car.rollRate * 0.35 - run.rollI * 1.1));
    // along: the force that brings the speed to the asked one, positive toward the tail
    const Fy = car.air ? m * 5 * (vyt - vAlong) : 0;
    const mainsMax = NOZZLES.filter((n) => n.kind === "main").reduce((a, n) => a + n.max, 0) * scale;
    const backMax = NOZZLES.filter((n) => n.kind === "corner" && n.pos[1] < 0).reduce((a, n) => a + n.max * -n.out[1], 0) * scale;
    const push = Fy < 0 ? clamp01(-Fy / mainsMax) : 0;
    const fore = Fy > 0 ? clamp01(Fy / backMax) : 0;
    // what one corner gives per unit of duty: a turning moment, and a push to the car's side
    const corners = NOZZLES.filter((n) => n.kind === "corner");
    const yawOf = (n) => (n.pos[0] * -n.out[1] - n.pos[1] * -n.out[0]) * n.max * scale;
    const sideOf = (n) => -n.out[0] * n.max * scale;
    const yawSum = corners.reduce((a, n) => a + Math.abs(yawOf(n)), 0);
    const sideSum = corners.reduce((a, n) => a + Math.abs(sideOf(n)), 0);
    // turn: bring the turning rate to the asked one; let go and it stops turning, at whatever heading
    const Mz = car.air ? SPEC.yawInertia * 3 * (turn * PILOT.yawRate - car.yawRate) : 0;
    const twist = Math.max(-0.4, Math.min(0.4, Mz / Math.max(1, yawSum)));
    // sideways: stop any drift across the car, which a turn leaves behind
    const Fx = car.air ? -m * 3 * vSide : 0;
    const slide = Math.max(-0.3, Math.min(0.3, Fx / Math.max(1, sideSum)));
    NOZZLES.forEach((n, i) => {
      const side = Math.sign(n.pos[0]);
      if (n.kind === "lift") duties[i] = clamp01(liftShare * (1 + side * rollFix));
      else if (n.kind === "corner") {
        const front = n.pos[1] < 0;
        duties[i] = clamp01(cornerBase * 0.6 + (front ? fore * 0.6 : -fore * 0.4) + Math.sign(yawOf(n)) * twist + Math.sign(sideOf(n)) * slide);
      } else duties[i] = push;
      if (want <= 0 && n.kind !== "main") duties[i] = 0;
    });
    return { duties, tyre: car.air ? 0 : -vAlong * m * 6 };
  },
};
// The air a hands-on flight keeps back to land: more than the automatic hop's, since the pilot may be
// at the ceiling when it runs out, and the landing from there takes about 1.3 s at near-hover thrust.
export const flyReserveOf = (tank) => RESIDUAL + (1.3 * (SPEC.dryMass + tank.m) * SPEC.g) / 500;
// enough air for a flight worth the name: the reserve plus about half a second of hovering
export const canFly = (tank) => tank.m > flyReserveOf(tank) + 20;
// the hands-on flight's limits: climb and travel speeds, the ceiling (under the floating side panel),
// how far it may go along the pad either way and to either side, the pause before it rolls home, and
// the fastest turn it asks for, 40°/s
export const PILOT = { climb: 0.9, ceiling: 1.2, speed: 1.2, front: -1.3, back: 0.45, side: 0.8, home: 2.5, yawRate: 0.7 };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// brake to a stop, wait, then roll back to the start line and stop on it
function creep(run, car, m, duties) {
  if (run.phase === "launch") run.phase = "brake";
  if (run.phase === "brake") {
    if (Math.abs(car.vy) < 0.05) {
      car.vy = 0;
      run.phase = "wait";
      run.waitUntil = car.t + 0.5;
    }
    return { duties, tyre: -Math.sign(car.vy) * SPEC.brake * m * SPEC.g };
  }
  if (run.phase === "wait") {
    if (car.t >= run.waitUntil) run.phase = "return";
    return { duties, tyre: -car.vy * m * 4 };
  }
  if (run.phase === "return" || run.phase === "creep") {
    run.phase = "return";
    const want = Math.max(-1.2, Math.min(1.2, -car.y * 1.4));
    if (Math.abs(car.y) < 0.004 && Math.abs(car.vy) < 0.02) {
      car.y = 0;
      car.vy = 0;
      run.phase = "done";
    }
    return { duties, tyre: (want - car.vy) * m * 6 };
  }
  return { duties, tyre: -car.vy * m * 6 };
}

export function runOf(mode) {
  return { mode, phase: mode === "rocket" ? "lift" : mode === "pilot" ? "ready" : "launch" };
}

// A whole run in Node, for the build's representative frame and the caption's numbers.
export function simulate(mode, tank = tankOf(1), { dt = 1 / 600, limit = 20 } = {}) {
  const car = carOf();
  const run = runOf(mode);
  const t0 = tank.m;
  let hover = 0;
  let maxZ = 0;
  let peakThrust = 0;
  while (run.phase !== "done" && car.t < limit) {
    const { duties, tyre } = RUNS[mode](run, car, tank);
    const { mdot, thrust } = stepCar(car, tank, duties, tyre, dt);
    stepTank(tank, mdot, 0, dt);
    if (car.air) hover += dt;
    maxZ = Math.max(maxZ, car.z);
    peakThrust = Math.max(peakThrust, thrust);
  }
  return { car, tank, used: t0 - tank.m, airtime: hover, maxZ, peakThrust, time: car.t };
}
