// Tiny DOM helpers for the UI module (no framework).
import { t, getLang } from '../core/i18n.js';

// h('div', { class: 'x', t: 'menu.start', onclick }, child, 'text', [more])
// `t` sets data-t (i18n key, re-applied by applyI18n on language change); `tp` = JSON-able params for it.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 't') { el.dataset.t = v; el.textContent = t(v); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

// Re-applies every data-t text under root (language switch).
export function applyI18n(root) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-title]')) {
    el.title = t(el.dataset.tTitle);
    el.setAttribute('aria-label', el.title);
  }
}

export const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

export function fmtNum(n) {
  const s = String(Math.round(Math.abs(n || 0)));
  const sep = getLang() === 'it' ? '.' : ',';
  return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Sets textContent only when it changed (avoids layout work every frame).
export function setText(el, s) {
  if (el && el.__txt !== s) { el.__txt = s; el.textContent = s; }
}

export function show(el, on = true) {
  if (!el) return;
  if (on) el.classList.remove('is-hidden');
  else el.classList.add('is-hidden');
}

// Restartable one-shot CSS animation via the Web Animations API (falls back to a class toggle).
export function pulse(el, keyframes, opts) {
  if (!el) return;
  try {
    if (el.animate) { el.animate(keyframes, opts); return; }
  } catch (e) { /* ignore */ }
}

// Inline SVG icons (drawn in code, currentColor).
const SVG = {
  pause: '<rect x="4" y="3" width="3.2" height="10"/><rect x="8.8" y="3" width="3.2" height="10"/>',
  play: '<path d="M4 3 L13 8 L4 13 Z"/>',
  ff: '<path d="M1.5 3.5 L8 8 L1.5 12.5 Z"/><path d="M8 3.5 L14.5 8 L8 12.5 Z"/>',
  sound: '<path d="M2 6 H5 L9 2.5 V13.5 L5 10 H2 Z"/><path d="M11 5 Q13 8 11 11" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12.5 3 Q16 8 12.5 13" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  muted: '<path d="M2 6 H5 L9 2.5 V13.5 L5 10 H2 Z"/><path d="M11 5.5 L15 10.5 M15 5.5 L11 10.5" stroke="currentColor" stroke-width="1.8"/>',
  fs: '<path d="M1.5 6 V1.5 H6 M10 1.5 H14.5 V6 M14.5 10 V14.5 H10 M6 14.5 H1.5 V10" fill="none" stroke="currentColor" stroke-width="2"/>',
  fsExit: '<path d="M6 1.5 V6 H1.5 M14.5 6 H10 V1.5 M10 14.5 V10 H14.5 M1.5 10 H6 V14.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  close: '<path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" stroke-width="2.2"/>',
  warn: '<path d="M8 1 L15.5 14.5 H0.5 Z"/><rect x="7.1" y="5" width="1.8" height="5.2" fill="#000"/><rect x="7.1" y="11.3" width="1.8" height="1.8" fill="#000"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`;
  span.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${SVG[name] || ''}</svg>`;
  return span;
}

export function setIcon(span, name) {
  if (!span || span.__ico === name) return;
  span.__ico = name;
  span.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${SVG[name] || ''}</svg>`;
}
