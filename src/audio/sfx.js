// SFX recipe book. Every sound is rendered offline once (per variant) into a Float32Array (mono) or { L, R }
// and loudness-normalised (loudest 50 ms window -> `loud` dBFS) so the mix stays consistent whatever the recipe does.
// Fields: v = variants, loud = target dBFS, gap = min seconds between two plays, max = concurrent instances,
// pri = may exceed the global voice cap, jit = playback-rate jitter.
import {
  S, TAU, midiHz, biquad, svf, speaker, noise, brown, rng, osc, fm, env, adsr, hump, mul, add, mixAt, scale,
  fadeOut, fadeIn, normalize, softclip, bitcrush, warp, burst, room, master, loudness,
} from './dsp.js';
import { floppyInsert, floppyEject, driveCheck, seekGrind, stepTick, clack, spring } from './foley.js';
import { renderModem, renderModemBlip } from './modem.js';

const buf = (sr, len) => new Float32Array(S(sr, len));

// a gated envelope (PC speaker beeps are on/off): linear attack a, hold, linear release r at the end
function gate(n, sr, a = 0.002, r = 0.006) {
  const y = new Float32Array(n), na = Math.max(1, S(sr, a)), nr = Math.max(1, S(sr, r));
  for (let i = 0; i < n; i++) y[i] = Math.min(1, i / na, (n - i) / nr);
  return y;
}
// one PC-speaker note: f Hz, dur s, wave ('buzz' = raw square, 'pulse' band-limited)
function beep(sr, f, dur, type = 'buzz', duty = 0.5) {
  const n = S(sr, dur);
  return mul(osc(n, sr, f, type, duty), gate(n, sr));
}
function sparseClicks(sr, seed, len, rate, decay) {
  const n = S(sr, len), o = new Float32Array(n), r = rng(seed);
  for (let i = 0; i < n; i += 1 + Math.floor(sr / rate * (0.2 + r() * 1.6))) {
    const e = Math.exp(-(i / sr) / decay);
    o[i] += (r() * 2 - 1) * e;
  }
  return biquad(o, 'hp', 2500, 0.7, sr);
}
// FM brass / bell / pad note (offline)
function fmNote(sr, midi, dur, kind = 'brass', rel = 0.15) {
  const f = midiHz(midi), n = S(sr, dur + rel);
  let y;
  if (kind === 'brass') {
    y = fm(n, sr, f, 1, (t) => (t < 0.05 ? 0.6 + 2.6 * t / 0.05 : 3.2 - 1.0 * Math.min(1, (t - 0.05) / 0.3)), true);
    mul(y, adsr(n, sr, 0.025, 0.2, 0.75, dur, rel / 3));
  } else if (kind === 'bell') {
    y = fm(n, sr, f, 3.5, (t) => 3.2 * Math.exp(-t / 0.25) + 0.3);
    mul(y, env(n, sr, 0.002, (dur + rel) / 3.5));
  } else { // pad / organ
    y = fm(n, sr, f, 2, 0.9);
    mul(y, adsr(n, sr, 0.25, 0.4, 0.8, dur, rel / 3));
  }
  return y;
}
// a detuned saw pad chord through an opening lowpass (offline) -> mono
function sawPad(sr, notes, dur, cut0, cut1, attack = 0.4, rel = 0.6, detune = 0.006, seed = 1) {
  const n = S(sr, dur + rel), o = new Float32Array(n), r = rng(seed);
  for (const m of notes) {
    const f = midiHz(m);
    add(o, osc(n, sr, f * (1 + detune), 'saw', 0.5, r()), 0.5);
    add(o, osc(n, sr, f * (1 - detune), 'saw', 0.5, r()), 0.5);
    add(o, osc(n, sr, f * 0.5, 'tri', 0.5, r()), 0.25);
  }
  const y = svf(o, sr, (i) => cut0 + (cut1 - cut0) * Math.min(1, i / sr / (dur * 0.7)), 0.9, 'lp');
  return mul(y, adsr(n, sr, attack, 1, 1, dur, rel / 3));
}

// ---------------------------------------------------------------- recipes
export const SFX = {
  // IBM POST beep, then the A: drive check grind
  boot: { v: 1, loud: -17, gap: 0.5, max: 1, pri: true, render(sr, seed) {
    const o = buf(sr, 0.98);
    mixAt(o, sr, speaker(beep(sr, 1000, 0.16), sr), 0, 0.6);
    mixAt(o, sr, driveCheck(sr, seed + 4, 0.6), 0.36, 0.55);
    return o;
  } },

  click: { v: 2, loud: -24, gap: 0.025, max: 3, jit: 0.04, render(sr, seed) {
    const o = buf(sr, 0.03);
    const t = osc(S(sr, 0.012), sr, 1800 + seed * 220, 'buzz');
    add(o, mul(t, env(t.length, sr, 0.0002, 0.0025)), 0.5);
    for (let i = 0; i < S(sr, 0.0007); i++) o[i] += 0.9; // speaker cone pop
    return speaker(o, sr, 3200);
  } },

  hover: { v: 1, loud: -32, gap: 0.04, max: 2, jit: 0.05, render(sr) {
    const o = buf(sr, 0.015);
    const t = osc(S(sr, 0.006), sr, 3100, 'buzz');
    add(o, mul(t, env(t.length, sr, 0.0002, 0.0012)), 0.6);
    for (let i = 0; i < S(sr, 0.0004); i++) o[i] += 0.6;
    return speaker(o, sr, 3600);
  } },

  // "Not enough memory": two low PC-speaker bups, falling
  error: { v: 1, loud: -16, gap: 0.22, max: 1, pri: true, render(sr) {
    const o = buf(sr, 0.42);
    for (const [t, f] of [[0, 196], [0.16, 174.6]]) {
      const b = beep(sr, f, 0.12, 'buzz', 0.42);
      add(b, beep(sr, f * 0.5, 0.12, 'buzz'), 0.35);
      mixAt(o, sr, b, t, 0.6);
    }
    return softclip(speaker(o, sr, 1700), 1.6);
  } },

  floppyInsert: { v: 3, loud: -17, gap: 0.08, max: 2, pri: true, jit: 0.03, render: (sr, seed) => floppyInsert(sr, seed + 1) },

  // rising PC-speaker arpeggio, then the drive writes v2.0 to disk, then a little ding
  upgrade: { v: 2, loud: -19, gap: 0.12, max: 2, pri: true, render(sr, seed) {
    const o = buf(sr, 0.9);
    const notes = [72, 76, 79, 84, 88];
    notes.forEach((m, i) => mixAt(o, sr, speaker(beep(sr, midiHz(m + (seed % 2) * 2), 0.05, 'pulse', 0.25), sr), i * 0.048, 0.42));
    mixAt(o, sr, clack(sr, seed + 7, 0.6), 0.25, 0.3);
    mixAt(o, sr, seekGrind(sr, seed + 3, 9, 3.0), 0.27, 0.45);
    mixAt(o, sr, seekGrind(sr, seed + 4, 4, 3.3), 0.33, 0.4);
    const d = fmNote(sr, 96 + (seed % 2) * 2, 0.05, 'bell', 0.5);
    mixAt(o, sr, d, 0.4, 0.3);
    mixAt(o, sr, speaker(beep(sr, midiHz(91 + (seed % 2) * 2), 0.1, 'pulse', 0.5), sr), 0.4, 0.22);
    return o;
  } },

  // eject clunk + a small refund chirp
  sell: { v: 2, loud: -17, gap: 0.1, max: 2, pri: true, render(sr, seed) {
    const o = buf(sr, 0.55);
    mixAt(o, sr, floppyEject(sr, seed + 2), 0, 1);
    for (const [t, f] of [[0.2, 1760], [0.25, 1175]]) {
      const n = S(sr, 0.09);
      mixAt(o, sr, mul(osc(n, sr, f, 'sine'), env(n, sr, 0.001, 0.025)), t, 0.18);
    }
    return o;
  } },

  // a bright square "pew" blip
  shootAntivirus: { v: 4, loud: -25, gap: 0.06, max: 5, jit: 0.05, render(sr, seed) {
    const r = rng(seed * 31 + 7);
    const n = S(sr, 0.08), f0 = 1500 * (1 + (r() - 0.5) * 0.12), f1 = f0 * (0.45 + r() * 0.15);
    const x = osc(n, sr, (t) => f0 * Math.pow(f1 / f0, Math.min(1, t / 0.06)), 'pulse', 0.25);
    mul(x, env(n, sr, 0.0008, 0.02));
    const c = S(sr, 0.004);
    add(x, mul(biquad(noise(c, seed), 'hp', 5000, 0.7, sr), env(c, sr, 0.0001, 0.0008)), 0.4);
    return speaker(x, sr, 3000);
  } },

  // filtered noise whoosh + low thump + fire crackle
  shootFirewall: { v: 3, loud: -22, gap: 0.07, max: 3, jit: 0.05, render(sr, seed) {
    const r = rng(seed * 13 + 1);
    const len = 0.4, n = S(sr, len), o = new Float32Array(n);
    const pk = 2200 + r() * 800;
    const wh = svf(noise(n, seed), sr, (i) => { const t = i / sr; return t < 0.07 ? 350 + (pk - 350) * t / 0.07 : 500 + (pk - 500) * Math.exp(-(t - 0.07) / 0.08); }, 2.2, 'bp');
    add(o, softclip(mul(wh, adsr(n, sr, 0.025, 0.09, 0.2, 0.12, 0.05)), 2), 1.2);
    const th = S(sr, 0.18);
    add(o, mul(osc(th, sr, (t) => 135 * Math.pow(0.33, Math.min(1, t / 0.14)), 'sine'), env(th, sr, 0.002, 0.06)), 0.9);
    add(o, mul(biquad(noise(n, seed + 3), 'lp', 520, 0.7, sr), env(n, sr, 0.01, 0.09)), 0.5);
    add(o, sparseClicks(sr, seed + 5, len, 260, 0.12), 0.35);
    return o;
  } },

  // unpitched: the drive head seeks across the platter (a short stepper burst + a settle tick) over a low 190 Hz blip.
  // No melodic pitch, so a dozen defrags never fight the music's key or its 1-2 kHz lead band.
  defragPulse: { v: 2, loud: -25, gap: 0.2, max: 3, jit: 0.03, render(sr, seed) {
    const o = buf(sr, 0.24);
    mixAt(o, sr, biquad(seekGrind(sr, seed + 20, 5 + (seed % 2), 3.4, 1), 'lp', 5200, 0.7, sr), 0, 0.5);
    mixAt(o, sr, stepTick(sr, seed + 31, 0.7), 0.07, 0.32);
    const n = S(sr, 0.16);
    mixAt(o, sr, mul(osc(n, sr, (t) => 190 * Math.pow(0.5, t / 0.15), 'sine'), env(n, sr, 0.004, 0.05)), 0, 0.5);
    return o;
  } },

  hit: { v: 4, loud: -33, gap: 0.05, max: 2, jit: 0.08, render(sr, seed) {
    const r = rng(seed * 17 + 3);
    const n = S(sr, 0.035), o = new Float32Array(n);
    add(o, mul(osc(n, sr, 2600 * (0.9 + r() * 0.2), 'sine'), env(n, sr, 0.0004, 0.006)), 0.7);
    add(o, mul(biquad(noise(n, seed), 'bp', 3500, 2, sr), env(n, sr, 0.0002, 0.004)), 1);
    return o;
  } },

  // 8-bit crunchy pop. Every variant is tuned to the same note (B5, 988 Hz; only the noise differs) and carries a
  // short pulse blip on that note, so the kill streak (playbackRate steps in audio.js) reads as a clean rising scale.
  kill: { v: 4, loud: -21, gap: 0.028, max: 5, render(sr, seed) {
    const n = S(sr, 0.22), o = new Float32Array(n), f0 = 987.77;
    add(o, mul(osc(n, sr, (t) => f0 * Math.pow(0.12, Math.min(1, t / 0.12)), 'buzz'), env(n, sr, 0.001, 0.05)), 0.45);
    add(o, mul(svf(noise(n, seed), sr, (i) => 7000 * Math.exp(-i / sr / 0.04) + 300, 0.8, 'lp'), env(n, sr, 0.001, 0.04)), 0.8);
    const p = S(sr, 0.02);
    add(o, mul(osc(p, sr, (t) => 2 * f0 * Math.pow(0.25, t / 0.015), 'sine'), env(p, sr, 0.0005, 0.007)), 0.5);
    bitcrush(o, 5, 3);
    const b = S(sr, 0.035);
    add(o, mul(osc(b, sr, f0, 'pulse', 0.25), gate(b, sr, 0.001, 0.012)), 0.42);
    return biquad(o, 'lp', 9000, 0.7, sr);
  } },

  // squelchy double pop (the macro splits in two)
  split: { v: 2, loud: -22, gap: 0.05, max: 3, jit: 0.05, render(sr, seed) {
    const o = buf(sr, 0.26);
    for (const [t, k] of [[0, 1], [0.085, 1.32 + (seed % 2) * 0.1]]) {
      const n = S(sr, 0.09), f0 = 260 * k;
      const s = osc(n, sr, (tt) => f0 * (1 + 2.6 * tt / 0.07) + 70 * Math.sin(TAU * 38 * tt), 'sine');
      mul(s, env(n, sr, 0.002, 0.028));
      mixAt(o, sr, s, t, 0.7);
      const q = svf(noise(n, seed + t * 999), sr, (i) => (900 + 1100 * i / n) * k * (1 + 0.3 * Math.sin(i / sr * TAU * 45)), 5, 'bp');
      mixAt(o, sr, mul(q, env(n, sr, 0.002, 0.02)), t, 0.5);
    }
    return o;
  } },

  // a virus gets into the CPU: descending bit-crushed data zap
  leak: { v: 2, loud: -22, gap: 0.1, max: 3, render(sr, seed) {
    const r = rng(seed * 41 + 2);
    const len = 0.3, n = S(sr, len), steps = Math.ceil(len / 0.007), tab = [];
    for (let k = 0; k <= steps; k++) tab.push(2200 * Math.pow(0.14, k / steps) * (0.65 + 0.7 * r()));
    const x = osc(n, sr, (t) => tab[Math.min(steps, Math.floor(t / 0.007))], 'buzz');
    mul(x, env(n, sr, 0.002, 0.1));
    add(x, mul(biquad(noise(n, seed), 'hp', 3000, 0.7, sr), env(n, sr, 0.001, 0.03)), 0.4);
    return bitcrush(speaker(x, sr, 2400), 4, 4);
  } },

  // the CPU takes a hit: low thud + harsh electrical buzz + a PC-speaker alarm + a crackling arc. The buzz, alarm and
  // arc live above 200 Hz so the hit still reads on laptop and phone speakers that have no low end.
  cpuHit: { v: 2, loud: -14, gap: 0.12, max: 2, pri: true, jit: 0.04, render(sr, seed) {
    const len = 0.6, n = S(sr, len), o = new Float32Array(n);
    const th = S(sr, 0.4);
    add(o, mul(osc(th, sr, (t) => 95 * Math.pow(0.34, Math.min(1, t / 0.3)), 'sine'), env(th, sr, 0.002, 0.13)), 1);
    add(o, biquad(burst(sr, seed, 0.0006, 0.008), 'lp', 2500, 0.7, sr), 0.6);
    const trem = new Float32Array(n);
    for (let i = 0; i < n; i++) trem[i] = 0.7 + 0.3 * Math.sin(TAU * 31 * i / sr);
    const bz = new Float32Array(n);
    add(bz, osc(n, sr, 220, 'saw'), 0.5);
    add(bz, osc(n, sr, 233, 'saw'), 0.5);
    add(bz, osc(n, sr, 110, 'buzz'), 0.4);
    softclip(bz, 4);
    add(o, mul(mul(biquad(bz, 'lp', 4500, 0.8, sr), env(n, sr, 0.003, 0.3)), trem), 0.9);
    // "uh-oh" PC-speaker alarm, falling a fourth (sustained enough to hold its own in a busy mix)
    const al = buf(sr, 0.25);
    mixAt(al, sr, beep(sr, 440, 0.11, 'buzz'), 0, 1);
    mixAt(al, sr, beep(sr, 330, 0.11, 'buzz'), 0.12, 1);
    add(o, speaker(al, sr, 1800), 1.3, S(sr, 0.05));
    const an = S(sr, 0.25), arc = mul(biquad(noise(an, seed + 7), 'bp', 3000, 2, sr), env(an, sr, 0.002, 0.09));
    for (let i = 0; i < an; i++) arc[i] *= 0.5 + 0.5 * Math.sin(TAU * 31 * i / sr);
    add(o, arc, 1.1);
    add(o, sparseClicks(sr, seed + 3, 0.35, 400, 0.08), 0.4);
    return o;
  } },

  // ominous FM drone + alarm siren + riser into an impact (stereo)
  bossSpawn: { v: 1, loud: -13, gap: 1.5, max: 1, pri: true, render(sr, seed) {
    const len = 2.8, n = S(sr, len), L = new Float32Array(n), R = new Float32Array(n);
    const swell = adsr(n, sr, 0.7, 1, 1, 2.3, 0.1);
    const idx = (t) => 0.6 + 5.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t / 2.4)), 1.5);
    const dl = mul(fm(n, sr, 55, 1.414, idx, true), swell);
    const dr = mul(fm(n, sr, 55.5, 1.414, idx, true), swell);
    add(L, dl, 0.55); add(R, dr, 0.55);
    const sub = mul(osc(n, sr, 27.5, 'sine'), swell);
    add(L, sub, 0.4); add(R, sub, 0.4);
    for (let k = 0; k < 8; k++) {
      const b = speaker(beep(sr, k % 2 ? 660 : 880, 0.14, 'buzz'), sr, 2200);
      const p = k % 2 ? 0.35 : -0.35;
      const off = S(sr, 0.12 + k * 0.16);
      add(L, b, 0.26 * (1 - p) * 0.7, off); add(R, b, 0.26 * (1 + p) * 0.7, off);
    }
    const rs = S(sr, 1.15), rise = svf(noise(rs, seed), sr, (i) => 400 * Math.pow(15, i / rs), 1.2, 'bp');
    for (let i = 0; i < rs; i++) rise[i] *= Math.pow(i / rs, 2);
    add(L, rise, 0.35, S(sr, 1.2)); add(R, rise, 0.35, S(sr, 1.21));
    const kn = S(sr, 0.45), kick = mul(osc(kn, sr, (t) => 120 * Math.pow(0.28, Math.min(1, t / 0.3)), 'sine'), env(kn, sr, 0.002, 0.15));
    add(kick, mul(biquad(noise(kn, seed + 2), 'lp', 1800, 0.7, sr), env(kn, sr, 0.001, 0.06)), 0.6);
    add(L, kick, 0.9, S(sr, 2.35)); add(R, kick, 0.9, S(sr, 2.35));
    return { L, R };
  } },

  // big bit-crushed explosion + triumphant FM brass fanfare (stereo)
  bossKill: { v: 1, loud: -12, gap: 1, max: 1, pri: true, render(sr, seed) {
    const len = 3.1, n = S(sr, len), m = new Float32Array(n);
    const ex = svf(noise(n, seed), sr, (i) => 5200 * Math.exp(-i / sr / 0.25) + 90, 0.8, 'lp');
    add(m, bitcrush(mul(ex, env(n, sr, 0.003, 0.45)), 6, 2), 1);
    add(m, mul(biquad(brown(n, seed + 1), 'lp', 220, 0.7, sr), env(n, sr, 0.01, 0.45)), 0.9);
    const th = S(sr, 0.8);
    add(m, mul(osc(th, sr, (t) => 72 * Math.pow(0.33, Math.min(1, t / 0.6)), 'sine'), env(th, sr, 0.002, 0.25)), 1);
    add(m, sparseClicks(sr, seed + 4, 1.2, 500, 0.22), 0.4);
    const fan = new Float32Array(n);
    const chord = [63, 67, 70, 75]; // Eb major: the fanfare resolves straight into the Eb victory pad
    for (const [t, d] of [[0.42, 0.1], [0.58, 0.1], [0.74, 1.5]]) for (const c of chord) mixAt(fan, sr, fmNote(sr, c, d, 'brass', 0.25), t, 0.42);
    [82, 87, 91, 94].forEach((c, i) => mixAt(fan, sr, speaker(beep(sr, midiHz(c), 0.06, 'pulse', 0.25), sr), 0.74 + i * 0.06, 0.45));
    mixAt(fan, sr, mul(osc(S(sr, 0.9), sr, (t) => midiHz(99) * (1 + 0.012 * Math.sin(TAU * 6 * t)), 'pulse', 0.5), adsr(S(sr, 0.9), sr, 0.01, 0.3, 0.6, 0.6, 0.1)), 0.98, 0.3);
    const wet = room(fan, sr, { size: 0.7, mix: 0.35, tail: 0.1 });
    const L = new Float32Array(n), R = new Float32Array(n);
    add(L, m, 1); add(R, m, 1);
    add(L, wet.L, 1); add(R, wet.R, 1);
    return { L, R };
  } },

  modem: { v: 1, loud: -21, gap: 0.6, max: 1, pri: true, render: (sr, seed) => renderModem(sr, seed + 4, false) },
  modemShort: { v: 3, loud: -21, gap: 0.6, max: 1, pri: true, render: (sr, seed) => renderModem(sr, seed * 3 + 2, true, 2100 + [-40, 0, 40][(seed - 1) % 3]) },
  // waves 4+: the line is already trained, just a 0.45 s reconnect blip (hook click, one bong, a burst of QAM)
  modemBlip: { v: 3, loud: -23, gap: 0.4, max: 1, pri: true, render: (sr, seed) => renderModemBlip(sr, seed * 5 + 1) },

  // happy 4-note PC-speaker jingle
  waveClear: { v: 1, loud: -18, gap: 0.5, max: 1, pri: true, render(sr) {
    const o = buf(sr, 0.85);
    const notes = [[84, 0, 0.075], [88, 0.085, 0.075], [91, 0.17, 0.075], [96, 0.255, 0.36]];
    for (const [mN, t, d] of notes) {
      const n = S(sr, d), f = midiHz(mN);
      const x = osc(n, sr, (tt) => f * (1 + (d > 0.2 ? 0.01 * Math.sin(TAU * 7 * Math.max(0, tt - 0.08)) : 0)), 'pulse', 0.5);
      mul(x, d > 0.2 ? adsr(n, sr, 0.003, 0.25, 0.55, d - 0.04, 0.012) : gate(n, sr));
      mixAt(o, sr, speaker(x, sr, 3000), t, 0.5);
      mixAt(o, sr, fmNote(sr, mN - 12, d, 'bell', 0.3), t, 0.16);
    }
    return o;
  } },

  // motherboard over-temperature siren
  overheat: { v: 1, loud: -18, gap: 0.8, max: 1, pri: true, render(sr) {
    const o = buf(sr, 0.95);
    for (let k = 0; k < 8; k++) mixAt(o, sr, beep(sr, k % 2 ? 1350 : 950, 0.1, 'buzz'), k * 0.11, 0.5);
    return speaker(o, sr, 2600);
  } },
  warn: { v: 1, loud: -22, gap: 0.6, max: 1, pri: true, render(sr) {
    const o = buf(sr, 0.3);
    mixAt(o, sr, beep(sr, 1200, 0.07, 'buzz'), 0, 0.5);
    mixAt(o, sr, beep(sr, 1200, 0.07, 'buzz'), 0.13, 0.5);
    return speaker(o, sr, 2600);
  } },

  // fan whoosh rising: blade-pass AM, motor whine
  fanSpin: { v: 2, loud: -21, gap: 0.2, max: 2, jit: 0.04, render(sr, seed) {
    const len = 1.0, n = S(sr, len), o = new Float32Array(n);
    const bp = svf(noise(n, seed), sr, (i) => 260 * Math.pow(10, Math.min(1, i / n / 0.8)), 3.2, 'bp');
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, rate = 8 + 42 * Math.min(1, t / 0.8);
      ph += rate / sr;
      bp[i] *= 0.65 + 0.35 * Math.sin(TAU * ph);
    }
    add(o, bp, 1);
    add(o, osc(n, sr, (t) => 180 * Math.pow(3.4, Math.min(1, t / 0.8)), 'tri'), 0.14);
    add(o, biquad(noise(n, seed + 1), 'lp', 400, 0.7, sr), 0.1);
    return mul(o, adsr(n, sr, 0.15, 1, 1, 0.72, 0.09));
  } },
  cooled: { v: 1, loud: -22, gap: 0.5, max: 1, render(sr, seed) {
    const len = 0.7, n = S(sr, len), o = new Float32Array(n);
    const bp = svf(noise(n, seed), sr, (i) => 2400 * Math.pow(0.12, i / n), 1.3, 'bp');
    add(o, mul(bp, env(n, sr, 0.02, 0.18)), 0.8);
    for (const [t, m] of [[0.12, 79], [0.22, 86]]) mixAt(o, sr, fmNote(sr, m, 0.08, 'bell', 0.35), t, 0.4);
    return o;
  } },

  // the crash: sound card buffer stutter, a falling bit-crushed buzz, then the CRT powers off (thunk + static + flyback)
  bsod: { v: 1, loud: -13, gap: 1, max: 1, pri: true, render(sr, seed) {
    const len = 2.4, o = buf(sr, len);
    const ch = S(sr, 0.05), chunk = new Float32Array(ch);
    for (const m of [64, 67, 71]) add(chunk, fm(ch, sr, midiHz(m), 1, 1.8, true), 0.22);
    add(chunk, osc(ch, sr, midiHz(88), 'pulse', 0.25), 0.18);
    add(chunk, osc(ch, sr, midiHz(40), 'buzz'), 0.3);
    add(chunk, mul(biquad(noise(ch, seed), 'hp', 6000, 0.7, sr), env(ch, sr, 0.0005, 0.008)), 0.5);
    let t = 0;
    for (let k = 0; k < 9; k++) {
      const rate = 1 - k * 0.075, w = warp(chunk, sr, rate, 0.05 / rate);
      mixAt(o, sr, w, t, 0.95 * (1 - k * 0.05));
      t += 0.05 / rate * 0.98;
    }
    const cn = S(sr, 0.75);
    const cr = mul(osc(cn, sr, (tt) => 700 * Math.pow(0.05, tt / 0.7), 'buzz'), env(cn, sr, 0.002, 0.28));
    add(cr, mul(svf(noise(cn, seed + 1), sr, (i) => 4000 * Math.exp(-i / sr / 0.2) + 100, 0.7, 'lp'), env(cn, sr, 0.002, 0.2)), 0.6);
    mixAt(o, sr, bitcrush(cr, 4, 3), t, 0.6);
    const off = t + 0.75;
    const thn = S(sr, 0.35);
    mixAt(o, sr, mul(osc(thn, sr, (tt) => 62 * Math.pow(0.45, Math.min(1, tt / 0.25)), 'sine'), env(thn, sr, 0.002, 0.1)), off, 1);
    mixAt(o, sr, biquad(burst(sr, seed + 2, 0.0005, 0.006), 'hp', 1500, 0.7, sr), off, 0.5);
    const st = S(sr, 0.7);
    mixAt(o, sr, mul(svf(noise(st, seed + 3), sr, 4500, 0.8, 'bp'), env(st, sr, 0.001, 0.2)), off, 0.4);
    const fl = S(sr, 0.6);
    mixAt(o, sr, mul(osc(fl, sr, (tt) => Math.min(sr * 0.4, 12000) * Math.pow(0.33, tt / 0.6), 'sine'), env(fl, sr, 0.01, 0.2)), off, 0.05);
    fadeOut(o, sr, 0.1);
    return o;
  } },

  // a warm startup-style pad swell (original): Ab/Eb -> Ebmaj9, FM bell sparkles, room (stereo)
  victory: { v: 1, loud: -15, gap: 2, max: 1, pri: true, render(sr, seed) {
    const len = 4.4, n = S(sr, len), m = new Float32Array(n);
    mixAt(m, sr, sawPad(sr, [51, 56, 60, 63, 70], 1.6, 400, 2600, 0.45, 0.5, 0.006, seed), 0, 0.12);
    mixAt(m, sr, sawPad(sr, [51, 58, 62, 65, 67, 74], 2.3, 700, 3800, 0.35, 1.1, 0.007, seed + 1), 1.45, 0.12);
    const bn = S(sr, 4.0);
    mixAt(m, sr, mul(osc(bn, sr, midiHz(39), 'tri'), adsr(bn, sr, 0.4, 1, 1, 3.3, 0.25)), 0, 0.3);
    [70, 75, 77, 79].forEach((c, i) => mixAt(m, sr, fmNote(sr, c, 0.1, 'bell', 0.9), 0.3 + i * 0.11, 0.18));
    [70, 74, 77, 82, 86].forEach((c, i) => mixAt(m, sr, fmNote(sr, c, 0.1, 'bell', 1.2), 1.62 + i * 0.1, 0.16));
    const sw = S(sr, 0.5), swell = biquad(noise(sw, seed + 5), 'hp', 3000, 0.7, sr);
    for (let i = 0; i < sw; i++) swell[i] *= Math.pow(i / sw, 2.5);
    mixAt(m, sr, swell, 1.0, 0.12);
    fadeOut(m, sr, 0.5);
    return room(m, sr, { size: 0.85, damp: 0.5, mix: 0.4, tail: 0.01 });
  } },

  tick: { v: 1, loud: -19, gap: 0.15, max: 2, pri: true, render(sr) {
    return speaker(beep(sr, 1000, 0.06, 'buzz'), sr, 2800);
  } },

  // coin-like blip
  kbGain: { v: 1, loud: -21, gap: 0.08, max: 2, render(sr) {
    const o = buf(sr, 0.32);
    mixAt(o, sr, beep(sr, 987.77, 0.05, 'pulse', 0.25), 0, 0.5);
    const n = S(sr, 0.22);
    mixAt(o, sr, mul(osc(n, sr, 1318.51, 'pulse', 0.25), adsr(n, sr, 0.002, 0.08, 0.3, 0.12, 0.03)), 0.05, 0.5);
    mixAt(o, sr, fmNote(sr, 100, 0.05, 'bell', 0.25), 0.05, 0.12);
    return speaker(o, sr, 3200);
  } },

  // ILOVEYOU mass-mails a worm: an original "new mail" chime (FM bell G5 -> C6 with a PC-speaker E6 glint)
  mailChime: { v: 1, loud: -20, gap: 0.4, max: 2, pri: true, render(sr) {
    const o = buf(sr, 0.36);
    mixAt(o, sr, fmNote(sr, 79, 0.05, 'bell', 0.28), 0, 0.5);
    mixAt(o, sr, fmNote(sr, 84, 0.07, 'bell', 0.3), 0.085, 0.55);
    mixAt(o, sr, speaker(beep(sr, midiHz(88), 0.05, 'pulse', 0.25), sr, 3000), 0.09, 0.22);
    fadeOut(o, sr, 0.08);
    return o;
  } },

  // the drive loading FLOPPY.EXE (new game)
  diskLoad: { v: 1, loud: -19, gap: 0.5, max: 1, render: (sr, seed) => driveCheck(sr, seed + 9, 0.55) },

  // spring tick used by the UI when a card is pressed (alias-friendly extra)
  latch: { v: 1, loud: -22, gap: 0.05, max: 2, render(sr, seed) {
    const o = buf(sr, 0.1);
    mixAt(o, sr, clack(sr, seed, 0.5), 0, 0.8);
    mixAt(o, sr, spring(sr, seed + 1, 2600, 0.06), 0.004, 0.2);
    return o;
  } },
};

export const SFX_NAMES = Object.keys(SFX);

// render one variant, mastered. Returns { L, R? , ms }
export function renderSfx(name, sr, variant = 0) {
  const def = SFX[name];
  if (!def) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const out = def.render(sr, variant + 1);
  let L, R = null;
  if (out instanceof Float32Array) {
    L = master(out, sr, def.loud);
  } else {
    L = out.L; R = out.R;
    const mid = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mid[i] = (L[i] + R[i]) * 0.5;
    const g = Math.pow(10, (def.loud - loudness(mid, sr)) / 20);
    scale(L, g); scale(R, g);
    limitPair(L, R);
  }
  fadeIn(L, sr, 0.0005);
  fadeOut(L, sr, 0.004);
  if (R) { fadeIn(R, sr, 0.0005); fadeOut(R, sr, 0.004); }
  return { L, R, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
}

function limitPair(L, R, ceil = 0.97) {
  const k = ceil * 0.8, h = ceil * 0.2;
  for (const a of [L, R]) for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!(v === v)) { a[i] = 0; continue; }
    const av = Math.abs(v);
    if (av > k) a[i] = Math.sign(v) * (k + h * Math.tanh((av - k) / h));
  }
}
