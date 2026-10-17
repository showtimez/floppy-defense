// adapted from ZelariFPS/src/audio/dsp.js
// Offline DSP on Float32Arrays: every SFX buffer is rendered once (lazily, time-sliced) after the audio unlock.
// Pure functions, zero imports, deterministic seeds. Nothing here touches WebAudio.

export const S = (sr, s) => Math.max(1, Math.floor(s * sr));
export const TAU = Math.PI * 2;
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------------------------------- filters
export function biquad(x, type, f, q, sr, gainDb = 0) {
  const w = TAU * Math.min(f, sr * 0.49) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; } // peaking
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// state-variable filter (TPT form, stable while the cutoff moves). fc: Hz or fn(sampleIndex) re-read every 16 samples
export function svf(x, sr, fc, q = 0.707, mode = 'lp') {
  const y = new Float32Array(x.length), k = 1 / q, fn = typeof fc === 'function';
  const G = (f) => Math.tan(Math.PI * Math.min(Math.max(f, 10), sr * 0.45) / sr);
  let ic1 = 0, ic2 = 0, g = G(fn ? fc(0) : fc);
  for (let i = 0; i < x.length; i++) {
    if (fn && (i & 15) === 0) g = G(fc(i));
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    y[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : x[i] - k * v1 - v2;
  }
  return y;
}

// a small PC speaker / cheap cone: no lows, a nasal resonance, rolled-off top
export function speaker(x, sr, reso = 2800) {
  let y = biquad(x, 'hp', 260, 0.7, sr);
  y = biquad(y, 'pk', reso, 1.4, sr, 6);
  return biquad(y, 'lp', 7000, 0.7, sr);
}

// telephone line: 300..3400 Hz band, a touch of speaker saturation
export function phone(x, sr, drive = 1.6) {
  let y = biquad(x, 'hp', 320, 0.7, sr);
  y = biquad(y, 'hp', 300, 0.7, sr);
  y = biquad(y, 'lp', 3300, 0.7, sr);
  y = biquad(y, 'lp', 3500, 0.7, sr);
  return softclip(y, drive);
}

// ------------------------------------------------------------------------------------------- sources
export function noise(n, seed = 1) {
  const a = new Float32Array(n);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; a[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  return a;
}
export function brown(n, seed = 1) {
  const w = noise(n, seed), a = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) { v = (v + w[i] * 0.02) * 0.998; a[i] = v * 3.5; }
  return a;
}

// a seeded 0..1 generator (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// band-limited oscillator. f: Hz or fn(tSeconds) -> Hz. type: sine | square | pulse | saw | tri | buzz (naive square)
export function osc(n, sr, f, type = 'sine', duty = 0.5, phase0 = 0) {
  const a = new Float32Array(n), fn = typeof f === 'function';
  let ph = phase0, fr = fn ? f(0) : f;
  for (let i = 0; i < n; i++) {
    if (fn) fr = f(i / sr);
    const dt = Math.min(0.5, Math.abs(fr) / sr);
    let v;
    if (type === 'sine') v = Math.sin(TAU * ph);
    else if (type === 'saw') v = 2 * ph - 1 - blep(ph, dt);
    else if (type === 'tri') v = 1 - 4 * Math.abs(ph - 0.5);
    else if (type === 'buzz') v = ph < duty ? 1 : -1;
    else {
      const d = type === 'square' ? 0.5 : duty;
      v = ph < d ? 1 : -1;
      v += blep(ph, dt);
      v -= blep((ph + 1 - d) % 1, dt);
    }
    a[i] = v;
    ph += fr / sr;
    ph -= Math.floor(ph);
  }
  return a;
}

// 2-operator phase-modulation FM (OPL / DX style). fc: carrier Hz or fn(t). index: number or fn(t).
// halfSine: OPL2 waveform 1 on the carrier (adds that gritty AdLib bite)
export function fm(n, sr, fc, ratio, index, halfSine = false, fb = 0) {
  const a = new Float32Array(n), ff = typeof fc === 'function', fi = typeof index === 'function';
  let pc = 0, pm = 0, prev = 0, f = ff ? fc(0) : fc, I = fi ? index(0) : index;
  for (let i = 0; i < n; i++) {
    if ((i & 7) === 0) { const t = i / sr; if (ff) f = fc(t); if (fi) I = index(t); }
    const m = Math.sin(TAU * pm + fb * prev);
    prev = m;
    let v = Math.sin(TAU * pc + I * m);
    if (halfSine && v < 0) v = 0;
    a[i] = v;
    pc += f / sr; pc -= Math.floor(pc);
    pm += f * ratio / sr; pm -= Math.floor(pm);
  }
  if (halfSine) { // remove the DC the half-wave adds
    let m = 0;
    for (let i = 0; i < n; i++) m += a[i];
    m /= n;
    for (let i = 0; i < n; i++) a[i] = (a[i] - m) * 1.6;
  }
  return a;
}

// ------------------------------------------------------------------------------------------- envelopes & mixing
export function env(n, sr, att, dec, shape = 1) {
  const a = new Float32Array(n);
  const at = Math.max(1, att * sr), dc = Math.max(1, dec * sr);
  for (let i = 0; i < n; i++) a[i] = i < at ? i / at : Math.pow(Math.exp(-(i - at) / dc), shape);
  return a;
}
// attack, decay to sustain, hold until `hold` s, release (all seconds); linear segments + exp decay
export function adsr(n, sr, a, d, s, hold, r) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v;
    if (t < a) v = t / a;
    else if (t < hold) v = s + (1 - s) * Math.exp(-(t - a) / Math.max(1e-4, d));
    else {
      const vh = hold < a ? hold / a : s + (1 - s) * Math.exp(-(hold - a) / Math.max(1e-4, d));
      v = vh * Math.exp(-(t - hold) / Math.max(1e-4, r));
    }
    y[i] = v;
  }
  return y;
}
// a smooth sin^p hump over the whole buffer
export function hump(n, p = 1) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = Math.pow(Math.sin(Math.PI * i / n), p);
  return y;
}
export function mul(a, b) { const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) a[i] *= b[i]; for (let i = m; i < a.length; i++) a[i] = 0; return a; }
export function scale(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function add(dst, src, g = 1, off = 0) {
  for (let i = 0; i < src.length && i + off < dst.length; i++) if (i + off >= 0) dst[i + off] += src[i] * g;
  return dst;
}
// mix src into dst at time t (seconds)
export function mixAt(dst, sr, src, t, g = 1) { return add(dst, src, g, Math.floor(t * sr)); }
export function fadeOut(a, sr, dur) { const m = Math.min(a.length, S(sr, dur)); for (let i = 0; i < m; i++) a[a.length - 1 - i] *= i / m; return a; }
export function fadeIn(a, sr, dur) { const m = Math.min(a.length, S(sr, dur)); for (let i = 0; i < m; i++) a[i] *= i / m; return a; }
export function normalize(a, peak = 0.9) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }
export function softclip(a, k = 1.5) { const d = Math.tanh(k); for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * k) / d; return a; }

// 8-bit flavour: quantise to `bits` and sample-and-hold every `hold` samples
export function bitcrush(a, bits = 6, hold = 2) {
  const q = Math.pow(2, bits - 1);
  let v = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % hold === 0) v = Math.round(a[i] * q) / q;
    a[i] = v;
  }
  return a;
}

// resample (linear) by a playback-rate curve: rate number or fn(tOut) -> rate. Used for "dying" tape/buffer effects.
export function warp(x, sr, rate, len) {
  const n = S(sr, len), y = new Float32Array(n), fn = typeof rate === 'function';
  let p = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(p);
    if (k + 1 >= x.length) break;
    const fr = p - k;
    y[i] = x[k] * (1 - fr) + x[k + 1] * fr;
    p += fn ? rate(i / sr) : rate;
  }
  return y;
}

// ------------------------------------------------------------------------------------------- physical-ish
// a bank of two-pole resonators (modal synthesis): modes [[Hz, amplitude, decay s], ...] rung by excitation x
export function modal(x, sr, modes, n = x.length) {
  const y = new Float32Array(n);
  for (const [f, a, d] of modes) {
    if (f >= sr * 0.46 || f <= 0) continue;
    const w = TAU * f / sr, r = Math.exp(-1 / (d * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = a * Math.sin(w);
    let y1 = 0, y2 = 0;
    const m = Math.min(n, x.length + Math.ceil(d * sr * 7));
    for (let i = 0; i < m; i++) { const v = (i < x.length ? x[i] : 0) * g + c1 * y1 + c2 * y2; y2 = y1; y1 = v; y[i] += v; }
  }
  return y;
}

// an exponentially decaying noise burst (the contact that rings the modes): tau s, len s
export function burst(sr, seed, tau, len = tau * 6) {
  const n = Math.max(2, Math.floor(len * sr)), a = noise(n, seed), k = Math.exp(-1 / Math.max(1, tau * sr));
  let e = 1;
  for (let i = 0; i < n; i++) { a[i] *= e; e *= k; }
  return a;
}

// ------------------------------------------------------------------------------------------- stereo
export function panLR(p) { const a = (p + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }
export function addPan(L, R, src, g, off, p) { const [a, b] = panLR(p); add(L, src, g * a, off); add(R, src, g * b, off); }

// a tiny Schroeder room (4 combs + 2 allpasses per side, decorrelated) -> { L, R }. mix: wet amount.
export function room(x, sr, { size = 0.5, damp = 0.4, mix = 0.25, tail = 0.8 } = {}) {
  const n = x.length + S(sr, tail), L = new Float32Array(n), R = new Float32Array(n);
  const k = sr / 44100;
  const combs = [1116, 1188, 1277, 1356], aps = [556, 441];
  const fb = 0.7 + 0.28 * size;
  for (let side = 0; side < 2; side++) {
    const out = side ? R : L, spread = side ? 23 : 0;
    const wet = new Float32Array(n);
    for (const c of combs) {
      const len = Math.floor((c + spread) * k * (0.6 + size * 0.6)), buf = new Float32Array(len);
      let idx = 0, lp = 0;
      for (let i = 0; i < n; i++) {
        const o = buf[idx];
        lp = o * (1 - damp) + lp * damp;
        buf[idx] = (i < x.length ? x[i] : 0) + lp * fb;
        wet[i] += o;
        if (++idx >= len) idx = 0;
      }
    }
    for (const a of aps) {
      const len = Math.floor((a + spread) * k), buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx], v = wet[i];
        buf[idx] = v + b * 0.5;
        wet[i] = b - v * 0.5;
        if (++idx >= len) idx = 0;
      }
    }
    for (let i = 0; i < n; i++) out[i] = (i < x.length ? x[i] : 0) * (1 - mix) + wet[i] * mix * 0.25;
  }
  return { L, R };
}

// ------------------------------------------------------------------------------------------- analysis / mastering
// loudest short-window RMS (dBFS), window w seconds
export function loudness(a, sr, w = 0.05) {
  const m = Math.max(16, Math.floor(w * sr));
  let best = 0, acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc += a[i] * a[i];
    if (i >= m) acc -= a[i - m] * a[i - m];
    if (i >= m - 1 || i === a.length - 1) best = Math.max(best, acc / Math.min(m, i + 1));
  }
  return 10 * Math.log10(Math.max(1e-12, best));
}
export function peak(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }

// scale so the loudest 50 ms window sits at targetDb, then soft-limit the peaks below `ceil`
export function master(a, sr, targetDb, ceil = 0.97) {
  const g = Math.pow(10, (targetDb - loudness(a, sr)) / 20);
  for (let i = 0; i < a.length; i++) a[i] *= g;
  if (peak(a) > ceil) for (let i = 0; i < a.length; i++) { const v = a[i]; if (Math.abs(v) > ceil * 0.8) a[i] = Math.sign(v) * (ceil * 0.8 + ceil * 0.2 * Math.tanh((Math.abs(v) - ceil * 0.8) / (ceil * 0.2))); }
  for (let i = 0; i < a.length; i++) if (!(a[i] === a[i])) a[i] = 0; // NaN guard
  return a;
}
