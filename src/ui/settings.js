// Settings panel (shared by the main menu and the pause overlay). Changes go out as cmd:setting.
import { t } from '../core/i18n.js';
import { h, setText } from './dom.js';

const ROWS = [
  { key: 'muted', label: 'set.sound', type: 'toggle', invert: true },
  { key: 'musicVolume', label: 'set.music', type: 'slider' },
  { key: 'sfxVolume', label: 'set.sfx', type: 'slider' },
  { key: 'lang', label: 'set.lang', type: 'choice', options: ['en', 'it'], names: { en: 'set.en', it: 'set.it' } },
  { key: 'crt', label: 'set.crt', type: 'toggle' },
  { key: 'quality', label: 'set.quality', type: 'choice', options: ['auto', 'high', 'low'], names: { auto: 'set.auto', high: 'set.high', low: 'set.low' } },
];

export function createSettingsPanel(U) {
  const s = U.settings;
  let focus = 0;
  const rows = [];

  const el = h('div', { class: 'set-panel' });

  ROWS.forEach((def, i) => {
    const label = h('span', { class: 'set-label' });
    const dec = h('button', { class: 'ui-hit set-arrow', tabindex: '-1', 'aria-label': '-' }, '◄');
    const inc = h('button', { class: 'ui-hit set-arrow', tabindex: '-1', 'aria-label': '+' }, '►');
    const val = h('span', { class: 'set-val ui-hit' });
    const row = h('div', { class: 'set-row ui-hit', 'data-i': String(i) }, h('span', { class: 'mi-cursor' }, '►'), label,
      h('span', { class: 'set-ctl' }, dec, val, inc));
    dec.addEventListener('click', (e) => { e.stopPropagation(); setFocus(i); change(def, -1); });
    inc.addEventListener('click', (e) => { e.stopPropagation(); setFocus(i); change(def, +1); });
    val.addEventListener('click', (e) => {
      e.stopPropagation();
      setFocus(i);
      if (def.type === 'slider') {
        const r = val.getBoundingClientRect();
        const k = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
        emit(def.key, Math.round(k * 10) / 10);
      } else change(def, +1);
    });
    row.addEventListener('click', () => { setFocus(i); if (def.type !== 'slider') change(def, +1); });
    row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setFocus(i, true); });
    rows.push({ def, row, label, val });
    el.append(row);
  });

  function emit(key, value) {
    U.sfx('click');
    U.emit('cmd:setting', { key, value });
  }

  function change(def, dir) {
    if (def.type === 'toggle') emit(def.key, !s[def.key]);
    else if (def.type === 'slider') {
      const v = Math.round(Math.max(0, Math.min(1, (Number(s[def.key]) || 0) + dir * 0.1)) * 10) / 10;
      emit(def.key, v);
    } else {
      const opts = def.options;
      const i = Math.max(0, opts.indexOf(s[def.key]));
      emit(def.key, opts[(i + dir + opts.length) % opts.length]);
    }
  }

  function valueText(def) {
    const v = s[def.key];
    if (def.type === 'toggle') {
      const on = def.invert ? !v : !!v;
      return on ? `[${t('set.on')}]` : `[${t('set.off')}]`;
    }
    if (def.type === 'slider') {
      const n = Math.round((Number(v) || 0) * 10);
      return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${String(n * 10).padStart(3, ' ')}%`;
    }
    return t(def.names[v] || def.names[def.options[0]]);
  }

  function setFocus(i, quiet) {
    const n = Math.max(0, Math.min(rows.length - 1, i));
    if (n !== focus && !quiet) U.sfx('hover');
    else if (n !== focus && quiet) U.sfx('hover', { volume: 0.5 });
    focus = n;
    rows.forEach((r, k) => r.row.classList.toggle('is-focus', k === focus));
  }

  function refresh() {
    for (const r of rows) {
      setText(r.label, t(r.def.label));
      setText(r.val, valueText(r.def));
      r.row.classList.toggle('is-off', r.def.type === 'toggle' && (r.def.invert ? !!s[r.def.key] : !s[r.def.key]));
      r.row.classList.toggle('is-slider', r.def.type === 'slider');
    }
    rows.forEach((r, k) => r.row.classList.toggle('is-focus', k === focus));
  }

  // Returns true when the key was consumed.
  function onKey(e) {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { setFocus((focus - 1 + rows.length) % rows.length); return true; }
    if (k === 'ArrowDown' || k === 's' || k === 'S') { setFocus((focus + 1) % rows.length); return true; }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { change(rows[focus].def, -1); return true; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { change(rows[focus].def, +1); return true; }
    if (k === 'Enter' || k === ' ') { change(rows[focus].def, +1); return true; }
    return false;
  }

  refresh();
  return { el, refresh, onKey, setFocus, get focus() { return focus; } };
}
