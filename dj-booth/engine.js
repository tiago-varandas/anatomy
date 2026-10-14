// The booth's sound: two players and a four-channel mixer, all synthesized with Tone.js.
// Eight original tracks in A minor at 124 BPM, so any two blend. Nothing is built until start()
// runs inside the visitor's first click or tap.

const BPM = 124;
const BARS = 48;
const STEPS = BARS * 16;
const ROOT = { Am: "A1", F: "F1", C: "C2", G: "G1", Dm: "D2", Em: "E2" };
const CHORD = {
  Am: ["A3", "C4", "E4", "G4"],
  F: ["F3", "A3", "C4", "E4"],
  C: ["G3", "C4", "E4", "B4"],
  G: ["G3", "B3", "D4", "A4"],
  Dm: ["D3", "F3", "A3", "C4"],
  Em: ["E3", "G3", "B3", "D4"],
};
// Each track: a four-bar progression, one-bar patterns per voice, its chord instrument and swing.
// Sections: intro bars 0–7 drums, main 8–23 everything, break 24–31 harmony only, main 32–43, outro 44–47 drums.
const TRACKS = [
  { title: "Night Shift", genre: "House", prog: ["Am", "F", "C", "G"], kick: "x...x...x...x...", clap: "....x.......x...", ch: "x.x.x.x.x.x.x.x.", oh: "..x...x...x...x.", perc: ".x...x.x.x...x.x", bass: "..R...R...R...O.", chords: "...x..x....x..x.", chordLen: "16n", keys: "stab", lead: "", pad: false, swing: 0 },
  { title: "Steel Grid", genre: "Techno", prog: ["Am", "Am", "Am", "Am"], kick: "x...x...x...x...", clap: "....x.......x...", ch: "xxxxxxxxxxxxxxxx", oh: "..x...x...x...x.", perc: "...x.....x....x.", bass: ".RRO.RRO.RRO.RRO", chords: "x.....x.........", chordLen: "32n", keys: "stab", lead: "aaaaaaaaaaaaaaaa", pad: false, swing: 0 },
  { title: "Mirrorball", genre: "Disco", prog: ["Am", "Dm", "G", "C"], kick: "x...x...x...x...", clap: "....x.......x...", ch: "xxxxxxxxxxxxxxxx", oh: "..x...x...x...x.", perc: "x.x.x.x.x.x.x.x.", bass: "RORORORORORORORO", chords: "", chordLen: "16n", keys: "stab", lead: "a.a.a.a.a.a.a.a.", pad: true, swing: 0 },
  { title: "Undertow", genre: "Deep", prog: ["Am", "Dm", "F", "Em"], kick: "x...x...x...x...", clap: "....x.......x...", ch: "..x...x...x...x.", oh: "..............x.", perc: ".......x.......x", bass: "R.....R...F.....", chords: "x.........x.....", chordLen: "4n", keys: "keys", lead: "", pad: true, swing: 0.12 },
  { title: "Paper Rain", genre: "Lo-fi", prog: ["Am", "Dm", "Em", "F"], kick: "x......x..x.....", clap: "........x.......", ch: "x.x.x.x.x.x.x.x.", oh: "................", perc: "....x.......x...", bass: "R......R..F.....", chords: "x.........x.....", chordLen: "2n", keys: "keys", lead: "......3..2....0.", pad: false, swing: 0.34 },
  { title: "Signal Bloom", genre: "Melodic", prog: ["Am", "F", "C", "G"], kick: "x...x...x...x...", clap: "....x.......x...", ch: "..x...x...x...x.", oh: "..x...x...x...x.", perc: "x..x..x..x..x...", bass: "R.R.R.R.R.R.R.R.", chords: "", chordLen: "16n", keys: "stab", lead: "aaaaaaaaaaaaaaaa", pad: true, swing: 0 },
  { title: "Two Step Tide", genre: "Garage", prog: ["Am", "F", "Dm", "Em"], kick: "x.........x.....", clap: "....x.......x...", ch: "x.xxx.xxx.xxx.xx", oh: "......x.......x.", perc: ".x.....x.x......", bass: "R..R...R.R..F...", chords: "..x...x...x..x..", chordLen: "16n", keys: "organ", lead: "", pad: false, swing: 0.4 },
  { title: "Chrome Pulse", genre: "Electro", prog: ["Am", "Am", "G", "F"], kick: "x.....x...x.....", clap: "....x.......x...", ch: "xxxxxxxxxxxxxxxx", oh: "..............x.", perc: "...x..x....x..x.", bass: "R.RO.R.RO.R.R.RO", chords: "x..x..x.........", chordLen: "16n", keys: "stab", lead: "", pad: false, swing: 0 },
];
const hit = (line, s) => !!line && line[s] !== undefined && line[s] !== ".";
function sectionOf(bar) {
  if (bar < 8) return { kick: bar >= 2, clap: bar >= 4, hats: true, perc: bar >= 4, bass: false, harmony: false, pad: false, lead: false, riser: false };
  if (bar < 24) return { kick: true, clap: true, hats: true, perc: true, bass: true, harmony: true, pad: true, lead: bar >= 16, riser: false };
  if (bar < 32) return { kick: false, clap: bar >= 30, hats: bar >= 28, perc: false, bass: false, harmony: true, pad: true, lead: true, riser: bar >= 28 };
  if (bar < 44) return { kick: true, clap: true, hats: true, perc: true, bass: true, harmony: true, pad: true, lead: true, riser: false };
  return { kick: true, clap: true, hats: true, perc: bar < 46, bass: false, harmony: false, pad: false, lead: false, riser: false };
}
// what the screen's waveform shows: low, mid and high energy for every 16th of a track
function waveOf(track) {
  const out = [];
  for (let step = 0; step < STEPS; step++) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const on = sectionOf(bar);
    let low = 0.08;
    let mid = 0.06;
    let high = 0.05;
    if (on.kick && hit(track.kick, s)) low += 0.85;
    if (on.bass && hit(track.bass, s)) low += 0.35;
    if (on.clap && hit(track.clap, s)) mid += 0.55;
    if (on.harmony && hit(track.chords, s)) mid += 0.35;
    if (on.pad && track.pad) mid += 0.18;
    if (on.lead && track.lead && hit(track.lead, s)) mid += 0.18;
    if (on.hats && hit(track.ch, s)) high += 0.35;
    if (on.hats && hit(track.oh, s)) high += 0.45;
    if (on.riser) high += ((bar - 28) * 16 + s) / 64;
    out.push([Math.min(1, low), Math.min(1, mid), Math.min(1, high)]);
  }
  return out;
}

export function makeEngine() {
  const T = window.Tone;
  const listeners = {};
  const on = (name, fn) => (listeners[name] ??= []).push(fn);
  const emit = (name, ...args) => (listeners[name] ?? []).forEach((fn) => fn(...args));
  const draw = (fn, time) => T.Draw.schedule(fn, time);
  const beatSec = () => 60 / T.Transport.bpm.value;

  // ---------- master section ----------
  const masterIn = new T.Gain(1);
  const masterLevel = new T.Gain(T.dbToGain(-3));
  const finalSum = new T.Gain(1);
  const limiter = new T.Limiter(-1);
  masterIn.connect(masterLevel);
  masterLevel.connect(finalSum);
  finalSum.connect(limiter);
  limiter.toDestination();
  const split = new T.Split();
  const meterL = new T.Meter({ normalRange: true, smoothing: 0.6 });
  const meterR = new T.Meter({ normalRange: true, smoothing: 0.6 });
  limiter.connect(split);
  split.connect(meterL, 0);
  split.connect(meterR, 1);

  // shared returns for the Color FX that need them
  const space = new T.Reverb({ decay: 4.5, preDelay: 0.03, wet: 1 });
  const spaceHp = new T.Filter({ type: "highpass", frequency: 300 });
  space.chain(spaceHp, masterIn);
  const dub = new T.FeedbackDelay({ delayTime: "8n.", feedback: 0.62, wet: 1 });
  const dubLp = new T.Filter({ type: "lowpass", frequency: 1800 });
  dub.chain(dubLp, masterIn);

  // ---------- the mixer's four channels; 2 and 3 carry the players ----------
  const COLOR = ["SPACE", "DUB ECHO", "SWEEP", "NOISE", "CRUSH", "FILTER"];
  function channel(number) {
    const input = new T.Gain(1);
    const trim = new T.Gain(1);
    const eq = new T.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 70 * 3, highFrequency: 3000 });
    const crush = new T.BitCrusher(16);
    crush.wet.value = 0;
    const sweep = new T.Tremolo({ frequency: "16n", depth: 0, spread: 0 }).start();
    const hp = new T.Filter({ type: "highpass", frequency: 10, Q: 1 });
    const lp = new T.Filter({ type: "lowpass", frequency: 20000, Q: 1 });
    const noise = new T.Noise("white").start();
    const noiseBp = new T.Filter({ type: "bandpass", frequency: 2000, Q: 0.8 });
    const noiseGain = new T.Gain(0);
    const meter = new T.Meter({ normalRange: true, smoothing: 0.6 });
    const fader = new T.Gain(1);
    const xf = new T.Gain(1);
    const fxDry = new T.Gain(1);
    const spaceSend = new T.Gain(0);
    const dubSend = new T.Gain(0);
    input.chain(trim, eq, crush, sweep, hp, lp);
    noise.chain(noiseBp, noiseGain, lp);
    lp.connect(meter);
    lp.connect(fader);
    lp.connect(spaceSend);
    lp.connect(dubSend);
    spaceSend.connect(space);
    dubSend.connect(dub);
    fader.chain(xf, fxDry, masterIn);
    return { number, input, trim, eq, crush, sweep, hp, lp, noiseGain, noiseBp, meter, fader, xf, fxDry, spaceSend, dubSend, v: { trim: 0.5, hi: 0.5, mid: 0.5, low: 0.5, color: 0, fader: 0.75, assign: "THRU" } };
  }
  const ch = { 2: channel(2), 3: channel(3) };
  const mixer = { color: "FILTER", xfader: 0, master: 0.75, booth: 0.5, prelisten: null, cue: { 1: false, 2: false, 3: false, 4: false } };
  const eqDb = (v) => (v <= 0.02 ? -80 : v < 0.5 ? -26 * Math.pow(1 - v / 0.5, 1.4) : 6 * ((v - 0.5) / 0.5));
  function applyColor(c) {
    const x = c.v.color;
    const a = Math.abs(x);
    const type = mixer.color;
    // every effect sweeps a filter as well: left closes the lows-pass, right opens the high-pass
    const filterAmount = type === "FILTER" ? a : a * 0.55;
    const lp = x < -0.02 ? 20000 * Math.pow(160 / 20000, filterAmount) : 20000;
    const hp = x > 0.02 ? 20 * Math.pow(4000 / 20, filterAmount) : 10;
    c.lp.frequency.rampTo(lp, 0.04);
    c.hp.frequency.rampTo(hp, 0.04);
    c.lp.Q.value = type === "FILTER" && x < -0.02 ? 3 : 1;
    c.hp.Q.value = type === "FILTER" && x > 0.02 ? 3 : 1;
    c.spaceSend.gain.rampTo(type === "SPACE" ? a * 0.9 : 0, 0.05);
    c.dubSend.gain.rampTo(type === "DUB ECHO" ? a * 0.8 : 0, 0.05);
    c.sweep.depth.rampTo(type === "SWEEP" ? a : 0, 0.05);
    c.sweep.frequency.value = x < 0 ? "16n" : "32n";
    c.noiseGain.gain.rampTo(type === "NOISE" ? a * 0.12 : 0, 0.05);
    c.noiseBp.frequency.rampTo(x < 0 ? 600 + 2000 * (1 - a) : 2000 + 8000 * a, 0.05);
    c.crush.wet.rampTo(type === "CRUSH" ? Math.min(1, a * 1.4) : 0, 0.05);
    c.crush.bits.value = Math.round(16 - a * 13);
  }
  function xfGains() {
    const t = (mixer.xfader + 1) / 2;
    return { A: Math.cos((t * Math.PI) / 2), B: Math.sin((t * Math.PI) / 2), THRU: 1 };
  }
  function applyXf() {
    const g = xfGains();
    for (const c of Object.values(ch)) {
      let want = g[c.v.assign];
      if (mixer.prelisten !== null) want = c.number === mixer.prelisten ? 1 : 0.1 * want;
      c.xf.gain.rampTo(Math.max(0.0001, want), 0.05);
    }
  }
  const mixerApi = {
    COLOR,
    state: mixer,
    channels: ch,
    set(chn, key, value) {
      const c = ch[chn];
      if (!c) return;
      c.v[key] = value;
      if (key === "trim") c.trim.gain.rampTo(T.dbToGain(-12 + value * 21), 0.04); // −12 … +9 dB, 0 dB at noon-ish
      if (key === "hi") c.eq.high.rampTo(eqDb(value), 0.04);
      if (key === "mid") c.eq.mid.rampTo(eqDb(value), 0.04);
      if (key === "low") c.eq.low.rampTo(eqDb(value), 0.04);
      if (key === "color") applyColor(c);
      if (key === "fader") c.fader.gain.rampTo(Math.pow(value, 2.2) * 1.15, 0.04);
      if (key === "assign") applyXf();
    },
    setColor(type) {
      mixer.color = type;
      Object.values(ch).forEach(applyColor);
    },
    setXfader(v) {
      mixer.xfader = v;
      applyXf();
    },
    setMaster(v) {
      mixer.master = v;
      masterLevel.gain.rampTo(v <= 0.01 ? 0 : T.dbToGain(-30 + v * 36), 0.05); // −30 … +6 dB, about −3 dB at 0.75
    },
    setBooth(v) {
      mixer.booth = v;
    },
    // the channel CUE button: two bars of that deck on its own, as heard in the headphones
    cue(chn) {
      mixer.cue[chn] = !mixer.cue[chn];
      if (!ch[chn]) return 0;
      mixer.prelisten = chn;
      applyXf();
      const ms = beatSec() * 8 * 1000;
      clearTimeout(mixerApi._t);
      mixerApi._t = setTimeout(() => {
        mixer.prelisten = null;
        applyXf();
        emit("mixer");
      }, ms);
      return ms;
    },
  };
  mixerApi.setMaster(0.75);
  for (const c of Object.values(ch)) {
    mixerApi.set(c.number, "trim", 0.5);
    mixerApi.set(c.number, "fader", 0.75);
  }

  // ---------- Beat FX: one unit, sent from channel 2, channel 3 or the master ----------
  const BEAT_FX = ["DELAY", "ECHO", "PING PONG", "SPIRAL", "HELIX", "REVERB", "FLANGER", "PHASER", "FILTER", "TRIPLET FILTER", "TRANS", "ROLL", "TRIPLET ROLL", "MOBIUS"];
  const BEATS = [0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8];
  const INSERT = new Set(["FLANGER", "PHASER", "FILTER", "TRIPLET FILTER", "TRANS", "ROLL", "TRIPLET ROLL"]);
  const fxBus = new T.Gain(1);
  const fxReturn = new T.Gain(0);
  fxReturn.connect(finalSum);
  const masterTap = new T.Gain(0);
  masterLevel.connect(masterTap);
  masterTap.connect(fxBus);
  const chTap = { 2: new T.Gain(0), 3: new T.Gain(0) };
  for (const n of [2, 3]) {
    ch[n].xf.connect(chTap[n]);
    chTap[n].connect(fxBus);
  }
  const masterDry = new T.Gain(1);
  masterLevel.disconnect(finalSum);
  masterLevel.connect(masterDry);
  masterDry.connect(finalSum);
  const rollGate = new T.Gain(1);
  const units = {
    DELAY: new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.45, wet: 1 }),
    ECHO: new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.66, wet: 1 }),
    "PING PONG": new T.PingPongDelay({ delayTime: 0.5, feedback: 0.5, wet: 1 }),
    SPIRAL: new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.8, wet: 1 }),
    HELIX: new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.93, wet: 1 }),
    REVERB: new T.Reverb({ decay: 5, wet: 1 }),
    FLANGER: new T.Chorus({ frequency: 0.5, delayTime: 2.4, depth: 0.9, feedback: 0.72, spread: 90, wet: 1 }).start(),
    PHASER: new T.Phaser({ frequency: 0.5, octaves: 4, baseFrequency: 350, wet: 1 }),
    FILTER: new T.AutoFilter({ frequency: 0.5, baseFrequency: 200, octaves: 5, wet: 1 }).start(),
    "TRIPLET FILTER": new T.AutoFilter({ frequency: 0.5, baseFrequency: 200, octaves: 5, wet: 1 }).start(),
    TRANS: new T.Tremolo({ frequency: 2, depth: 1, type: "square", spread: 0, wet: 1 }).start(),
    ROLL: new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.97, wet: 1 }),
    "TRIPLET ROLL": new T.FeedbackDelay({ delayTime: 0.5, feedback: 0.97, wet: 1 }),
  };
  const echoTone = new T.Filter({ type: "lowpass", frequency: 2600 });
  const spiralTone = new T.Filter({ type: "highpass", frequency: 400 });
  const mobius = new T.Oscillator({ type: "sine", frequency: 220 }).start();
  const mobiusLfo = new T.LFO({ type: "sawtooth", frequency: 0.5, min: 180, max: 1800 }).start();
  mobiusLfo.connect(mobius.frequency);
  const mobiusGain = new T.Gain(0);
  mobius.connect(mobiusGain);
  mobiusGain.connect(fxReturn);
  const beatFx = { type: "ECHO", beat: 4, depth: 0.5, on: false, source: "MASTER", touching: false };
  function routeBeatFx() {
    try { rollGate.disconnect(); } catch {}
    try { fxBus.disconnect(); } catch {}
    for (const u of Object.values(units)) try { u.disconnect(); } catch {}
    try { echoTone.disconnect(); } catch {}
    try { spiralTone.disconnect(); } catch {}
    const u = units[beatFx.type];
    if (u) {
      fxBus.connect(rollGate);
      rollGate.connect(u);
      if (beatFx.type === "ECHO") u.chain(echoTone, fxReturn);
      else if (beatFx.type === "SPIRAL") u.chain(spiralTone, fxReturn);
      else u.connect(fxReturn);
    }
    applyBeatFx();
  }
  function applyBeatFx() {
    const active = beatFx.on || beatFx.touching;
    const beats = BEATS[beatFx.beat];
    const sec = beats * beatSec();
    const type = beatFx.type;
    const depth = beatFx.depth;
    const time = type === "TRIPLET ROLL" || type === "TRIPLET FILTER" ? (sec * 2) / 3 : sec;
    const u = units[type];
    if (u && u.delayTime) u.delayTime.rampTo(Math.min(time, 1), 0.02);
    if (type === "FLANGER" || type === "PHASER" || type === "FILTER" || type === "TRIPLET FILTER") u.frequency.value = 1 / Math.max(0.05, time * 2);
    if (type === "TRANS") u.frequency.value = 1 / Math.max(0.03, time);
    mobiusLfo.frequency.value = 1 / Math.max(0.1, sec * 2);
    const insert = INSERT.has(type);
    const taps = { MASTER: masterTap, 2: chTap[2], 3: chTap[3] };
    for (const [key, tap] of Object.entries(taps)) tap.gain.rampTo(active && String(beatFx.source) === key ? 1 : 0, 0.03);
    const wet = active ? (type === "MOBIUS" ? 0 : insert ? depth : depth * 0.85) : 0;
    fxReturn.gain.rampTo(wet, 0.04);
    mobiusGain.gain.rampTo(active && type === "MOBIUS" ? depth * 0.08 : 0, 0.05);
    const dry = active && insert ? 1 - depth * 0.95 : 1;
    masterDry.gain.rampTo(beatFx.source === "MASTER" ? dry : 1, 0.03);
    for (const n of [2, 3]) ch[n].fxDry.gain.rampTo(String(beatFx.source) === String(n) ? dry : 1, 0.03);
    // a roll records one beat-length slice, then repeats it: open the gate briefly, then close it
    if ((type === "ROLL" || type === "TRIPLET ROLL") && active) {
      const now = T.now();
      rollGate.gain.cancelScheduledValues(now);
      rollGate.gain.setValueAtTime(1, now);
      rollGate.gain.setValueAtTime(0, now + Math.min(time, 1));
    } else rollGate.gain.setTargetAtTime(1, T.now(), 0.01);
  }
  const beatFxApi = {
    LIST: BEAT_FX,
    BEATS,
    state: beatFx,
    select(type) {
      beatFx.type = type;
      routeBeatFx();
    },
    beat(index) {
      beatFx.beat = Math.max(0, Math.min(BEATS.length - 1, index));
      applyBeatFx();
    },
    depth(v) {
      beatFx.depth = v;
      applyBeatFx();
    },
    source(s) {
      beatFx.source = s;
      applyBeatFx();
    },
    toggle() {
      beatFx.on = !beatFx.on;
      applyBeatFx();
    },
    touch(index) {
      beatFx.touching = index !== null;
      if (index !== null) beatFx.beat = index;
      applyBeatFx();
    },
  };

  // ---------- the players ----------
  function voicesFor(out) {
    const v = {};
    v.kick = new T.MembraneSynth({ pitchDecay: 0.04, octaves: 6.5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.08 } }).connect(out);
    v.kick.volume.value = -3;
    const clapBp = new T.Filter({ type: "bandpass", frequency: 1400, Q: 0.9 }).connect(out);
    v.clap = new T.NoiseSynth({ envelope: { attack: 0.002, decay: 0.15, sustain: 0 } }).connect(clapBp);
    v.clap.volume.value = -9;
    const hatHp = new T.Filter({ type: "highpass", frequency: 7800 }).connect(out);
    v.ch = new T.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }).connect(hatHp);
    v.ch.volume.value = -17;
    v.oh = new T.NoiseSynth({ envelope: { attack: 0.002, decay: 0.2, sustain: 0 } }).connect(hatHp);
    v.oh.volume.value = -19;
    const percBp = new T.Filter({ type: "bandpass", frequency: 5200, Q: 2 }).connect(out);
    v.perc = new T.NoiseSynth({ envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(percBp);
    v.perc.volume.value = -16;
    v.bass = new T.MonoSynth({ oscillator: { type: "fatsawtooth", count: 2, spread: 10 }, filter: { Q: 2, type: "lowpass", rolloff: -24 }, envelope: { attack: 0.004, decay: 0.2, sustain: 0.4, release: 0.08 }, filterEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.25, release: 0.1, baseFrequency: 95, octaves: 3 } }).connect(out);
    v.bass.volume.value = -9;
    const stabLp = new T.Filter({ type: "lowpass", frequency: 3200, Q: 0.8 }).connect(out);
    v.stab = new T.PolySynth(T.Synth, { maxPolyphony: 8, oscillator: { type: "fatsawtooth", count: 3, spread: 16 }, envelope: { attack: 0.003, decay: 0.22, sustain: 0.18, release: 0.12 } }).connect(stabLp);
    v.stab.volume.value = -15;
    v.keys = new T.PolySynth(T.FMSynth, { maxPolyphony: 8, harmonicity: 3, modulationIndex: 2, envelope: { attack: 0.01, decay: 1, sustain: 0.3, release: 0.9 }, modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.5 } }).connect(out);
    v.keys.volume.value = -10;
    v.organ = new T.PolySynth(T.Synth, { maxPolyphony: 8, oscillator: { type: "square8" }, envelope: { attack: 0.004, decay: 0.12, sustain: 0.3, release: 0.08 } }).connect(new T.Filter({ type: "lowpass", frequency: 2400 }).connect(out));
    v.organ.volume.value = -18;
    const padLp = new T.Filter({ type: "lowpass", frequency: 1900 }).connect(out);
    v.pad = new T.PolySynth(T.Synth, { maxPolyphony: 8, oscillator: { type: "fatsawtooth", count: 3, spread: 28 }, envelope: { attack: 0.5, decay: 0.3, sustain: 0.75, release: 1 } }).connect(padLp);
    v.pad.volume.value = -19;
    const leadLp = new T.Filter({ type: "lowpass", frequency: 3600, Q: 1.5 }).connect(out);
    v.lead = new T.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.15, release: 0.08 } }).connect(leadLp);
    v.lead.volume.value = -18;
    const riserBp = new T.Filter({ type: "bandpass", frequency: 500, Q: 2 });
    const riserGain = new T.Gain(0).connect(out);
    new T.Noise("white").start().chain(riserBp, riserGain);
    v.riser = { bp: riserBp, gain: riserGain };
    v.tonal = [v.bass, v.stab, v.keys, v.organ, v.pad, v.lead];
    return v;
  }

  function makeDeck(index) {
    // the player's line output: +7 dB into the channel, so a full mix sits around −10 dBFS on the master
    const out = new T.Gain(T.dbToGain(7));
    out.connect(ch[index === 0 ? 2 : 3].input);
    const deck = {
      index,
      channel: index === 0 ? 2 : 3,
      track: null,
      pos: 0,
      clock: 0,
      playing: false,
      ops: [],
      cue: 0,
      hot: Array(8).fill(null),
      loop: { in: null, out: null, on: false },
      loopBeats: 4,
      jumpBeats: 16,
      tempo: 0,
      range: 0.1,
      mt: true,
      sync: false,
      master: index === 0,
      nudge: 0,
      voices: voicesFor(out),
      loopNode: null,
    };
    deck.loopNode = new T.Loop((time) => tick(deck, time), "16n");
    return deck;
  }
  const decks = [makeDeck(0), makeDeck(1)];
  const masterDeck = () => decks.find((d) => d.master) ?? decks[0];
  const bpmOf = (d) => (d.sync && !d.master ? BPM * (1 + masterDeck().tempo) : BPM * (1 + d.tempo));
  function applyRate(d) {
    const rate = bpmOf(d) / BPM;
    const nudge = 1 + d.nudge;
    d.loopNode.playbackRate = rate * nudge;
    const cents = d.mt ? 1200 * Math.log2(nudge) : 1200 * Math.log2(rate * nudge);
    d.voices.tonal.forEach((v) => v.set({ detune: cents }));
  }

  function play(deck, time) {
    if (deck.track === null) return;
    const track = TRACKS[deck.track];
    const step = deck.pos;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const on = sectionOf(bar);
    const v = deck.voices;
    const swing = track.swing && s % 2 === 1 ? (beatSec() / 4) * track.swing * 0.6 : 0;
    const t = time + swing;
    const chordName = track.prog[bar % 4];
    if (on.kick && hit(track.kick, s)) {
      v.kick.triggerAttackRelease("A0", "8n", t, 0.95);
      draw(() => emit("kick", deck.index), t);
    }
    if (on.clap && hit(track.clap, s)) v.clap.triggerAttackRelease("16n", t, 0.85);
    if (on.hats && hit(track.oh, s)) v.oh.triggerAttackRelease("16n", t, 0.6);
    else if (on.hats && hit(track.ch, s)) v.ch.triggerAttackRelease("32n", t, s % 4 === 2 ? 0.9 : 0.55);
    if (on.perc && hit(track.perc, s)) v.perc.triggerAttackRelease("32n", t, 0.6);
    if (on.bass && hit(track.bass, s)) {
      const sym = track.bass[s];
      const root = T.Frequency(ROOT[chordName]);
      const note = sym === "O" ? root.transpose(12) : sym === "F" ? root.transpose(7) : root;
      v.bass.triggerAttackRelease(note.toNote(), track.genre === "Lo-fi" || track.genre === "Deep" ? "4n" : "16n", t, 0.9);
    }
    if (on.harmony && hit(track.chords, s)) v[track.keys].triggerAttackRelease(CHORD[chordName], track.chordLen, t, 0.75);
    if (on.pad && track.pad && s === 0) v.pad.triggerAttackRelease(CHORD[chordName], "1m", t, 0.6);
    if (on.lead && track.lead && hit(track.lead, s)) {
      const sym = track.lead[s];
      const pool = CHORD[chordName].map((n) => T.Frequency(n).transpose(12).toNote());
      const note = sym === "a" ? pool[(s + bar) % pool.length] : pool[Number(sym) % pool.length];
      v.lead.triggerAttackRelease(note, sym === "a" ? "32n" : "8n", t, sym === "a" ? (s % 4 === 0 ? 0.8 : 0.5) : 0.7);
    }
    if (on.riser && s === 0 && bar === 28) {
      const len = beatSec() * 16;
      v.riser.bp.frequency.cancelScheduledValues(t);
      v.riser.bp.frequency.setValueAtTime(400, t);
      v.riser.bp.frequency.exponentialRampToValueAtTime(8000, t + len);
      v.riser.gain.gain.cancelScheduledValues(t);
      v.riser.gain.gain.setValueAtTime(0, t);
      v.riser.gain.gain.linearRampToValueAtTime(0.09, t + len * 0.97);
      v.riser.gain.gain.linearRampToValueAtTime(0, t + len);
    }
  }

  function tick(deck, time) {
    // operations wait for the deck's next beat (every 4th sixteenth) or bar (every 16th)
    const due = deck.ops.filter((op) => (op.at === "now" ? true : op.at === "beat" ? deck.clock % 4 === 0 : deck.clock % 16 === 0));
    deck.ops = deck.ops.filter((op) => !due.includes(op));
    due.forEach((op) => op.fn(time));
    if (due.length) draw(() => emit("deck", deck.index), time);
    deck.clock++;
    if (!deck.playing || deck.track === null) return;
    if (deck.loop.on && deck.loop.out !== null && deck.pos >= deck.loop.out) deck.pos = deck.loop.in;
    if (deck.pos >= STEPS) {
      deck.playing = false;
      draw(() => emit("deck", deck.index), time);
      return;
    }
    play(deck, time);
    if (deck.pos % 4 === 0) draw(() => emit("beat", deck.index, deck.pos), time);
    deck.pos++;
  }

  const beatOf = (pos) => Math.floor(pos / 4) * 4;
  const queue = (deck, at, fn) => {
    deck.ops.push({ at, fn });
    emit("deck", deck.index);
  };
  const deckApi = {
    TRACKS,
    STEPS,
    BARS,
    decks,
    bpmOf,
    load(i, trackIndex) {
      const d = decks[i];
      const go = () => {
        d.track = trackIndex;
        d.pos = 0;
        d.cue = 0;
        d.hot = Array(8).fill(null);
        d.loop = { in: null, out: null, on: false };
      };
      if (d.playing) queue(d, "bar", go);
      else go();
      emit("deck", i);
    },
    playPause(i) {
      const d = decks[i];
      if (d.track === null) return "empty";
      if (d.playing) queue(d, "beat", () => (d.playing = false));
      else queue(d, "bar", () => (d.playing = true));
      return d.playing ? "pause" : "play";
    },
    cue(i) {
      const d = decks[i];
      if (d.track === null) return "empty";
      if (d.playing) {
        queue(d, "beat", () => {
          d.playing = false;
          d.pos = d.cue;
        });
        return "back";
      }
      d.cue = beatOf(d.pos);
      d.pos = d.cue;
      emit("deck", i);
      return "set";
    },
    hotCue(i, pad) {
      const d = decks[i];
      if (d.track === null) return "empty";
      if (d.hot[pad] === null) {
        if (!d.playing) {
          d.hot[pad] = beatOf(d.pos);
          emit("deck", i);
          return "saved";
        }
        d.hot[pad] = beatOf(d.pos + 2);
        emit("deck", i);
        return "saved";
      }
      const target = d.hot[pad];
      queue(d, "beat", () => {
        d.pos = target;
        d.playing = true;
      });
      return "jump";
    },
    clearHotCue(i, pad) {
      decks[i].hot[pad] = null;
      emit("deck", i);
    },
    loopIn(i) {
      const d = decks[i];
      if (d.track === null) return;
      d.loop = { in: beatOf(d.pos), out: null, on: false };
      emit("deck", i);
    },
    loopOut(i) {
      const d = decks[i];
      if (d.loop.in === null) return "noin";
      const out = Math.max(d.loop.in + 4, beatOf(d.pos + 2));
      d.loop.out = out;
      d.loop.on = true;
      emit("deck", i);
      return "on";
    },
    reloop(i) {
      const d = decks[i];
      if (d.loop.in === null || d.loop.out === null) return "none";
      d.loop.on = !d.loop.on;
      if (d.loop.on) queue(d, "beat", () => (d.pos = d.loop.in));
      emit("deck", i);
      return d.loop.on ? "on" : "exit";
    },
    // 4 BEAT and 8 BEAT: start a loop of that length; while looping they halve or double it (1 … 8 beats)
    beatLoop(i, which) {
      const d = decks[i];
      if (d.track === null) return;
      if (d.loop.on) {
        const len = (d.loop.out - d.loop.in) / 4;
        const next = which === "half" ? Math.max(1, len / 2) : Math.min(8, len * 2);
        d.loop.out = d.loop.in + next * 4;
        d.loopBeats = next;
      } else {
        const len = which === "half" ? 4 : 8;
        const from = beatOf(d.pos + 2);
        d.loop = { in: from, out: from + len * 4, on: true };
        d.loopBeats = len;
      }
      emit("deck", i);
      return d.loopBeats;
    },
    beatJump(i, dir) {
      const d = decks[i];
      if (d.track === null) return;
      queue(d, "beat", () => {
        d.pos = Math.max(0, Math.min(STEPS - 4, d.pos + dir * d.jumpBeats * 4));
        if (d.loop.on) {
          const shift = dir * d.jumpBeats * 4;
          d.loop.in += shift;
          d.loop.out += shift;
        }
      });
    },
    setJump(i, beats) {
      decks[i].jumpBeats = beats;
      emit("deck", i);
    },
    needle(i, fraction) {
      const d = decks[i];
      if (d.track === null) return;
      const target = beatOf(Math.floor(fraction * STEPS));
      if (d.playing) queue(d, "beat", () => (d.pos = target));
      else {
        d.pos = target;
        emit("deck", i);
      }
    },
    setTempo(i, v) {
      decks[i].tempo = v;
      decks.forEach(applyRate);
      emit("deck", i);
    },
    setRange(i, r) {
      decks[i].range = r;
      emit("deck", i);
    },
    setMt(i, onState) {
      decks[i].mt = onState;
      applyRate(decks[i]);
      emit("deck", i);
    },
    setSync(i, onState) {
      const d = decks[i];
      d.sync = onState;
      if (onState && !d.master) {
        // line the beat up with the master deck's grid, then follow its tempo
        const m = masterDeck();
        const offset = (m.clock - d.clock) % 16;
        d.clock += offset;
      }
      decks.forEach(applyRate);
      emit("deck", i);
    },
    setMaster(i) {
      decks.forEach((d, n) => (d.master = n === i));
      decks.forEach(applyRate);
      decks.forEach((_, n) => emit("deck", n));
    },
    // jog: velocity in turns per second while touched; paused, it moves the playhead
    jog(i, vel, turns) {
      const d = decks[i];
      if (d.track === null) return;
      if (!d.playing) {
        d.pos = Math.max(0, Math.min(STEPS - 1, Math.round(d.pos + turns * 16)));
        emit("deck", i);
        return;
      }
      d.nudge = Math.max(-0.5, Math.min(0.5, vel * 0.08));
      applyRate(d);
      const g = ch[d.channel].input.gain;
      const now = T.now();
      g.cancelScheduledValues(now);
      if (Math.abs(vel) > 0.9) {
        const s = beatSec() / 8;
        g.setValueAtTime(1, now);
        g.setValueAtTime(0.2, now + s * 0.5);
        g.setValueAtTime(1, now + s);
      } else g.setTargetAtTime(1, now, 0.02);
    },
    jogEnd(i) {
      const d = decks[i];
      d.nudge = 0;
      applyRate(d);
      ch[d.channel].input.gain.setTargetAtTime(1, T.now(), 0.03);
    },
  };

  const api = {
    BPM,
    on,
    mixer: mixerApi,
    beatFx: beatFxApi,
    ...deckApi,
    waves: TRACKS.map(waveOf),
    async start() {
      await T.start();
      T.Transport.bpm.value = BPM;
      await Promise.all([space.ready, units.REVERB.ready]);
      routeBeatFx();
      decks.forEach((d) => {
        applyRate(d);
        d.loopNode.start(0);
      });
      T.Transport.start("+0.08");
    },
    levels() {
      return { l: meterL.getValue(), r: meterR.getValue(), ch2: ch[2].meter.getValue(), ch3: ch[3].meter.getValue() };
    },
    seconds: () => T.Transport.seconds,
  };
  return api;
}
