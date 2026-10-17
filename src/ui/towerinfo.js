// Defensive accessors for tower data: works against the real towers module or its stub
// (falls back to the CONTRACTS baseline numbers).
import { PALETTE } from '../config.js';

export const TOWER_TYPES = ['antivirus', 'firewall', 'defrag'];

const FALLBACK = {
  antivirus: { cost: 64, range: 3.0, damage: 12, rate: 1.6, color: PALETTE.antivirus },
  firewall: { cost: 128, range: 2.0, damage: 16, rate: 0.8, color: PALETTE.firewall },
  defrag: { cost: 96, range: 2.4, damage: 0, rate: 1 / 0.6, slow: 0.5, color: PALETTE.defrag },
};

const css = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

export function towerDef(U, type, level = 1) {
  let d = null;
  try { d = U.ctx.towers?.getDef?.(type, level) || null; } catch (e) { d = null; }
  if (!d && level === 1) d = FALLBACK[type] || null;
  return d;
}

export function towerCost(U, type) {
  const d = towerDef(U, type, 1);
  return Math.round(d?.cost ?? FALLBACK[type]?.cost ?? 0);
}

function mixWhite(c, k) {
  const ch = (sh) => {
    const v = (c >> sh) & 255;
    return Math.round(v + (255 - v) * k);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// color: three.js hex; css: same as CSS; light: tint readable as text on black.
export function towerLook(type) {
  const color = PALETTE[type] ?? PALETTE.phosphor;
  return { color, css: css(color), light: css(mixWhite(color, 0.4)) };
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);

// Normalises the many possible field names of a level def into { dmg, rate, range, slow }.
export function towerStats(def, tower) {
  if (!def) return { dmg: undefined, rate: undefined, range: num(tower?.range), slow: undefined };
  const dmg = num(def.damage) ?? num(def.dmg) ?? num(def.dps);
  let rate = num(def.rate) ?? num(def.fireRate) ?? num(def.shotsPerSec) ?? num(def.pulsesPerSec) ?? num(def.rof);
  if (rate === undefined) {
    const period = num(def.cooldown) ?? num(def.interval) ?? num(def.pulseInterval) ?? num(def.pulse) ?? num(def.reload);
    if (period) rate = 1 / period;
  }
  const range = num(tower?.range) ?? num(def.range);
  let slow = num(def.slowMul) ?? num(def.slow) ?? num(def.slowFactor);
  if (slow !== undefined && slow > 1) slow = undefined;
  return { dmg, rate, range, slow };
}

export function fmtStat(v, digits = 1) {
  if (v === undefined || v === null || !isFinite(v)) return '--';
  if (Math.abs(v - Math.round(v)) < 0.05) return String(Math.round(v));
  return v.toFixed(digits);
}
