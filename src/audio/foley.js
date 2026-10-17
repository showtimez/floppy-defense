// adapted from ZelariFPS/src/audio/foley.js (contact / scrape / spring / seq + mode tables)
// Physically-informed mechanical sounds of a 3.5" floppy drive: plastic slide, latch clack, shutter spring,
// spindle motor spin-up, stepper-motor head seeks (the iconic "grrk-grrrk" chatter) and the eject clunk.
import { S, biquad, svf, noise, env, mul, add, modal, burst, normalize, rng, osc, mixAt, fadeOut } from './dsp.js';

// ---------------------------------------------------------------- materials (mode sets: [Hz, amplitude, decay s])
export const STEEL_S = [[2350, 1, 0.012], [3720, 0.8, 0.009], [5180, 0.6, 0.007], [6900, 0.4, 0.005], [8600, 0.25, 0.004]];
export const STEEL_M = [[1180, 1, 0.02], [1910, 0.8, 0.016], [2870, 0.7, 0.012], [4130, 0.45, 0.009], [5600, 0.3, 0.006]];
export const POLY = [[260, 1, 0.012], [480, 0.6, 0.009], [820, 0.35, 0.006]];
// the drive's stamped steel chassis and the head carriage
export const CHASSIS = [[610, 1, 0.014], [1040, 0.75, 0.011], [1630, 0.6, 0.009], [2470, 0.45, 0.007], [3550, 0.3, 0.005]];
export const CARRIAGE = [[1450, 1, 0.006], [2280, 0.7, 0.005], [3390, 0.5, 0.004], [4870, 0.3, 0.003]];
// the beige PC case panel the drive is screwed into (a low boxy resonance)
export const CASE = [[118, 1, 0.03], [196, 0.7, 0.022], [305, 0.45, 0.016]];

// a mode set detuned / re-weighted for a variant; k: pitch spread, sc: pitch scale
export function jit(r, modes, k = 0.04, sc = 1) {
  return modes.map(([f, a, d]) => [f * sc * (1 + (r() - 0.5) * 2 * k), a * (0.7 + 0.6 * r()), d * (0.8 + 0.4 * r())]);
}

// ---------------------------------------------------------------- building blocks
// a hard contact: a noise burst rings the part's modes, a hp click on top, an optional second mode set (the body)
export function contact(sr, seed, o) {
  const n = S(sr, o.len || 0.15);
  let ex = burst(sr, seed, o.tau || 0.00015, o.exLen || 0.004);
  if (o.exLp) ex = svf(ex, sr, o.exLp, 0.7);
  const out = normalize(modal(ex, sr, o.modes, n), 1);
  if (o.body) add(out, normalize(modal(ex, sr, o.body, n), 1), o.bodyG ?? 0.6);
  if (o.click) { const m = S(sr, 0.003); add(out, mul(biquad(noise(m, seed + 1), 'hp', 4000, 0.7, sr), env(m, sr, 0.00005, 0.0005)), o.click); }
  return out;
}

// friction: stick-slip impulses through a band moving f0 -> f1, optionally ringing modes; hump envelope
export function scrape(sr, seed, len, f0, f1, o = {}) {
  const n = S(sr, len), r = rng(seed), e = new Float32Array(n), nz = noise(n, seed + 7);
  const rate = o.rate || 400, grit = o.grit ?? 0.6;
  for (let i = 0; i < n; i++) e[i] = nz[i] * (1 - grit) * 0.35;
  for (let i = Math.floor(r() * sr / rate); i < n; i += 1 + Math.floor(sr / rate * (0.4 + r() * 1.2))) e[i] += (r() * 2 - 1) * grit;
  const y = svf(e, sr, (i) => f0 + (f1 - f0) * (i / n), o.q || 1.8, 'bp');
  normalize(y, 1);
  if (o.modes) add(y, normalize(modal(e, sr, o.modes, n), 1), o.ring ?? 0.3);
  const sh = o.shape ?? 0.7;
  for (let i = 0; i < n; i++) y[i] *= Math.pow(Math.sin(Math.PI * i / n), sh);
  return normalize(y, 1);
}

// a coil spring's buzz (a short inharmonic ring with a flutter)
export function spring(sr, seed, f = 3200, len = 0.08) {
  const y = modal(burst(sr, seed, 0.001, 0.01), sr, [[f, 1, 0.03], [f * 1.53, 0.7, 0.025], [f * 2.11, 0.5, 0.02], [f * 2.9, 0.3, 0.015]], S(sr, len));
  for (let i = 0; i < y.length; i++) y[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 85 * i / sr);
  return normalize(y, 1);
}

// a timeline: parts [[t s, Float32Array, gain], ...] into len s, normalised to peak
export function seq(sr, len, parts, pk = 0.9) {
  const o = new Float32Array(S(sr, len));
  for (const [t, a, g] of parts) add(o, a, g, S(sr, t));
  return normalize(o, pk);
}

// ---------------------------------------------------------------- floppy drive parts
// one stepper-motor step: the carriage ticks against its lead screw, the chassis rings under it
export function stepTick(sr, seed, bright = 1) {
  const r = rng(seed);
  return contact(sr, seed, {
    modes: jit(r, CARRIAGE, 0.06, 0.85 + 0.3 * bright), body: jit(r, CHASSIS, 0.05), bodyG: 0.8,
    len: 0.03, tau: 0.00018, exLen: 0.002, click: 0.25,
  });
}

// a head seek: `steps` stepper ticks `stepMs` apart. The repetition rate is the pitch of the "grrrk" (~250-330 Hz).
export function seekGrind(sr, seed, steps, stepMs = 3.2, gain = 1) {
  const r = rng(seed + 11);
  const tick = stepTick(sr, seed, 0.8 + r() * 0.4);
  const tick2 = stepTick(sr, seed + 5, 0.8 + r() * 0.4);
  const dt = stepMs / 1000;
  const o = new Float32Array(S(sr, steps * dt + 0.04));
  for (let k = 0; k < steps; k++) {
    // the motor's micro-stepping makes alternate steps sound different; slight timing jitter
    const t = k * dt * (1 + (r() - 0.5) * 0.04);
    const g = gain * (0.75 + 0.25 * r()) * (k === 0 ? 1.25 : 1);
    add(o, k & 1 ? tick2 : tick, g, S(sr, t));
  }
  // the stepping current whines a bit through the coils
  const n = o.length, w = osc(n, sr, 1000 / stepMs, 'square');
  const e = new Float32Array(n);
  const on = steps * dt;
  for (let i = 0; i < n; i++) { const t = i / sr; e[i] = t < on ? 0.06 : 0.06 * Math.exp(-(t - on) / 0.004); }
  add(o, biquad(mul(w, e), 'bp', 1800, 2, sr), gain * 0.5);
  return o;
}

// the head-load solenoid / clamp: a solid metallic clack into the case
export function clack(sr, seed, g = 1) {
  const r = rng(seed);
  return contact(sr, seed, {
    modes: jit(r, STEEL_M, 0.05, 0.9), body: jit(r, CHASSIS, 0.05, 0.9), bodyG: 0.9,
    len: 0.09, tau: 0.00025, exLen: 0.003, click: 0.35 * g,
  });
}

// spindle motor: a low "vrrrr" spinning up to 300 rpm, bearing whirr and the 5 Hz wobble of the disk
export function motor(sr, seed, len, spin = 0.22) {
  const n = S(sr, len);
  const f = (t) => 46 + 52 * Math.min(1, t / spin) * (2 - Math.min(1, t / spin));
  const hum = biquad(osc(n, sr, f, 'saw'), 'lp', 520, 0.9, sr);
  const whine = osc(n, sr, (t) => f(t) * 6.02, 'tri');
  const whirr = svf(noise(n, seed), sr, (i) => 700 + 500 * Math.min(1, i / sr / spin), 2.2, 'bp');
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const wob = 1 + 0.18 * Math.sin(2 * Math.PI * 5 * t) + 0.06 * Math.sin(2 * Math.PI * 10 * t + 1);
    const a = Math.min(1, t / 0.03) * Math.min(1, (len - t) / 0.12);
    o[i] = (hum[i] * 0.7 + whine[i] * 0.16 + whirr[i] * 0.45) * wob * Math.max(0, a);
  }
  return o;
}

// ---------------------------------------------------------------- full recipes
// insert a disk: slide in, latch clack + shutter spring, hub clamp, motor spin-up, then 3-6 head seeks
export function floppyInsert(sr, seed) {
  const r = rng(seed * 7 + 3);
  const len = 1.3;
  const o = new Float32Array(S(sr, len));
  mixAt(o, sr, scrape(sr, seed, 0.12, 620, 1500, { rate: 340, grit: 0.55, modes: POLY, ring: 0.45 }), 0, 0.3);
  // the latch: the plastic shell slams home, the steel shutter spring snaps, the case panel thumps
  mixAt(o, sr, contact(sr, seed + 1, { modes: jit(r, POLY, 0.06, 1.4), body: jit(r, STEEL_S, 0.05, 0.75), bodyG: 0.7, len: 0.12, click: 0.7, tau: 0.0003 }), 0.115, 1.25);
  mixAt(o, sr, spring(sr, seed + 2, 2500 + r() * 400, 0.07), 0.12, 0.2);
  mixAt(o, sr, contact(sr, seed + 4, { modes: jit(r, CASE, 0.05), body: jit(r, CHASSIS, 0.04), bodyG: 0.5, len: 0.14, tau: 0.0006, exLen: 0.006 }), 0.117, 0.8);
  // hub clamp + head load
  mixAt(o, sr, clack(sr, seed + 3, 0.8), 0.2, 0.6);
  mixAt(o, sr, motor(sr, seed + 5, 1.0), 0.22, 0.24);
  // the drive reads the disk: recalibrate (long grind), then 3-5 shorter seeks
  let t = 0.36;
  const seeks = 4 + Math.floor(r() * 3);
  for (let k = 0; k < seeks; k++) {
    const steps = k === 0 ? 24 + Math.floor(r() * 14) : 3 + Math.floor(r() * (k % 2 ? 14 : 6));
    const ms = 2.9 + r() * 0.9;
    const g = seekGrind(sr, seed + 20 + k, steps, ms, k === 0 ? 1 : 0.85);
    if (t + g.length / sr > len - 0.06) break;
    mixAt(o, sr, g, t, k === 0 ? 0.34 : 0.3);
    t += g.length / sr + 0.025 + r() * 0.06;
  }
  fadeOut(o, sr, 0.08);
  return o;
}

// eject: button click, the spring kicks the disk out with a clunk, plastic slides out
export function floppyEject(sr, seed) {
  const r = rng(seed * 5 + 1);
  const o = new Float32Array(S(sr, 0.5));
  mixAt(o, sr, contact(sr, seed, { modes: jit(r, STEEL_S, 0.05, 1.1), body: jit(r, POLY, 0.05, 1.5), bodyG: 0.5, len: 0.04, click: 0.4 }), 0, 0.35);
  mixAt(o, sr, clack(sr, seed + 1, 1), 0.055, 0.8);
  mixAt(o, sr, contact(sr, seed + 2, { modes: jit(r, CASE, 0.05, 1.1), body: jit(r, POLY, 0.05), bodyG: 0.6, len: 0.14, tau: 0.0007, exLen: 0.008 }), 0.058, 0.55);
  mixAt(o, sr, spring(sr, seed + 3, 1900 + r() * 300, 0.09), 0.06, 0.22);
  mixAt(o, sr, scrape(sr, seed + 4, 0.12, 1500, 650, { rate: 300, grit: 0.5, modes: POLY, ring: 0.4 }), 0.075, 0.3);
  fadeOut(o, sr, 0.04);
  return o;
}

// BIOS drive check: head-load clack, recalibrate grind, short seek back
export function driveCheck(sr, seed, len = 0.55) {
  const r = rng(seed);
  const o = new Float32Array(S(sr, len));
  mixAt(o, sr, clack(sr, seed, 0.7), 0, 0.6);
  mixAt(o, sr, motor(sr, seed + 1, len - 0.02, 0.12), 0.0, 0.14);
  const g1 = seekGrind(sr, seed + 2, 34 + Math.floor(r() * 10), 3.1, 1);
  mixAt(o, sr, g1, 0.05, 0.5);
  mixAt(o, sr, seekGrind(sr, seed + 3, 6, 3.4, 0.9), 0.06 + g1.length / sr + 0.05, 0.45);
  fadeOut(o, sr, 0.05);
  return o;
}
