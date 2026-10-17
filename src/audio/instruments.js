// Real-time music voices on the audio clock: AdLib/OPL2-style 2-operator FM (modulator osc -> carrier frequency,
// optional OPL "half-sine" carrier waveform), band-limited PC-speaker pulse waves (12.5 / 25 / 50 %), and a drum kit +
// ambient beds rendered offline once (8-bit-ish kick/snare/hats, floppy head ticks and seek grinds as percussion,
// 50 Hz mains hum and case-fan noise loops).
import { S, TAU, noise, osc, biquad, env, mul, add, bitcrush, softclip, normalize } from './dsp.js';
import { stepTick, seekGrind } from './foley.js';

export const KIT_SR = 32000;

// FM presets: ratio = modulator/carrier, i0 -> i1 modulation index (i1 reached with time-constant iTau, or ramped
// linearly over iAtk when rising), amp ADSR (a s, d time-constant, s level, r time-constant), cw: carrier waveform
export const FM = {
  bass: { ratio: 1, i0: 4.2, i1: 1.1, iTau: 0.05, a: 0.004, d: 0.12, s: 0.55, r: 0.04, cw: 'half' },
  sub: { ratio: 1, i0: 1.4, i1: 0.3, iTau: 0.08, a: 0.006, d: 0.25, s: 0.6, r: 0.06, cw: 'sine' },
  slap: { ratio: 1, i0: 6.5, i1: 1.8, iTau: 0.035, a: 0.003, d: 0.07, s: 0.6, r: 0.03, cw: 'half' },
  keys: { ratio: 1, i0: 2.3, i1: 0.25, iTau: 0.22, a: 0.003, d: 0.5, s: 0.25, r: 0.18, cw: 'sine' },
  bell: { ratio: 3.5, i0: 3.4, i1: 0.3, iTau: 0.25, a: 0.002, d: 0.6, s: 0.0, r: 0.35, cw: 'sine' },
  brass: { ratio: 1, i0: 0.5, i1: 2.6, iAtk: 0.06, a: 0.025, d: 0.3, s: 0.8, r: 0.07, cw: 'half' },
  pad: { ratio: 2, i0: 0.9, i1: 0.7, iTau: 0.8, a: 0.4, d: 1.0, s: 0.85, r: 0.5, cw: 'sine' },
  organ: { ratio: 0.5, i0: 1.3, i1: 1.1, iTau: 0.3, a: 0.01, d: 0.2, s: 0.9, r: 0.06, cw: 'half' },
  pluck: { ratio: 2, i0: 3.0, i1: 0.1, iTau: 0.04, a: 0.002, d: 0.12, s: 0.0, r: 0.05, cw: 'sine' },
};

function periodicWaves(ac) {
  const N = 40;
  const pulse = (d) => {
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      re[k] = Math.sin(TAU * k * d) / (Math.PI * k);
      im[k] = (1 - Math.cos(TAU * k * d)) / (Math.PI * k);
    }
    return ac.createPeriodicWave(re, im);
  };
  // OPL2 waveform 1: half-sine (positive half only)
  const re = new Float32Array(N), im = new Float32Array(N);
  im[1] = 0.5;
  for (let k = 2; k < N; k += 2) re[k] = -2 / (Math.PI * (k * k - 1));
  return { p12: pulse(0.125), p25: pulse(0.25), p50: pulse(0.5), half: ac.createPeriodicWave(re, im) };
}

// ---------------------------------------------------------------- the offline kit
function metal(n, sr, seed) { // TR-808-style: six detuned squares, hp
  const o = new Float32Array(n);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) add(o, osc(n, sr, f * (1 + (seed % 3) * 0.002), 'buzz'), 1 / 6);
  return o;
}
function loopify(x, len, xf) { // crossfade the tail into the head -> a seamless loop of `len` samples
  const y = x.slice(0, len);
  for (let i = 0; i < xf; i++) { const k = i / xf; y[i] = x[i] * k + x[i + len] * (1 - k); }
  return y;
}

export function renderKit(sr = KIT_SR) {
  const K = {};
  { // kick: pitch-dropping sine + click, slightly driven
    const n = S(sr, 0.36);
    const k = mul(osc(n, sr, (t) => 48 + 110 * Math.exp(-t / 0.035), 'sine'), env(n, sr, 0.001, 0.11));
    add(k, mul(biquad(noise(S(sr, 0.006), 3), 'hp', 1500, 0.7, sr), env(S(sr, 0.006), sr, 0.0002, 0.001)), 0.35);
    K.k = normalize(softclip(k, 1.8), 0.95);
  }
  { // snare: noise body + tone, 7-bit
    const n = S(sr, 0.22);
    const nz = mul(biquad(noise(n, 5), 'bp', 2400, 0.6, sr), env(n, sr, 0.001, 0.055));
    add(nz, mul(osc(n, sr, (t) => 190 - 30 * Math.min(1, t / 0.05), 'tri'), env(n, sr, 0.001, 0.03)), 0.7);
    K.s = normalize(bitcrush(nz, 7, 2), 0.9);
  }
  { // closed / open hat, crash
    const n = S(sr, 0.06);
    K.h = normalize(mul(biquad(add(metal(n, sr, 1), noise(n, 7), 0.5), 'hp', 7000, 0.7, sr), env(n, sr, 0.0005, 0.011)), 0.6);
    const n2 = S(sr, 0.32);
    K.o = normalize(mul(biquad(add(metal(n2, sr, 2), noise(n2, 8), 0.6), 'hp', 6500, 0.7, sr), env(n2, sr, 0.001, 0.08)), 0.55);
    const n3 = S(sr, 1.6);
    const cr = add(metal(n3, sr, 3), noise(n3, 9), 1.2);
    K.c = normalize(bitcrush(mul(biquad(cr, 'hp', 4200, 0.7, sr), env(n3, sr, 0.002, 0.42)), 8, 2), 0.6);
  }
  { // shaker, tom
    const n = S(sr, 0.06);
    K.p = normalize(mul(biquad(noise(n, 11), 'bp', 6500, 1.5, sr), env(n, sr, 0.006, 0.014)), 0.5);
    const n2 = S(sr, 0.3);
    K.m = normalize(mul(osc(n2, sr, (t) => 95 + 70 * Math.exp(-t / 0.05), 'sine'), env(n2, sr, 0.002, 0.1)), 0.9);
  }
  // floppy drive percussion: a head tick (rim) and a short seek grind (fills)
  K.t = normalize(stepTick(sr, 4, 1), 0.7);
  K.g = normalize(seekGrind(sr, 6, 14, 3.1), 0.8);
  { // 50 Hz mains hum (exactly 50 periods in 1 s -> seamless loop), transformer buzz harmonics
    const n = sr;
    const h = new Float32Array(n);
    for (const [m, a] of [[1, 0.45], [2, 1], [3, 0.3], [4, 0.22], [5, 0.1], [6, 0.08], [8, 0.04]]) add(h, osc(n, sr, 50 * m, 'sine'), a);
    K.hum = normalize(softclip(h, 1.3), 0.8);
  }
  { // case fan: low air noise with 25 Hz blade-pass flutter (50 cycles in 2 s), seamless 2 s loop
    const len = sr * 2, xf = S(sr, 0.2), n = len + xf;
    const a = biquad(noise(n, 21), 'lp', 900, 0.6, sr);
    add(a, biquad(noise(n, 22), 'bp', 240, 1.2, sr), 0.6);
    for (let i = 0; i < n; i++) a[i] *= 0.8 + 0.2 * Math.sin(TAU * 25 * i / sr);
    K.fan = normalize(loopify(a, len, xf), 0.8);
  }
  return K;
}

// ---------------------------------------------------------------- real-time voices
export function createInstruments(ac, kitSr = KIT_SR) {
  const waves = periodicWaves(ac);
  let kitBufs = null, kitPending = false;
  const st = { voices: 0 };

  // the kit can be injected from the bank worker (setKit); until then (kitPending) drum hits are skipped,
  // otherwise it is rendered synchronously on first use
  function setKit(K) {
    const bufs = {};
    for (const k in K) {
      const b = ac.createBuffer(1, K[k].length, kitSr);
      b.getChannelData(0).set(K[k]);
      bufs[k] = b;
    }
    kitBufs = bufs;
    kitPending = false;
  }
  function ensureKit() {
    if (!kitBufs) setKit(renderKit(kitSr));
    return kitBufs;
  }
  function getKit() {
    if (kitBufs) return kitBufs;
    return kitPending ? null : ensureKit();
  }

  function done(node, extra) {
    st.voices++;
    node.onended = () => {
      st.voices--;
      try { node.disconnect(); for (const e of extra) e.disconnect(); } catch (e) { /* ignore */ }
    };
  }

  // 2-op FM note
  function fmNote(dest, t, f, dur, p, vel = 1, detune = 0) {
    const car = ac.createOscillator();
    if (p.cw === 'half') car.setPeriodicWave(waves.half); else car.type = 'sine';
    car.frequency.setValueAtTime(f, t);
    if (detune) car.detune.setValueAtTime(detune, t);
    const mod = ac.createOscillator();
    mod.frequency.setValueAtTime(f * p.ratio, t);
    if (detune) mod.detune.setValueAtTime(detune, t);
    const mg = ac.createGain();
    const dHz = f * p.ratio;
    mg.gain.setValueAtTime(p.i0 * dHz, t);
    if (p.iAtk) mg.gain.linearRampToValueAtTime(p.i1 * dHz, t + p.iAtk);
    else mg.gain.setTargetAtTime(p.i1 * dHz, t, p.iTau);
    mod.connect(mg);
    mg.connect(car.frequency);
    const vg = ac.createGain();
    const a = Math.min(p.a, Math.max(0.002, dur * 0.5));
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(vel, t + a);
    vg.gain.setTargetAtTime(vel * p.s, t + a, p.d);
    vg.gain.setTargetAtTime(0, t + Math.max(dur, a + 0.001), p.r);
    car.connect(vg);
    vg.connect(dest);
    const end = t + dur + p.r * 6;
    car.start(t); mod.start(t);
    car.stop(end); mod.stop(end);
    done(car, [vg, mg, mod]);
  }

  // PC-speaker style pulse note (optional pitch slide from `from` Hz)
  function pulseNote(dest, t, f, dur, wave = 'p25', vel = 1, o = {}) {
    const os = ac.createOscillator();
    os.setPeriodicWave(waves[wave] || waves.p25);
    if (o.from) {
      os.frequency.setValueAtTime(o.from, t);
      os.frequency.exponentialRampToValueAtTime(f, t + (o.slide || 0.04));
    } else os.frequency.setValueAtTime(f, t);
    if (o.detune) os.detune.setValueAtTime(o.detune, t);
    const g = ac.createGain();
    const a = o.a ?? 0.003, r = o.r ?? 0.025, s = o.s ?? 0.75, d = o.d ?? 0.12;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + a);
    g.gain.setTargetAtTime(vel * s, t + a, d);
    g.gain.setTargetAtTime(0, t + Math.max(dur, a + 0.001), r);
    os.connect(g);
    g.connect(dest);
    os.start(t);
    os.stop(t + dur + r * 6);
    done(os, [g]);
  }

  function drum(dest, t, name, vel = 1, rate = 1) {
    const b = getKit()?.[name];
    if (!b) return;
    const src = ac.createBufferSource();
    src.buffer = b;
    if (rate !== 1) src.playbackRate.setValueAtTime(rate, t);
    const g = ac.createGain();
    g.gain.setValueAtTime(vel, t);
    src.connect(g);
    g.connect(dest);
    src.start(t);
    done(src, [g]);
  }

  // looping ambient bed (hum / fan): returns a stop(t) handle
  function bed(dest, t, name, vol) {
    const b = getKit()?.[name];
    if (!b) return null;
    const src = ac.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.2);
    src.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    return {
      stop(at) {
        try {
          g.gain.setTargetAtTime(0, at, 0.15);
          src.stop(at + 1);
          src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
        } catch (e) { /* ignore */ }
      },
    };
  }

  return {
    st, waves, ensureKit, setKit, fmNote, pulseNote, drum, bed, FM,
    setKitPending(v) { kitPending = !!v && !kitBufs; },
    get voices() { return st.voices; },
  };
}

