// The BMW iX3 50 xDrive (Neue Klasse, 2025) in numbers. Every readout, the drive run and the charge
// time-lapse come from here. Sources: BMW launch data (Sept 2025) and Wikipedia's spec table.

export const CAR = {
  length: 4782, // mm
  width: 1895,
  height: 1635,
  wheelbase: 2897,
  kerb: 2285, // kg
  power: 345, // kW, both motors
  torque: 645, // N·m
  sprint: 4.9, // s, 0–100 km/h
  top: 210, // km/h
  battery: 108.7, // kWh usable
  volts: 800,
  peakCharge: 400, // kW DC
  charge10to80: 21, // min
  range: 805, // km WLTP
};

// Drive: one driver aboard, traction-limited force at low speed, then the 345 kW limit.
// Rolling resistance and drag area are typical figures for a car this size, not BMW data;
// the traction force is solved so 0–100 km/h takes exactly 4.9 s.
const MASS = CAR.kerb + 75;
const G = 9.81;
const CRR = 0.011;
const CDA = 0.7; // m²
const RHO = 1.2;
const P_W = CAR.power * 1000;
const VMAX = CAR.top / 3.6;

function forceAt(v, fmax) {
  return Math.min(fmax, P_W / Math.max(v, 0.1));
}
function accel(v, fmax) {
  if (v >= VMAX) return 0;
  return (forceAt(v, fmax) - CRR * MASS * G - 0.5 * RHO * CDA * v * v) / MASS;
}
function sprintTime(fmax) {
  let v = 0;
  let t = 0;
  const h = 0.002;
  while (v < 100 / 3.6 && t < 30) {
    v += accel(v, fmax) * h;
    t += h;
  }
  return t;
}
let lo = 5000;
let hi = 30000;
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  if (sprintTime(mid) > CAR.sprint) lo = mid;
  else hi = mid;
}
export const TRACTION = Math.round((lo + hi) / 2);

// Advance a drive state { v (m/s), x (m), throttle 0..1 } by dt seconds; returns power in kW.
export function stepDrive(state, dt) {
  const h = Math.min(dt, 0.01);
  let left = dt;
  let power = 0;
  while (left > 1e-9) {
    const step = Math.min(h, left);
    const want = state.throttle > 0 ? state.throttle : 0;
    const f = want > 0 ? forceAt(state.v, TRACTION) * want : 0;
    const brake = state.braking ? 9000 : 0;
    const a = (f - brake - CRR * MASS * G * Math.sign(state.v) - 0.5 * RHO * CDA * state.v * state.v) / MASS;
    state.v = Math.max(0, Math.min(VMAX, state.v + a * step));
    state.x += state.v * step;
    power = (f * state.v) / 1000;
    left -= step;
  }
  return power;
}
export const WHEEL_R = 0.382; // m, 255/50 R20

// Charge: 400 kW peak, holding to about 45% and tapering, with the taper solved so 10→80% takes 21 min.
// The curve's shape is illustrative; its peak and its total time are BMW's.
function curve(soc, end) {
  if (soc < 0.15) return CAR.peakCharge * (0.82 + 0.18 * ((soc - 0.1) / 0.05));
  if (soc < 0.45) return CAR.peakCharge;
  return CAR.peakCharge * (1 - (1 - end) * ((soc - 0.45) / 0.35));
}
function chargeMinutes(end) {
  let t = 0;
  const ds = 0.0005;
  for (let s = 0.1; s < 0.8; s += ds) t += (CAR.battery * ds) / curve(s + ds / 2, end);
  return t * 60;
}
let a = 0.05;
let b = 1;
for (let i = 0; i < 50; i++) {
  const mid = (a + b) / 2;
  if (chargeMinutes(mid) > CAR.charge10to80) a = mid;
  else b = mid;
}
export const TAPER_END = (a + b) / 2;
export const chargePower = (soc) => curve(Math.max(0.1, Math.min(0.8, soc)), TAPER_END);
// Advance { soc } by dt minutes at the charger; returns kW.
export function stepCharge(state, minutes) {
  let left = minutes;
  let power = 0;
  while (left > 1e-9 && state.soc < 0.8) {
    const h = Math.min(left, 0.02);
    power = chargePower(state.soc);
    state.soc = Math.min(0.8, state.soc + (power * h) / 60 / CAR.battery);
    left -= h;
  }
  return state.soc >= 0.8 ? 0 : power;
}
