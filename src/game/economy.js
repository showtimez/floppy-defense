// KB economy (CONTRACTS §5.7). game.kb is written ONLY here.
// Income: kills, wave-clear bonus, "interest" on saved KB at wave clear, early-call bonus, CACHE HIT kill chains.
// Spending: towers/upgrades.
import { GAME } from '../config.js';
import { t } from '../core/i18n.js';

export const INTEREST_RATE = 0.05; // 5 % of current KB on every cleared wave...
export const INTEREST_MAX = 25;    // ...capped (reached at 500 KB)
// CACHE HIT: kills at most WINDOW sim seconds apart and within RADIUS of each other chain; a chain of n >= MIN kills
// pays n - 2 KB when it ends ("CACHE HIT x5 +3KB").
export const COMBO = { WINDOW: 0.6, MIN: 3, RADIUS: 2.5, SLOTS: 6, COLOR: '#ffb000', RISE: 0.9 };
const NO_EARNED_STAT = new Set(['sell', 'debug', 'reset']);

export function createEconomy(ctx) {
  const { game, events } = ctx;
  const stepHooks = new Set();
  const V3 = ctx.THREE && ctx.THREE.Vector3;
  const vec = () => (V3 ? new V3() : { x: 0, y: 0, z: 0 });
  // CACHE HIT chains are local: a kill joins the running chain whose centre is within COMBO.RADIUS, so a firewall
  // burst at a chokepoint chains while unrelated kills across the board don't. Small fixed pool, no allocations.
  const chains = [];
  for (let i = 0; i < COMBO.SLOTS; i++) chains.push({ n: 0, t: 0, sx: 0, sy: 0, sz: 0 });
  const comboPos = vec(); // chain centre (reused: read the 'combo' payload immediately)
  const textPos = vec();

  const stats = () => game.stats || (game.stats = {});
  const toInt = (n) => (Number.isFinite(n) ? Math.round(n) : 0);

  function emit(delta, reason) {
    events.emit('kb:change', { kb: game.kb, delta, reason });
  }

  function comboLabel(n, kb) {
    const s = t('fx.combo', { n, kb });
    return s && s !== 'fx.combo' ? s : `CACHE HIT x${n} +${kb}KB`;
  }

  // Pays a finished kill chain (if long enough) and frees its slot.
  function flushChain(c) {
    const n = c.n;
    c.n = 0;
    if (n < COMBO.MIN || !playing()) return;
    const kb = economy.earn(n - 2, 'combo');
    const s = stats();
    s.combos = (s.combos || 0) + 1;
    if (n > (s.bestCombo || 0)) s.bestCombo = n;
    comboPos.x = c.sx / n; comboPos.y = c.sy / n; comboPos.z = c.sz / n;
    events.emit('combo', { n, kb, pos: comboPos });
    const fx = ctx.fx;
    if (fx && typeof fx.text === 'function') {
      textPos.x = comboPos.x; textPos.y = comboPos.y + COMBO.RISE; textPos.z = comboPos.z;
      try { fx.text(textPos, comboLabel(n, kb), COMBO.COLOR, { size: 0.6, life: 1.3, rise: 1.0 }); } catch (err) { /* stub */ }
    }
  }

  function flushExpired(now, all = false) {
    for (const c of chains) if (c.n > 0 && (all || now - c.t > COMBO.WINDOW)) flushChain(c);
  }

  function chainKill(enemy) {
    const now = game.time || 0;
    flushExpired(now);
    const p = enemy && enemy.pos;
    const x = (p && p.x) || 0;
    const y = (p && p.y) || 0;
    const z = (p && p.z) || 0;
    let best = null;
    let bestD = COMBO.RADIUS * COMBO.RADIUS;
    let free = null;
    let oldest = chains[0];
    for (const c of chains) {
      if (c.n === 0) { if (!free) free = c; continue; }
      if (c.t < oldest.t || oldest.n === 0) oldest = c;
      const dx = c.sx / c.n - x;
      const dz = c.sz / c.n - z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) { bestD = d; best = c; }
    }
    if (!best) {
      best = free;
      if (!best) { flushChain(oldest); best = oldest; }
      best.sx = 0; best.sy = 0; best.sz = 0;
    }
    best.n++;
    best.t = now;
    best.sx += x; best.sy += y; best.sz += z;
  }

  const economy = {
    lastInterest: 0,   // KB paid as interest on the last cleared wave (UI banner)
    lastBonus: 0,      // wave-clear bonus of the last cleared wave
    lastEarly: 0,      // early-call bonus of the last wave start

    get kb() { return game.kb; },

    canAfford(n) {
      return Number.isFinite(n) && game.kb >= n;
    },

    spend(n, reason = 'spend') {
      const v = toInt(n);
      if (v < 0 || game.kb < v) return false;
      if (v === 0) return true;
      game.kb -= v;
      const s = stats();
      s.kbSpent = (s.kbSpent || 0) + v;
      emit(-v, reason);
      return true;
    },

    earn(n, reason = 'kill') {
      const v = toInt(n);
      if (v <= 0) return 0;
      game.kb += v;
      if (!NO_EARNED_STAT.has(reason)) {
        const s = stats();
        s.kbEarned = (s.kbEarned || 0) + v;
      }
      emit(v, reason);
      return v;
    },

    // Interest the player would get right now (UI preview: "interest +12KB").
    interestFor(kb = game.kb) {
      return Math.max(0, Math.min(INTEREST_MAX, Math.floor(kb * INTEREST_RATE)));
    },

    // Systems hook: fn(dt) runs once per simulation step (after towers/projectiles). Used by the autoplay bot so it
    // acts on sim time (deterministic with ?seed) instead of wall-clock frames. Returns an unsubscribe function.
    onStep(fn) {
      stepHooks.add(fn);
      return () => stepHooks.delete(fn);
    },

    // Longest running CACHE HIT chain (UI/tests).
    get chain() { let m = 0; for (const c of chains) if (c.n > m) m = c.n; return m; },

    update(dt) {
      flushExpired(game.time || 0);
      if (!stepHooks.size) return;
      for (const fn of stepHooks) {
        try { fn(dt); } catch (err) { console.error('[economy] step hook failed', err); }
      }
    },

    reset() {
      const before = game.kb;
      game.kb = GAME.START_KB;
      economy.lastInterest = 0;
      economy.lastBonus = 0;
      economy.lastEarly = 0;
      for (const c of chains) c.n = 0;
      emit(game.kb - (Number.isFinite(before) ? before : game.kb), 'reset');
    },
  };

  function playing() {
    return game.phase === 'prep' || game.phase === 'wave' || game.phase === 'paused';
  }

  events.on('enemy:killed', ({ enemy, reward } = {}) => {
    if (!playing()) return;
    economy.earn(reward ?? (enemy && enemy.reward) ?? 0, 'kill');
    chainKill(enemy);
  });

  events.on('wave:cleared', ({ bonus } = {}) => {
    flushExpired(game.time || 0, true); // the wave's last chains pay out with the clear (and count for interest)
    economy.lastBonus = economy.earn(bonus || 0, 'wave');
    economy.lastInterest = economy.earn(economy.interestFor(game.kb), 'interest');
  });

  events.on('wave:start', ({ earlySeconds } = {}) => {
    const v = Math.floor((earlySeconds || 0) * GAME.EARLY_CALL_KB_PER_SEC);
    economy.lastEarly = v > 0 ? economy.earn(v, 'early') : 0;
  });

  return economy;
}
