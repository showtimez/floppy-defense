// The dial-up handshake, compressed: off-hook click, dial tone (350+440 Hz), DTMF digits, 2100 Hz answer tone with
// 15 Hz AM and a phase reversal, V.8 FSK warble (V.21 980/1180 + 1650/1850 Hz), V.34 tones A/B, two line-probe
// "bongs" (150 Hz comb), then the scrambled QAM training hiss and the speaker cutting off. All through a phone line.
import { S, TAU, noise, rng, phone, biquad, add, fadeOut, burst, scale } from './dsp.js';

const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336],
};

function tones(o, sr, t, dur, freqs, amp, fade = 0.004) {
  const i0 = S(sr, t), n = S(sr, dur), fe = Math.max(1, S(sr, fade));
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    let v = 0;
    for (let k = 0; k < freqs.length; k++) v += Math.sin(TAU * freqs[k] * i / sr);
    o[i0 + i] += v * amp * Math.min(1, i / fe, (n - i) / fe);
  }
}

// ANSam: 2100 Hz, amplitude-modulated at 15 Hz, phase flips by 180 degrees at the given offsets (the "blip" in the eeee)
function ansam(o, sr, t, dur, amp, flips, f = 2100) {
  const i0 = S(sr, t), n = S(sr, dur), fe = S(sr, 0.006);
  let k = 0, sign = 1;
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    const tt = i / sr;
    if (k < flips.length && tt >= flips[k]) { sign = -sign; k++; }
    const am = 1 + 0.2 * Math.sin(TAU * 15 * tt);
    o[i0 + i] += sign * Math.sin(TAU * f * tt) * am * amp * Math.min(1, i / fe, (n - i) / fe);
  }
}

// phase-continuous FSK at `baud`; bits: preamble of ones then pseudo-random data (that "beedle-eedle" warble)
function fsk(o, sr, t, dur, mark, space, baud, amp, r) {
  const i0 = S(sr, t), n = S(sr, dur), fe = S(sr, 0.005), per = sr / baud;
  let ph = 0, bit = 1, next = 0, idx = 0;
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    if (i >= next) { bit = idx < 10 ? 1 : (r() < 0.55 ? 1 : 0); idx++; next += per; }
    ph += (bit ? mark : space) / sr;
    ph -= Math.floor(ph);
    o[i0 + i] += Math.sin(TAU * ph) * amp * Math.min(1, i / fe, (n - i) / fe);
  }
}

// line probing L1/L2: a comb of 150 Hz harmonics (some omitted) with a fixed 0/180 phase pattern -> the "bong"
function bong(o, sr, t, dur, amp) {
  const i0 = S(sr, t), n = S(sr, dur), fe = S(sr, 0.008);
  const skip = new Set([6, 8, 12, 16]);
  const hs = [];
  for (let k = 1; k <= 25; k++) if (!skip.has(k)) hs.push([k * 150, (k * k) % 3 === 0 ? Math.PI : 0]);
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    const tt = i / sr;
    let v = 0;
    for (let h = 0; h < hs.length; h++) v += Math.cos(TAU * hs[h][0] * tt + hs[h][1]);
    const swell = 0.75 + 0.25 * Math.min(1, tt / 0.03);
    o[i0 + i] += v / 7 * amp * swell * Math.min(1, i / fe, (n - i) / fe);
  }
}

// scrambled QAM training: random 16-QAM symbols at `baud` on a carrier, linearly interpolated -> band-limited hiss
function qam(o, sr, t, dur, carrier, baud, amp, r, flutter = 0) {
  const i0 = S(sr, t), n = S(sr, dur), fe = S(sr, 0.004), per = sr / baud;
  const lv = [-3, -1, 1, 3];
  let I0 = 0, Q0 = 0, I1 = lv[(r() * 4) | 0], Q1 = lv[(r() * 4) | 0], next = 0, last = 0;
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    if (i >= next) { I0 = I1; Q0 = Q1; I1 = lv[(r() * 4) | 0]; Q1 = lv[(r() * 4) | 0]; last = next; next += per; }
    const u = (i - last) / per;
    const I = I0 + (I1 - I0) * u, Q = Q0 + (Q1 - Q0) * u;
    const w = TAU * carrier * i / sr;
    const fl = flutter ? 1 + flutter * Math.sin(TAU * 9 * i / sr) : 1;
    o[i0 + i] += (I * Math.cos(w) - Q * Math.sin(w)) / 4.2 * amp * fl * Math.min(1, i / fe, (n - i) / fe);
  }
}

function hookClick(o, sr, seed, t, g) {
  const b = biquad(burst(sr, seed, 0.0008, 0.01), 'bp', 900, 1.2, sr);
  add(o, b, g * 3, S(sr, t));
}

// short: the 1 s variant for waves 2-3. seed: picks the phone number and the data bits. ansHz: answer tone pitch
// (the short variants differ by +-40 Hz so back-to-back waves don't sound like the same sample)
export function renderModem(sr, seed = 1, short = false, ansHz = 2100) {
  const r = rng(seed * 977 + 13);
  const len = short ? 1.02 : 2.24;
  const o = new Float32Array(S(sr, len));
  let t;
  if (!short) {
    hookClick(o, sr, seed, 0, 0.6);
    tones(o, sr, 0.02, 0.25, [350, 440], 0.32, 0.01);
    const digits = ['5', '5', '5', String(1 + Math.floor(r() * 9)), String(Math.floor(r() * 10))];
    t = 0.3;
    for (const d of digits) { tones(o, sr, t, 0.05, DTMF[d], 0.34); t += 0.075; }
    t = 0.7;
    ansam(o, sr, t, 0.35, 0.56, [0.175], ansHz);
    fsk(o, sr, 1.06, 0.1, 980, 1180, 300, 0.36, r);
    fsk(o, sr, 1.13, 0.11, 1650, 1850, 300, 0.36, r);
    tones(o, sr, 1.25, 0.1, [1200], 0.22);
    ansamLike(o, sr, 1.25, 0.1, 2400, 0.22, 0.055);
    bong(o, sr, 1.37, 0.11, 0.5);
    bong(o, sr, 1.51, 0.09, 0.36);
    qam(o, sr, 1.62, 0.24, 1800, 2400, 0.46, r, 0.25);
    qam(o, sr, 1.87, 0.31, 1920, 3200, 0.52, r);
    add(o, scale(biquad(noise(S(sr, 0.55), seed + 3), 'hp', 2400, 0.7, sr), 0.05), 1, S(sr, 1.62));
  } else {
    hookClick(o, sr, seed, 0, 0.4);
    const d1 = String(1 + Math.floor(r() * 9)), d2 = String(Math.floor(r() * 10));
    tones(o, sr, 0.0, 0.04, DTMF[d1], 0.3);
    tones(o, sr, 0.06, 0.04, DTMF[d2], 0.3);
    ansam(o, sr, 0.13, 0.17, 0.56, [0.085], ansHz);
    fsk(o, sr, 0.31, 0.06, 980, 1180, 300, 0.36, r);
    fsk(o, sr, 0.36, 0.07, 1650, 1850, 300, 0.36, r);
    tones(o, sr, 0.44, 0.06, [1200], 0.2);
    ansamLike(o, sr, 0.44, 0.06, 2400, 0.2, 0.03);
    bong(o, sr, 0.52, 0.1, 0.48);
    qam(o, sr, 0.64, 0.14, 1800, 2400, 0.46, r, 0.25);
    qam(o, sr, 0.79, 0.2, 1920, 3200, 0.52, r);
    add(o, scale(biquad(noise(S(sr, 0.35), seed + 3), 'hp', 2400, 0.7, sr), 0.05), 1, S(sr, 0.64));
  }
  // line noise bed under everything
  const bed = biquad(noise(o.length, seed + 9), 'lp', 1800, 0.7, sr);
  add(o, bed, 0.012);
  const y = phone(o, sr, 1.8);
  fadeOut(y, sr, 0.008);
  return y;
}

// a single tone with one phase reversal at `flip` s (tone A / tone B)
function ansamLike(o, sr, t, dur, f, amp, flip) {
  const i0 = S(sr, t), n = S(sr, dur), fe = S(sr, 0.004);
  for (let i = 0; i < n && i0 + i < o.length; i++) {
    const tt = i / sr;
    o[i0 + i] += (tt >= flip ? -1 : 1) * Math.sin(TAU * f * tt) * amp * Math.min(1, i / fe, (n - i) / fe);
  }
}

// waves 4+: a 0.45 s reconnect. Hook click, one line-probe bong, a quarter second of QAM training, the speaker relay
// cutting off. Through the same phone line as the full handshake.
export function renderModemBlip(sr, seed = 1) {
  const r = rng(seed * 577 + 31);
  const o = new Float32Array(S(sr, 0.46));
  hookClick(o, sr, seed, 0, 0.4);
  bong(o, sr, 0.03, 0.1, 0.46);
  qam(o, sr, 0.15, 0.25, 1800 + Math.floor(r() * 3) * 60, 2400 + Math.floor(r() * 2) * 800, 0.48, r, 0.2);
  add(o, scale(biquad(noise(S(sr, 0.25), seed + 3), 'hp', 2400, 0.7, sr), 0.05), 1, S(sr, 0.15));
  hookClick(o, sr, seed + 1, 0.405, 0.22);
  add(o, biquad(noise(o.length, seed + 9), 'lp', 1800, 0.7, sr), 0.012);
  const y = phone(o, sr, 1.8);
  fadeOut(y, sr, 0.01);
  return y;
}
