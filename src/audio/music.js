// adapted from Giocomobile/tempesta-fixart/src/game/audio.js (look-ahead step sequencer on the audio clock)
// Tracker-style sequencer: 16th-note steps scheduled ~0.3 s ahead on AudioContext time, one bus per playing track
// (with its own echo), crossfades between tracks, start-at-time (the wave music "connects" when the modem does).
// Works with an OfflineAudioContext too: play(..., { at: 0 }) then scheduleUntil(seconds).
import { TRACKS } from './tracks.js';
import { createInstruments, FM } from './instruments.js';
import { midiHz, rng } from './dsp.js';

const LOOKAHEAD = 0.3;
const VOICE_CAP = 30; // music voices; low-priority channels (arp/pad) are dropped first

// ---------------------------------------------------------------- parsing
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteMidi(s) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14], 9: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], sus4: [0, 5, 7], sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], dim: [0, 3, 6], aug: [0, 4, 8],
};
// -> { root (pitch class), tones: semitone offsets, bass (pitch class) }
export function parseChord(sym) {
  const [main, slash] = sym.split('/');
  const m = /^([A-G])([#b]?)(.*)$/.exec(main);
  if (!m) return { root: 0, tones: [0, 4, 7], bass: 0 };
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const tones = QUAL[m[3]] || QUAL[''];
  let bass = root;
  if (slash) { const b = /^([A-G])([#b]?)$/.exec(slash); if (b) bass = (PC[b[1]] + (b[2] === '#' ? 1 : b[2] === 'b' ? -1 : 0) + 12) % 12; }
  return { root, tones, bass };
}
const toks = (s) => s.trim().split(/\s+/);

// token string -> events [{ step, tok, dur }] ('.' holds, '_' rests)
function holdEvents(tokens, res = 1) {
  const ev = [];
  let cur = null;
  tokens.forEach((tk, i) => {
    const step = i * res;
    if (tk === '.') { if (cur) cur.dur += res; return; }
    cur = null;
    if (tk === '_') return;
    cur = { step, tok: tk, dur: res };
    ev.push(cur);
  });
  return ev;
}

function compile(T) {
  if (T._c) return T._c;
  const c = { stepDur: 60 / T.bpm / 4, sections: [] };
  const P = T.parts || {};
  for (const sec of T.song) {
    const bars = sec.chords.length;
    const s = { sec, bars, len: bars * 16, chords: sec.chords.map(parseChord) };
    // bass: per-step events within a bar
    if (sec.bass && P.bass?.[sec.bass]) { s.bass = []; for (const e of holdEvents(toks(P.bass[sec.bass]))) s.bass[e.step] = e; }
    if (sec.arp && P.arp?.[sec.arp]) s.arp = toks(P.arp[sec.arp]).map((t) => (/^\d+$/.test(t) ? Number(t) : -1));
    for (const ch of ['comp', 'stab']) {
      const pat = sec[ch] && P[ch]?.[sec[ch]];
      if (!pat) continue;
      const hits = [];
      for (let i = 0; i < pat.length; i++) if (pat[i] === 'x' || pat[i] === 'X') hits.push(i);
      s[ch] = hits.map((h, i) => ({ step: h, dur: (i + 1 < hits.length ? hits[i + 1] : 16) - h }));
    }
    if (sec.drums && P.drums?.[sec.drums]) s.drums = P.drums[sec.drums];
    if (sec.fill && P.drums?.[sec.fill]) s.fill = P.drums[sec.fill];
    const L = sec.lead && P.lead?.[sec.lead];
    if (L) {
      const res = L.res || 2;
      const all = [];
      for (const b of L.bars) all.push(...toks(b));
      const evs = holdEvents(all, res);
      const plen = L.bars.length * 16;
      s.lead = new Array(s.len);
      for (const e of evs) {
        const midi = noteMidi(e.tok);
        if (midi == null) continue;
        for (let rep = 0; rep * plen < s.len; rep++) { const st = e.step + rep * plen; if (st < s.len) s.lead[st] = { midi, dur: e.dur }; }
      }
    }
    c.sections.push(s);
  }
  T._c = c;
  return c;
}

// chord tones from octave `oct`, stacked upward: index i -> i-th tone, wrapping an octave up
function chordTone(ch, oct, i) {
  const n = ch.tones.length;
  const o = Math.floor(i / n), k = ((i % n) + n) % n;
  return 12 * (oct + 1) + ch.root + ch.tones[k] + 12 * o;
}
function bassNote(tok, ch, next, oct) {
  const base = 12 * (oct + 1) + ch.bass;
  switch (tok) {
    case 'R': return base;
    case 'O': return base + 12;
    case 'F': return 12 * (oct + 1) + ch.root + 7 + (ch.root + 7 >= 12 + ch.bass ? -12 : 0);
    case 'f': return 12 * (oct + 1) + ch.root - 5;
    case '3': return 12 * (oct + 1) + ch.root + ch.tones[1];
    case '7': return 12 * (oct + 1) + ch.root + (ch.tones[3] ?? 12);
    case 'N': return 12 * (oct + 1) + (next ? next.bass : ch.bass) - 1 + ((next ? next.bass : ch.bass) === 0 ? 12 : 0);
    default: return base;
  }
}

// ---------------------------------------------------------------- engine
export function createMusic(ac, out) {
  const inst = createInstruments(ac);
  let current = null;
  const fading = [];
  let seed = 1;

  // sections whose minLevel is above the instance level are skipped (later waves unlock extra material)
  function playable(I, k) { const m = I.c.sections[k].sec.minLevel; return !m || I.level >= m; }
  function nextSec(I, k) {
    const n = I.c.sections.length;
    for (let j = 1; j <= n; j++) { const s = (k + j) % n; if (playable(I, s)) return s; }
    return k;
  }

  function makeInstance(name, t0, fadeIn, rate = 1, section = 0, tr = 0, level = 99) {
    const T = TRACKS[name];
    const c = compile(T);
    const sd = c.stepDur / rate;
    const now = ac.currentTime;
    const bus = ac.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(1, t0 + Math.max(0.01, fadeIn));
    bus.connect(out);
    const nodes = [bus];
    // echo: send -> delay -> lowpass -> feedback, wet -> bus
    const send = ac.createGain();
    const dl = ac.createDelay(2);
    dl.delayTime.value = Math.min(1.9, (T.echo?.beats ?? 0.75) * 60 / T.bpm / rate);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = T.echo?.lp ?? 2500;
    const fb = ac.createGain();
    fb.gain.value = T.echo?.fb ?? 0.3;
    const wet = ac.createGain();
    wet.gain.value = T.echo?.wet ?? 0.3;
    send.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(bus);
    nodes.push(send, dl, lp, fb, wet);
    // channel strips
    const ch = {};
    for (const k in T.inst) {
      const cfg = T.inst[k];
      const g = ac.createGain();
      g.gain.value = cfg.vol ?? 0.1;
      let head = g;
      if (cfg.pan && ac.createStereoPanner) {
        const p = ac.createStereoPanner();
        p.pan.value = cfg.pan;
        g.connect(p);
        head = p;
        nodes.push(p);
      }
      head.connect(bus);
      if (cfg.send) {
        const s = ac.createGain();
        s.gain.value = cfg.send;
        head.connect(s);
        s.connect(send);
        nodes.push(s);
      }
      nodes.push(g);
      ch[k] = { cfg, g, preset: cfg.kind === 'fm' ? FM[cfg.preset] || FM.keys : null };
    }
    const I = { name, T, c, sd, bus, ch, nodes, next: t0, sec: ((section % c.sections.length) + c.sections.length) % c.sections.length, step: 0, stopAt: Infinity, beds: [], rnd: rng(seed++ * 7919), nextAmb: t0 + 2, tr, level, rate };
    if (!playable(I, I.sec)) I.sec = nextSec(I, I.sec);
    if (T.bed) {
      if (T.bed.hum) I.beds.push(inst.bed(bus, t0, 'hum', T.bed.hum));
      if (T.bed.fan) I.beds.push(inst.bed(bus, t0, 'fan', T.bed.fan));
    }
    return I;
  }

  function stopInstance(I, at, fade) {
    if (!I || I.stopAt !== Infinity) return;
    const t = Math.max(ac.currentTime, at);
    try {
      I.bus.gain.cancelScheduledValues(t);
      I.bus.gain.setValueAtTime(I.bus.gain.value, t);
      I.bus.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
    } catch (e) { /* ignore */ }
    I.stopAt = t + fade;
    for (const b of I.beds) b?.stop(t);
    fading.push(I);
  }

  function disposeInstance(I) {
    for (const n of I.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  }

  function voice(I, k, t, midi, dur, vel = 1) {
    const C = I.ch[k];
    if (!C) return;
    const pri = C.cfg.pri ?? 3;
    if (inst.st.voices > VOICE_CAP + (pri >= 3 ? 14 : pri === 2 ? 6 : 0)) return;
    const f = midiHz(midi + I.tr);
    const det = I.T.wobble ? (I.rnd() - 0.5) * 2 * I.T.wobble : 0;
    if (C.cfg.kind === 'fm') inst.fmNote(C.g, t, f, dur, C.preset, vel, det);
    else inst.pulseNote(C.g, t, f, dur, C.cfg.wave, vel, { detune: det });
  }

  function playStep(I, t) {
    const { c, T } = I;
    const S = c.sections[I.sec];
    const sd = I.sd;
    const bar = Math.floor(I.step / 16), k = I.step % 16;
    const chord = S.chords[bar];
    const nextChord = S.chords[bar + 1] || c.sections[nextSec(I, I.sec)].chords[0];
    const tt = t + (T.swing && k % 2 === 1 ? T.swing * sd : 0);
    // drums
    const D = bar === S.bars - 1 && S.fill ? S.fill : S.drums;
    const dc = I.ch.drums;
    if (D && dc) {
      for (const lane in D) {
        const p = D[lane], ch = p[(bar === S.bars - 1 && S.fill ? k : I.step) % p.length];
        if (ch === 'x' || ch === 'X') inst.drum(dc.g, tt, lane, ch === 'X' ? 1 : 0.62);
      }
      if (S.sec.crash && I.step === 0) inst.drum(dc.g, tt, 'c', 0.7);
    }
    // bass
    const be = S.bass?.[k];
    if (be) voice(I, 'bass', tt, bassNote(be.tok, chord, k + be.dur >= 16 ? nextChord : chord, I.ch.bass?.cfg.oct ?? 2), be.dur * sd * 0.92, 1);
    // arp
    if (S.arp) {
      const a = S.arp[k % S.arp.length];
      if (a >= 0) voice(I, 'arp', tt, chordTone(chord, I.ch.arp?.cfg.oct ?? 4, a), sd * (I.ch.arp?.cfg.gate ?? 0.6), 1);
    }
    // comp / stab chords
    for (const chn of ['comp', 'stab']) {
      const hits = S[chn];
      if (!hits) continue;
      for (const h of hits) {
        if (h.step !== k) continue;
        const oct = I.ch[chn]?.cfg.oct ?? 4;
        const n = Math.min(4, chord.tones.length);
        for (let i = 0; i < n; i++) voice(I, chn, tt + i * 0.004, chordTone(chord, oct, i), h.dur * sd * 0.9, 0.8);
      }
    }
    // pad
    if (S.sec.pad && k === 0) {
      const oct = I.ch.pad?.cfg.oct ?? 3;
      for (let i = 0; i < Math.min(5, chord.tones.length); i++) voice(I, 'pad', tt, chordTone(chord, oct, i), 16 * sd, 0.8);
    }
    // lead
    const le = S.lead?.[I.step];
    if (le) voice(I, 'lead', tt, le.midi, le.dur * sd * 0.94, 1);
    // ambient: the PC thinking (random floppy/HDD ticks and short seeks) under the prep bed
    if (T.bed?.ticks && t >= I.nextAmb && dc) {
      const r = I.rnd();
      if (r < 0.5) { for (let j = 0, m = 2 + Math.floor(I.rnd() * 4); j < m; j++) inst.drum(dc.g, t + j * (0.05 + I.rnd() * 0.08), 't', 0.35); }
      else inst.drum(dc.g, t, 'g', 0.3, 0.9 + I.rnd() * 0.2);
      I.nextAmb = t + 2 + I.rnd() * 5;
    }
  }

  function scheduleInstance(I, tEnd) {
    const sd = I.sd;
    if (I.next < ac.currentTime - 0.2) I.next = ac.currentTime + 0.05; // resync after a hidden tab / hitch
    let guard = 0;
    while (I.next < tEnd && I.next < I.stopAt && guard++ < 256) {
      playStep(I, I.next);
      I.next += sd;
      I.step++;
      if (I.step >= I.c.sections[I.sec].len) { I.step = 0; I.sec = nextSec(I, I.sec); }
    }
  }

  function scheduleUntil(tEnd) {
    if (current) scheduleInstance(current, tEnd);
    for (let i = fading.length - 1; i >= 0; i--) {
      const I = fading[i];
      if (ac.currentTime > I.stopAt + 3) { disposeInstance(I); fading.splice(i, 1); continue; }
      scheduleInstance(I, tEnd);
    }
  }

  return {
    get current() { return current ? current.name : null; },
    get voices() { return inst.st.voices; },
    // debug / tests: what the current track is doing
    get state() { return current ? { name: current.name, rate: current.rate, transpose: current.tr, level: current.level, section: current.sec, startsIn: Math.max(0, +(current.next - ac.currentTime).toFixed(2)) } : null; },
    inst,
    // switch track. at: audio time to start (default now); fade: crossfade seconds; rate: tempo multiplier;
    // section: index of the song section to start from; transpose: semitones (drums unaffected);
    // level: sections with a higher minLevel are skipped (default: everything plays)
    play(name, { at = 0, fade = 1.2, rate = 1, section = 0, transpose = 0, level = 99 } = {}) {
      const now = ac.currentTime;
      if (current && current.name === name && current.stopAt === Infinity) return;
      const start = Math.max(now + 0.03, at || 0);
      const delayed = start - now > 0.1;
      if (current) stopInstance(current, now, delayed ? Math.min(fade, Math.max(0.15, start - now)) : fade);
      current = null;
      if (!name || !TRACKS[name]) return;
      const tr = Number.isFinite(transpose) ? Math.max(-12, Math.min(12, Math.round(transpose))) : 0;
      current = makeInstance(name, start, delayed ? 0.02 : fade, Math.min(1.5, Math.max(0.5, rate || 1)), section | 0, tr, Number.isFinite(level) ? level : 99);
      scheduleInstance(current, now + LOOKAHEAD);
    },
    stop(fade = 1) {
      if (current) stopInstance(current, ac.currentTime, fade);
      current = null;
    },
    update() { scheduleUntil(ac.currentTime + LOOKAHEAD); },
    scheduleUntil,
  };
}
