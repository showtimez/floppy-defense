// Wave director (CONTRACTS §5.5): campaign waves from src/data/waves.json, generated endless waves beyond.
import WAVES from '../data/waves.json';
import { GAME } from '../config.js';
import { ENEMIES, effectiveHp } from '../data/enemies.js';

// Endless tuning (copied per waves instance as waves.tuning so balance probes can try values at runtime).
const ENDLESS = {
  growth: 1.27,      // hp growth per wave past the campaign table (the board is maxed by then: this sets the wall)
  base: 14.5,        // continue-from-victory: wave 20+k = base x growth^k (campaign waves 18-19 are x13-14.2)
  freshGrowth: 1.25, // fresh run (ENDLESS from the menu): waves 1-10 at freshGrowth^(n-1), then x growth per wave
  bossHp: 0.25,      // boss group multiplier (campaign ILOVEYOU: x3.75 wave * x0.62 group); never below the base hp
};
const Y2K_WAVE = 20;             // waves 11-19 count the months down to the millennium bug, then 'Y2K.BUG'
const FRESH_RAMP = 10;           // a fresh endless run ramps at freshGrowth for its first 10 waves, then at growth

// Endless wave names: 'ENDLESS 07' (fresh run, waves 1-10), '04/1999' ... '12/1999', 'Y2K.BUG', 'Y2K+1', ...
function endlessName(n, tableLen) {
  if (n <= tableLen) return `ENDLESS ${String(n).padStart(2, '0')}`;
  if (n < Y2K_WAVE) return `${String(12 - (Y2K_WAVE - 1 - n)).padStart(2, '0')}/1999`;
  if (n === Y2K_WAVE) return 'Y2K.BUG';
  return `Y2K+${n - Y2K_WAVE}`;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normGroup(g) {
  if (!g || !ENEMIES[g.type]) {
    if (g) console.warn('[waves] unknown virus type in wave data:', g.type);
    return null;
  }
  const path = g.path === 'alt' || g.path === 'both' || g.path === 'rand' ? g.path : Math.max(0, Math.floor(Number(g.path) || 0));
  return {
    type: g.type,
    count: Math.max(1, Math.floor(Number(g.count) || 1)),
    interval: Math.max(0.05, Number(g.interval) || 1),
    delay: Math.max(0, Number(g.delay) || 0),
    path,
    hpMul: g.hpMul > 0 ? g.hpMul : 1,
    speedMul: g.speedMul > 0 ? g.speedMul : 1,
    rewardMul: g.rewardMul >= 0 ? g.rewardMul : 1,
  };
}

function normWave(w, n) {
  return {
    wave: n,
    name: (w && w.name) || null,
    bonus: Math.max(0, Math.round(Number(w && w.bonus) || 0)),
    hpMul: w && w.hpMul > 0 ? w.hpMul : 1,
    rewardMul: w && w.rewardMul >= 0 ? w.rewardMul : 1,
    groups: ((w && w.groups) || []).map(normGroup).filter(Boolean),
    endless: false,
  };
}

export function createWaves(ctx) {
  const table = ((WAVES && WAVES.waves) || []).map((w, i) => normWave(w, i + 1));
  const tuning = { ...ENDLESS };
  const total = GAME.TOTAL_WAVES || 10;
  const defCache = new Map();
  const infoCache = new Map();
  const salt = (((ctx.rng && ctx.rng.seed) >>> 0) || 0x5eed) ^ 0x9e3779b9;

  // runtime state
  let current = 0;
  let t = 0;
  let runs = [];
  let allSpawned = true;
  let spawned = 0;
  let toSpawn = 0;
  let waveDef = null;
  const opts = { dist: 0, hpMul: 1, speedMul: 1, rewardMul: 1 };

  const pathCount = () => Math.max(1, (ctx.map && ctx.map.paths && ctx.map.paths.length) || 1);

  // ---------------------------------------------------------------------------------------------
  // Endless generator: deterministic per wave number (info(n) and start(n) agree).
  //  continue-from-victory (game.endlessFresh false): waves past the campaign table only, k = n - table.length;
  //  fresh run from the menu (game.endlessFresh true): every wave, k = n, hp freshGrowth^(n-1) up to wave 10.
  // ---------------------------------------------------------------------------------------------
  function generate(n, fresh = false) {
    const past = Math.max(1, n - table.length);
    const k = fresh ? Math.max(1, n) : past;
    const r = mulberry32((salt ^ Math.imul(n, 2654435761) ^ (fresh ? 0x51f15e : 0)) >>> 0);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    // a fresh run ramps its crowd size up from half-size waves (it starts with 200 KB like the campaign)
    const cnt = fresh ? Math.min(1.8, 0.35 + 0.1 * (n - 1)) : Math.min(1.8, 1 + 0.04 * k);
    const round = (x) => Math.max(1, Math.round(x));
    const patterns = [
      { type: 'worm', make: () => ({ type: 'worm', count: round(9 * cnt + r() * 6), interval: 0.32 + r() * 0.15, path: pick(['both', 'alt']) }) },
      { type: 'trojan', make: () => ({ type: 'trojan', count: round(3 * cnt + r() * 2), interval: 1.5 + r() * 0.8, path: pick(['alt', 'both']) }) },
      { type: 'macro', make: () => ({ type: 'macro', count: round(5 * cnt + r() * 3), interval: 0.75 + r() * 0.35, path: pick(['both', 'alt', 0, 1]) }) },
      { type: 'worm', make: () => ({ type: 'worm', count: round(16 * cnt), interval: 0.2, path: pick([0, 1]) }) },
      { type: 'macro', make: () => ({ type: 'macro', count: round(3 * cnt), interval: 1.2, path: 'both' }) },
    ];
    // the 1999 viruses join from wave 11 of a fresh run (always when continuing past the campaign)
    if (!fresh || n > FRESH_RAMP) {
      patterns.push(
        { type: 'michelangelo', make: () => ({ type: 'michelangelo', count: round(4 * cnt + r() * 3), interval: 0.9 + r() * 0.4, path: pick(['both', 'alt']) }) },
        { type: 'happy99', make: () => ({ type: 'happy99', count: round(5 * cnt + r() * 3), interval: 0.7 + r() * 0.3, path: pick(['both', 'alt']) }) },
        { type: 'cih', make: () => ({ type: 'cih', count: round(2 * cnt + r() * 2), interval: 1.8 + r() * 0.6, path: pick(['alt', 'both']) }) },
      );
    }
    // fresh runs re-introduce the viruses like the campaign: worms, then trojans (wave 3), then macros (wave 4)
    const allowed = !fresh || n >= 4 ? null : (n === 3 ? ['worm', 'trojan'] : ['worm']);
    const pool = allowed ? patterns.filter((p) => allowed.includes(p.type)) : patterns;
    const nGroups = fresh && n <= 2 ? n : 3 + (k > 6 ? 1 : 0) + (fresh && n <= 6 ? 0 : (r() < 0.4 ? 1 : 0));
    const groups = [];
    const used = new Set();
    let delay = 0;
    for (let i = 0; i < nGroups; i++) {
      let pat = pick(pool);
      if (i === nGroups - 1 && used.size < 2) {
        // guarantee a mix: force a type we have not used yet
        const missing = (allowed || ['trojan', 'macro', 'worm']).find((x) => !used.has(x));
        if (missing) pat = pool.find((p) => p.type === missing);
      }
      const g = pat.make();
      if (fresh && n <= 2 && g.path === 'both') g.path = 'alt'; // first fresh waves: one crowd, not one per port
      used.add(g.type);
      g.delay = Math.round(delay * 10) / 10;
      delay += 5 + r() * 4;
      groups.push(g);
    }
    const T = tuning;
    const hpMul = fresh
      ? Math.pow(T.freshGrowth, Math.min(n, FRESH_RAMP) - 1) * Math.pow(T.growth, Math.max(0, n - FRESH_RAMP))
      : T.base * Math.pow(T.growth, past);
    if (n % 5 === 0) {
      const boss = n % 10 === 0 ? 'boss_iloveyou' : 'boss_melissa';
      const p = r() < 0.5 ? 0 : 1;
      const bossHp = Math.max(T.bossHp, 1 / hpMul); // never weaker than the base boss
      groups.push({ type: boss, count: 1, interval: 1, delay: 8, path: p, hpMul: bossHp });
      // from the Y2K wave on, every boss wave brings both bosses (one per port)
      if (n >= Y2K_WAVE) groups.push({ type: boss === 'boss_melissa' ? 'boss_iloveyou' : 'boss_melissa', count: 1, interval: 1, delay: 24, path: 1 - p, hpMul: bossHp });
    }
    const def = normWave({
      name: endlessName(n, FRESH_RAMP),
      bonus: Math.min(120, 60 + 3 * k),
      hpMul,
      rewardMul: Math.min(2, 1 + 0.03 * k),
      groups,
    }, n);
    def.endless = true;
    return def;
  }

  const isFresh = () => !!(ctx.game && ctx.game.endlessFresh);

  function getDef(n) {
    n = Math.floor(n);
    const fresh = isFresh();
    if (!fresh && n >= 1 && n <= table.length) return table[n - 1];
    const key = (fresh ? 'f' : 'c') + n;
    let d = defCache.get(key);
    if (!d) {
      d = generate(n, fresh);
      defCache.set(key, d);
    }
    return d;
  }

  function waveEhp(def) {
    const np = pathCount();
    let hp = 0;
    for (const g of def.groups) hp += g.count * (g.path === 'both' ? np : 1) * effectiveHp(g.type) * g.hpMul * def.hpMul;
    return hp;
  }

  let ehpRef = 0;
  function refEhp() {
    if (!ehpRef) ehpRef = Math.max(1, ...table.map(waveEhp), 1);
    return ehpRef;
  }

  function info(n) {
    n = Math.floor(Number(n));
    if (!(n >= 1)) return null;
    const ikey = (isFresh() ? 'f' : 'c') + n;
    let inf = infoCache.get(ikey);
    if (inf) return inf;
    const def = getDef(n);
    const np = pathCount();
    const agg = new Map();
    let boss = null;
    for (const g of def.groups) {
      const c = g.count * (g.path === 'both' ? np : 1);
      agg.set(g.type, (agg.get(g.type) || 0) + c);
      if (!boss && ENEMIES[g.type].boss) boss = g.type;
    }
    const groups = [...agg].map(([type, count]) => ({ type, count, name: ENEMIES[type].name, isBoss: !!ENEMIES[type].boss }));
    inf = {
      wave: n,
      isBoss: !!boss,
      bossName: boss ? ENEMIES[boss].name : null,
      bossType: boss,
      bonus: def.bonus,
      groups,
      threat: Math.min(1, Math.sqrt(waveEhp(def) / refEhp())),
      // extras
      name: def.name,
      endless: def.endless,
      hpMul: def.hpMul,
      total: groups.reduce((a, g) => a + g.count, 0),
    };
    infoCache.set(ikey, inf);
    return inf;
  }

  // ---------------------------------------------------------------------------------------------
  function start(n) {
    current = Math.max(1, Math.floor(Number(n) || 1));
    waveDef = getDef(current);
    t = 0;
    spawned = 0;
    const np = pathCount();
    runs = waveDef.groups.map((g) => ({ g, i: 0, next: g.delay }));
    toSpawn = waveDef.groups.reduce((a, g) => a + g.count * (g.path === 'both' ? np : 1), 0);
    allSpawned = runs.length === 0;
  }

  function spawnOne(g, i) {
    const en = ctx.enemies;
    if (!en || typeof en.spawn !== 'function') return;
    const np = pathCount();
    opts.hpMul = g.hpMul * waveDef.hpMul;
    opts.speedMul = g.speedMul;
    opts.rewardMul = g.rewardMul * waveDef.rewardMul;
    if (g.path === 'both') {
      for (let p = 0; p < np; p++) { en.spawn(g.type, p, opts); spawned++; }
      return;
    }
    let p;
    if (g.path === 'alt') p = i % np;
    else if (g.path === 'rand') p = Math.floor((ctx.rng ? ctx.rng.next() : Math.random()) * np);
    else p = g.path % np;
    en.spawn(g.type, p, opts);
    spawned++;
  }

  function update(dt) {
    if (allSpawned || !waveDef) return;
    t += dt;
    let pending = false;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      const g = r.g;
      let guard = 0;
      while (r.i < g.count && t >= r.next && guard++ < 64) {
        spawnOne(g, r.i);
        r.i++;
        r.next += g.interval;
      }
      if (r.i < g.count) pending = true;
    }
    if (!pending) allSpawned = true;
  }

  function isDone() {
    if (!allSpawned) return false;
    const en = ctx.enemies;
    const alive = en && typeof en.aliveCount === 'function' ? en.aliveCount() : 0;
    return !alive;
  }

  function reset() {
    current = 0;
    t = 0;
    runs = [];
    waveDef = null;
    allSpawned = true;
    spawned = 0;
    toSpawn = 0;
    infoCache.clear();
    defCache.clear();
  }

  return {
    total,
    info,
    start,
    update,
    isDone,
    reset,
    // extras (UI / debug)
    get current() { return current; },
    get elapsed() { return t; },
    progress: () => ({ spawned, total: toSpawn, allSpawned }),
    def: getDef,
    tuning,
  };
}
