// Renders the SFX bank off the main thread (pure DSP, no WebAudio) and transfers the Float32Arrays back.
import { renderSfx } from './sfx.js';
import { renderKit, KIT_SR } from './instruments.js';

self.onmessage = (e) => {
  const { sr, list, kit } = e.data || {};
  if (kit) {
    try {
      const K = renderKit(KIT_SR);
      self.postMessage({ kit: K }, Object.values(K).map((a) => a.buffer));
    } catch (err) {
      self.postMessage({ kitError: String(err && err.message) });
    }
  }
  if (!list) return;
  for (const [name, v] of list) {
    try {
      const r = renderSfx(name, sr, v);
      if (!r) continue;
      const tr = r.R ? [r.L.buffer, r.R.buffer] : [r.L.buffer];
      self.postMessage({ name, v, L: r.L, R: r.R, ms: r.ms }, tr);
    } catch (err) {
      self.postMessage({ name, v, error: String(err && err.message) });
    }
  }
  self.postMessage({ done: true });
};
