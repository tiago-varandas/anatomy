// The one model behind the neuron bench: every level, pulse, valve turn, readout and caption number
// comes from here. Times are in milliseconds of neuron time, voltages in millivolts.

export const NEURON = {
  rest: -70, // resting membrane potential
  threshold: -55, // the axon hillock fires at about −55 mV
  peak: 40, // top of the action potential
  ahp: -80, // after-hyperpolarisation, below rest
  tauM: 20, // membrane leak time constant
  tauS: 1, // synaptic current time constant
  rise: 0.5, // spike upstroke
  fall: 1, // spike downstroke to the after-hyperpolarisation
  refractory: 2, // absolute refractory period
};

export const SYN = {
  names: ["food", "bell", "light"],
  start: [20, 5, 5], // synaptic weights in mV of injected charge
  max: 20,
  plus: 4.5, // potentiation when the input arrives before the output spike (STDP)
  minus: 2.2, // depression when it arrives after
  tau: 20, // STDP time constant
  window: 40, // beyond this the pairing no longer counts
};

export const DELAY = { axon: 6, out: 5 }; // conduction time of the input lines and of D's own axon
export const STIM = 24; // charge a sense organ puts into its own neuron per stimulus
export const SLOW = 50; // the bench runs 50 times slower than a real neuron: 1 s on screen is 20 ms

export function makeNeuron() {
  return { v: NEURON.rest, q: 0, spikeAt: -1e9, from: NEURON.rest };
}

export function makeNet() {
  return { t: 0, n: [makeNeuron(), makeNeuron(), makeNeuron(), makeNeuron()], w: [...SYN.start], arrived: [-1e9, -1e9, -1e9], pulses: [], out: [], count: 0, fired: [-1e9, -1e9, -1e9, -1e9], learned: [0, 0, 0] };
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Advance one neuron by h ms; returns true on the step it fires.
export function stepNeuron(n, t, h) {
  const age = t - n.spikeAt;
  if (age < NEURON.rise) {
    n.v = n.from + (NEURON.peak - n.from) * smooth(age / NEURON.rise);
    return false;
  }
  if (age < NEURON.rise + NEURON.fall) {
    n.v = NEURON.peak + (NEURON.ahp - NEURON.peak) * smooth((age - NEURON.rise) / NEURON.fall);
    return false;
  }
  const inject = n.q * (1 - Math.exp(-h / NEURON.tauS));
  n.q -= inject;
  n.v += inject + (NEURON.rest - n.v) * (1 - Math.exp(-h / NEURON.tauM));
  if (n.v >= NEURON.threshold && age >= NEURON.refractory) {
    n.spikeAt = t;
    n.from = n.v;
    n.q = 0;
    return true;
  }
  return false;
}

export function stimulate(net, index) {
  net.n[index].q += STIM;
}

// Advance the whole bench by dt ms in sub-steps of at most 0.05 ms.
export function stepNet(net, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.05));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    net.t += h;
    const t = net.t;
    for (let i = 0; i < 3; i++) {
      if (stepNeuron(net.n[i], t, h)) {
        net.fired[i] = t;
        net.pulses.push({ line: i, at: t, done: false });
      }
    }
    for (const pulse of net.pulses) {
      if (pulse.done || t - pulse.at < DELAY.axon) continue;
      pulse.done = true;
      const i = pulse.line;
      net.n[3].q += net.w[i];
      net.arrived[i] = t;
      const late = t - net.fired[3];
      if (late >= 0 && late <= SYN.window) {
        net.w[i] = Math.max(0, net.w[i] - SYN.minus * Math.exp(-late / SYN.tau));
        net.learned[i] = t;
      }
    }
    if (stepNeuron(net.n[3], t, h)) {
      net.fired[3] = t;
      net.out.push({ at: t, done: false });
      for (let i = 0; i < 3; i++) {
        const lead = t - net.arrived[i];
        if (lead >= 0 && lead <= SYN.window) {
          const before = net.w[i];
          net.w[i] = Math.min(SYN.max, net.w[i] + SYN.plus * Math.exp(-lead / SYN.tau));
          if (net.w[i] !== before) net.learned[i] = t;
        }
      }
    }
    for (const spike of net.out) {
      if (spike.done || t - spike.at < DELAY.out) continue;
      spike.done = true;
      net.count++;
    }
  }
  net.pulses = net.pulses.filter((pulse) => !pulse.done || net.t - pulse.at < DELAY.axon + 2);
  net.out = net.out.filter((spike) => !spike.done || net.t - spike.at < DELAY.out + 2);
}
