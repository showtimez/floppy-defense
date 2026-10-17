import { STRINGS } from '../data/strings.js';

// t('hud.wave', { n: 3 }) -> "WAVE 03". Missing keys fall back to English, then to the key itself.
let lang = 'en';

export function detectLang() {
  const l = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return l.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export function setLang(l) {
  lang = STRINGS[l] ? l : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang() {
  return lang;
}

export function t(key, params) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en?.[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
  return s;
}
