// Offline audio self-test (not imported by the game). In a dev page:
//   const t = await import('/src/audio/selftest.js'); await t.selfTest()
// Renders every SFX variant (pure JS DSP) and a few seconds of every music track through an OfflineAudioContext,
// and reports duration, render time, peak, loudest-50ms RMS, overall RMS (dBFS) and NaN counts.
import { SFX, SFX_NAMES, renderSfx } from './sfx.js';
import { createMusic } from './music.js';
import { TRACKS } from './tracks.js';

// schedule like real time: suspend the offline context every 0.2 s and look 0.3 s ahead (onended fires, voices free)
export async function renderTrack(name, seconds, sr, gain = 1) {
  const oc = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const g = oc.createGain();
  g.gain.value = gain;
  g.connect(oc.destination);
  const m = createMusic(oc, g);
  m.play(name, { at: 0, fade: 0.01 });
  m.scheduleUntil(0.3);
  let maxVoices = 0;
  for (let t = 0.2; t < seconds; t += 0.2) {
    oc.suspend(t).then(() => { m.scheduleUntil(t + 0.3); maxVoices = Math.max(maxVoices, m.voices); oc.resume(); });
  }
  const buf = await oc.startRendering();
  return { buf, maxVoices };
}

const db = (v) => Math.round(20 * Math.log10(Math.max(1e-9, v)) * 10) / 10;

function stats(chans, sr) {
  let pk = 0, sum = 0, nan = 0, n = 0, best = 0;
  const w = Math.floor(sr * 0.05);
  for (const a of chans) {
    let acc = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!(v === v)) { nan++; continue; }
      const av = Math.abs(v);
      if (av > pk) pk = av;
      sum += v * v; n++;
      acc += v * v;
      if (i >= w) acc -= a[i - w] * a[i - w];
      if (i >= w) best = Math.max(best, acc / w);
    }
  }
  return { peak: db(pk), loud50: db(Math.sqrt(best)), rms: db(Math.sqrt(sum / Math.max(1, n))), nan };
}

export async function selfTest({ sr = 32000, seconds = 8, musicGain = 0.55 * 0.62, sfxGain = 0.8, tracks = Object.keys(TRACKS), skipSfx = false } = {}) {
  const out = { sfx: {}, music: {}, totalSfxMs: 0 };
  if (!skipSfx) {
    for (const name of SFX_NAMES) {
      const vs = [];
      for (let v = 0; v < SFX[name].v; v++) {
        const r = renderSfx(name, sr, v);
        const s = stats(r.R ? [r.L, r.R] : [r.L], sr);
        out.totalSfxMs += r.ms;
        vs.push({ dur: Math.round(r.L.length / sr * 1000) / 1000, ms: Math.round(r.ms * 10) / 10, ...s, atBus: db(Math.pow(10, s.loud50 / 20) * sfxGain) });
      }
      out.sfx[name] = vs.length === 1 ? vs[0] : vs;
    }
  }
  for (const tr of tracks) {
    const t0 = performance.now();
    const { buf, maxVoices } = await renderTrack(tr, seconds, 44100, musicGain);
    const s = stats([buf.getChannelData(0), buf.getChannelData(1)], 44100);
    out.music[tr] = { ...s, maxVoices, ms: Math.round(performance.now() - t0) };
  }
  out.totalSfxMs = Math.round(out.totalSfxMs);
  return out;
}

// render one SFX (or a music snippet) to a WAV blob URL for listening in a browser tab
export function wavUrl(chans, sr) {
  const n = chans[0].length, ch = chans.length, buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s * 32767, true); o += 2; }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// draw offline-rendered music tracks as stacked waveform + log-frequency spectrograms on a full-page canvas
export async function drawTracks(names = Object.keys(TRACKS), seconds = 10, sr = 22050) {
  const W = window.innerWidth, rowH = Math.floor(window.innerHeight / names.length);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = rowH * names.length;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  const img = g.createImageData(W, cv.height);
  const N = 1024, re = new Float64Array(N), im = new Float64Array(N);
  const fft = () => {
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), h = i + k + len / 2; const vr = re[h] * c - im[h] * s, vi = re[h] * s + im[h] * c; re[h] = re[i + k] - vr; im[h] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi; } }
  };
  for (let r = 0; r < names.length; r++) {
    const { buf: b } = await renderTrack(names[r], seconds, sr, 1);
    const L = b.getChannelData(0), R = b.getChannelData(1), n = L.length;
    const y0 = r * rowH, hw = 24, hs = rowH - hw - 4;
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(x / W * n), i1 = Math.floor((x + 1) / W * n);
      let mx = 0;
      for (let i = i0; i < i1; i++) mx = Math.max(mx, Math.abs(L[i] + R[i]) * 0.5);
      for (let y = 0; y < hw; y++) if (hw - y < mx * hw * 1.6) { const p = ((y0 + y) * W + x) * 4; img.data[p] = 80; img.data[p + 1] = 220; img.data[p + 2] = 120; img.data[p + 3] = 255; }
      const c = Math.floor(x / W * n) - N / 2;
      for (let i = 0; i < N; i++) { const k = c + i; re[i] = (k >= 0 && k < n ? (L[k] + R[k]) * 0.5 : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
      fft();
      for (let y = 0; y < hs; y++) {
        const f = 40 * Math.pow(10000 / 40, 1 - y / hs), bin = Math.round(f / sr * N);
        const v = Math.max(0, Math.min(1, (20 * Math.log10(Math.hypot(re[bin], im[bin]) + 1e-9) + 30) / 50));
        const p = ((y0 + hw + y) * W + x) * 4;
        img.data[p] = 255 * Math.min(1, v * 2); img.data[p + 1] = 255 * Math.max(0, v * 2 - 1); img.data[p + 2] = 90 * (1 - v); img.data[p + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#ff8'; g.font = '12px monospace';
  names.forEach((nm, r) => g.fillText(`${nm} (${seconds}s)`, 4, r * rowH + 12));
  return true;
}
