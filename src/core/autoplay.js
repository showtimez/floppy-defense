// Autoplay bot for automated playtests and balance runs (?autoplay=1 | greedy | idle).
// It plays through the public command events (cmd:build, cmd:upgrade, fan:click, cmd:nextWave) exactly like the UI,
// so a bot run exercises the real game flow. Decisions run on simulation time (economy.onStep), which keeps runs
// reproducible with ?seed=N as long as gameplay modules only use ctx.rng.

const TICK = 0.2;            // sim seconds between decisions
const SAMPLE_STEP = 0.25;    // path sampling resolution for slot coverage
const MIN_PREP = 1.5;        // sim seconds the bot spends in prep before it may call the wave early
const SAVE_MARGIN = 40;      // KB: wait for a better option if it is at most this far away
const OPENING = 3;           // first floppies are always antivirus (3 x 64 KB fits the 200 KB start)
const EARLY_BIAS = 0.65;     // coverage of the last stretch of a path is worth this much less than the front
const TYPES = ['antivirus', 'firewall', 'defrag'];
const FALLBACK = {
  antivirus: { cost: 64, range: 3.0 },
  firewall: { cost: 128, range: 2.0 },
  defrag: { cost: 96, range: 2.4 },
};
// Rough value multipliers per floppy (AoE and slow are worth more than raw path coverage says).
const EFFICACY = { antivirus: 1.0, firewall: 2.4, defrag: 1.5 };
const MIX = { antivirus: 0.45, firewall: 0.3, defrag: 0.25 };
const SHORT = { antivirus: 'A', firewall: 'F', defrag: 'D' };

export function startAutoplay(ctx) {
  if (ctx.autoplay) return ctx.autoplay;
  const { events, game } = ctx;
  const params = ctx.params || new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const raw = String(params.get('autoplay') || '1').toLowerCase();
  const mode = raw === 'greedy' ? 'greedy' : raw === 'idle' ? 'idle' : 'normal';
  const gameMode = params.get('mode') === 'endless' ? 'endless' : 'campaign';
  const quiet = params.has('quiet');

  const log = [];
  ctx.autoplayLog = log;
  ctx.autoplayResult = null;

  let acc = 0;
  let stopped = false;
  let prepStart = 0;
  let waveLeaks = 0;
  let waveKills = 0;
  let lastFlowCmd = 0;
  let coverage = null;       // Map slotId -> { antivirus: idx[], firewall: idx[], defrag: idx[] }
  let samples = 0;           // number of path samples
  let dmgCover = null;       // Int16Array per sample: damage towers covering it
  let weight = null;         // Float32Array per sample: how valuable covering it is (front of the path = 1)
  let towerSig = '';
  let cooling = null;        // heat.active entry the bot is clicking down (until it is gone)
  const blacklist = new Set(); // slot ids the towers module refused (invalid)

  // ------------------------------------------------------------------------------------------
  // Data helpers (defensive: towers/map may be stubs)
  // ------------------------------------------------------------------------------------------
  function def(type, level = 1) {
    let d = null;
    try { d = ctx.towers.getDef(type, level); } catch (err) { d = null; }
    const f = FALLBACK[type];
    return {
      cost: d && Number.isFinite(d.cost) ? d.cost : f.cost,
      range: d && Number.isFinite(d.range) ? d.range : f.range,
    };
  }

  function upgradeCost(tower) {
    try { const c = ctx.towers.upgradeCost(tower); return Number.isFinite(c) ? c : null; } catch (err) { return null; }
  }

  function computeCoverage() {
    const map = ctx.map;
    const slots = (map && map.slots) || [];
    const paths = (map && map.paths) || [];
    const pts = [];
    const wts = [];
    const v = new ctx.THREE.Vector3();
    paths.forEach((p, i) => {
      const len = p.length || 0;
      for (let d = 0; d <= len; d += SAMPLE_STEP) {
        let ok = false;
        try { ok = !!map.samplePath(i, d, v); } catch (err) { ok = false; }
        if (!ok) break;
        pts.push(v.x, v.z);
        // A decent player defends early: the front of the path sees every virus, the last stretch only leakers.
        const f = len > 0 ? d / len : 0;
        wts.push(1 - EARLY_BIAS * Math.max(0, (f - 0.3) / 0.7));
      }
    });
    samples = pts.length / 2;
    weight = Float32Array.from(wts);
    coverage = new Map();
    const ranges = {};
    for (const t of TYPES) ranges[t] = def(t).range;
    for (const s of slots) {
      if (!s || !s.pos) continue;
      const entry = {};
      for (const t of TYPES) {
        const r2 = ranges[t] * ranges[t];
        const idx = [];
        for (let k = 0; k < samples; k++) {
          const dx = pts[k * 2] - s.pos.x;
          const dz = pts[k * 2 + 1] - s.pos.z;
          if (dx * dx + dz * dz <= r2) idx.push(k);
        }
        entry[t] = idx;
      }
      coverage.set(s.id, entry);
    }
    dmgCover = new Int16Array(samples);
    towerSig = '';
  }

  function refreshDamageCover(towers) {
    let sig = '';
    for (const t of towers) sig += `${t.id}:${t.level};`;
    if (sig === towerSig) return;
    towerSig = sig;
    dmgCover.fill(0);
    for (const t of towers) {
      if (t.type === 'defrag' || !t.slot) continue;
      const c = coverage.get(t.slot.id);
      if (!c) continue;
      for (const k of c[t.type] || c.antivirus) dmgCover[k]++;
    }
  }

  // Path length (units) a floppy of `type` on `slot` would cover; defrag only counts samples covered by damage.
  function slotScore(slot, type) {
    const c = coverage.get(slot.id);
    if (!c) return 0;
    const idx = c[type];
    let s = 0;
    if (type !== 'defrag') {
      for (const k of idx) s += weight[k];
      return s * SAMPLE_STEP;
    }
    for (const k of idx) s += (dmgCover[k] > 0 ? 1 + Math.min(2, dmgCover[k] - 1) * 0.35 : 0.15) * weight[k];
    return s * SAMPLE_STEP;
  }

  // ------------------------------------------------------------------------------------------
  // Strategy
  // ------------------------------------------------------------------------------------------
  function candidates() {
    const towers = ctx.towers.list || [];
    const slots = ctx.map.slots || [];
    refreshDamageCover(towers);
    const counts = { antivirus: 0, firewall: 0, defrag: 0 };
    for (const t of towers) if (counts[t.type] !== undefined) counts[t.type]++;
    const n = towers.length;
    const damageTowers = counts.antivirus + counts.firewall;
    const out = [];

    const allowed = mode === 'greedy' ? ['antivirus'] : TYPES;
    for (const type of allowed) {
      if (mode === 'normal') {
        if (type !== 'antivirus' && n < OPENING) continue;   // opening: antivirus only
        if (type === 'defrag' && damageTowers < OPENING) continue;
      }
      let best = null;
      let bestScore = 0;
      for (const s of slots) {
        if (!s || s.tower || blacklist.has(s.id)) continue;
        const sc = slotScore(s, type);
        if (sc > bestScore) { bestScore = sc; best = s; }
      }
      if (!best) continue;
      if (type === 'firewall' && bestScore < 3) continue; // only at real chokepoints
      const cost = def(type).cost;
      // Steer toward the 50/25/25 mix once every type is allowed (before that: plain antivirus spam).
      let mix = 1;
      if (mode === 'normal' && n >= OPENING) mix = Math.max(0.35, Math.min(2.2, 1 + 2.4 * (MIX[type] - counts[type] / n)));
      out.push({ kind: 'build', type, slot: best, cost, value: (EFFICACY[type] * bestScore * mix) / cost });
    }

    for (const t of towers) {
      if (mode === 'greedy' && t.type !== 'antivirus') continue;
      const cost = upgradeCost(t);
      if (cost == null || cost <= 0 || !t.slot) continue;
      const cov = slotScore(t.slot, t.type) || 1;
      const lvl = t.level || 1;
      const gain = 0.45 * Math.pow(1.45, lvl - 1);
      out.push({ kind: 'upgrade', tower: t, cost, value: (EFFICACY[t.type] * cov * gain) / cost });
    }
    out.sort((a, b) => b.value - a.value);
    return out;
  }

  function choose() {
    const list = candidates();
    if (!list.length) return { action: null, waiting: false };
    const kb = game.kb;
    const top = list[0];
    if (top.cost <= kb) return { action: top, waiting: false };
    // Saving up for the best option?
    if (top.cost - kb <= SAVE_MARGIN) return { action: null, waiting: true };
    const alt = list.find((c) => c.cost <= kb && c.value >= top.value * 0.55);
    return alt ? { action: alt, waiting: false } : { action: null, waiting: true };
  }

  function execute(c) {
    if (c.kind === 'build') {
      let check = { ok: true };
      try { check = ctx.towers.canPlace(c.type, c.slot) || { ok: false, reason: 'invalid' }; } catch (err) { check = { ok: false, reason: 'invalid' }; }
      if (!check.ok) {
        if (check.reason !== 'kb') blacklist.add(c.slot.id);
        return false;
      }
      events.emit('cmd:build', { type: c.type, slotId: c.slot.id });
      if (!c.slot.tower) { blacklist.add(c.slot.id); return false; }
      return true;
    }
    const before = c.tower.level;
    events.emit('cmd:upgrade', { towerId: c.tower.id });
    const ok = c.tower.level !== before;
    if (game.selected) events.emit('select:none', {});
    return ok;
  }

  // Click the fan like an attentive human: from the 50 % warning (or right away before calling a wave early) keep
  // clicking every decision tick until the spot is fully cooled (4 clicks clear a full overheat). The bot never
  // uses OVERCLOCK, so balance runs measure the base game.
  function coolFan(force = false) {
    const h = ctx.heat && ctx.heat.active;
    if (!h) { cooling = null; return false; }
    if (cooling !== h && (force || h.overheated || h.level >= 0.45)) cooling = h;
    if (cooling !== h) return false;
    events.emit('fan:click', {});
    return true;
  }

  function tick() {
    const phase = game.phase;
    if (phase !== 'prep' && phase !== 'wave') return;
    if (mode === 'idle') {
      if (phase === 'prep' && game.time - prepStart >= 0.5) events.emit('cmd:nextWave', {});
      return;
    }
    if (!coverage) computeCoverage();
    const clicked = coolFan();
    let acted = 0;
    while (acted < 3) {
      const r = choose();
      if (!r.action) break;
      if (!execute(r.action)) break;
      acted++;
    }
    // Nothing (affordable) left to do in prep: cool the board, then call the wave early for bonus KB.
    if (phase === 'prep' && !acted && game.time - prepStart >= MIN_PREP) {
      if (ctx.heat && ctx.heat.active) { if (!clicked) coolFan(true); }
      else events.emit('cmd:nextWave', {});
    }
  }

  // ------------------------------------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------------------------------------
  function towerSummary() {
    const towers = ctx.towers.list || [];
    const c = { antivirus: 0, firewall: 0, defrag: 0 };
    let levels = 0;
    for (const t of towers) { if (c[t.type] !== undefined) c[t.type]++; levels += t.level || 1; }
    return { count: towers.length, mix: TYPES.map((t) => `${SHORT[t]}${c[t]}`).join(' '), levels };
  }

  function record(extra = {}) {
    const ts = towerSummary();
    const row = {
      wave: game.wave,
      cpu: Math.round(game.cpu),
      kb: Math.round(game.kb),
      towers: ts.count,
      leaks: waveLeaks,
      time: Math.round(game.time),
      kills: waveKills,
      mix: ts.mix,
      levels: ts.levels,
      ...extra,
    };
    log.push(row);
    if (!quiet) {
      console.info(`[autoplay:${mode}] wave ${String(row.wave).padStart(2, '0')} cpu ${row.cpu}% kb ${row.kb} towers ${row.towers} (${row.mix}, lv ${row.levels}) leaks ${row.leaks} kills ${row.kills} t=${row.time}s${extra.result ? ` -> ${extra.result}` : ''}`);
    }
    return row;
  }

  const offs = [];
  const on = (name, fn) => offs.push(events.on(name, fn));
  on('game:new', () => { coverage = null; cooling = null; blacklist.clear(); log.length = 0; ctx.autoplayResult = null; });
  on('wave:prep', () => { prepStart = game.time; });
  on('wave:start', () => { waveLeaks = 0; waveKills = 0; });
  on('enemy:leak', () => { waveLeaks++; });
  on('enemy:killed', () => { waveKills++; });
  on('tower:sold', () => { towerSig = ''; });
  on('wave:cleared', ({ perfect }) => record({ perfect: !!perfect }));
  const finish = (result) => (p = {}) => {
    const row = result === 'gameover' ? record({ result: 'BSOD' }) : log[log.length - 1];
    ctx.autoplayResult = {
      result, mode, wave: game.wave, cpu: Math.round(game.cpu), kb: Math.round(game.kb), score: p.score ?? null,
      time: Math.round(game.time), stats: { ...(game.stats || {}) }, seed: ctx.rng && ctx.rng.seed, last: row || null,
    };
    if (!quiet) console.info(`[autoplay:${mode}] ${result.toUpperCase()} at wave ${game.wave} score ${p.score ?? '?'}`, ctx.autoplayResult);
  };
  on('victory', finish('victory'));
  on('gameover', finish('gameover'));

  // ------------------------------------------------------------------------------------------
  // Drivers: sim-step hook for gameplay decisions, wall-clock timer for menus / pauses.
  // ------------------------------------------------------------------------------------------
  const stepFn = (dt) => {
    if (stopped) return;
    acc += dt;
    if (acc < TICK) return;
    acc = 0;
    tick();
  };
  let offStep = null;
  if (ctx.economy && typeof ctx.economy.onStep === 'function') {
    offStep = ctx.economy.onStep(stepFn);
  } else {
    // Fallback: per-frame ticking on game.time.
    let lastT = 0;
    const raf = () => {
      if (stopped) return;
      requestAnimationFrame(raf);
      const t = game.time || 0;
      if (t < lastT) lastT = t;
      if (t - lastT >= TICK) { lastT = t; tick(); }
    };
    requestAnimationFrame(raf);
  }

  const flowTimer = setInterval(() => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastFlowCmd < 600) return;
    const phase = game.phase;
    if (phase === 'boot') { lastFlowCmd = now; events.emit('cmd:menu', {}); }
    else if (phase === 'menu') { lastFlowCmd = now; events.emit('cmd:newGame', { mode: gameMode }); }
    else if (phase === 'paused' && params.has('turbo')) { lastFlowCmd = now; events.emit('cmd:pause', {}); }
  }, 250);

  const api = {
    mode,
    log,
    get result() { return ctx.autoplayResult; },
    tick,
    coverage: () => {
      if (!coverage) computeCoverage();
      return [...coverage.entries()].map(([id, c]) => ({ id, antivirus: c.antivirus.length * SAMPLE_STEP, firewall: c.firewall.length * SAMPLE_STEP, defrag: c.defrag.length * SAMPLE_STEP }));
    },
    stop() {
      stopped = true;
      clearInterval(flowTimer);
      if (offStep) offStep();
      for (const off of offs) off();
      ctx.autoplay = null;
    },
  };
  ctx.autoplay = api;
  if (!quiet) console.info(`[autoplay] started (${mode})`);
  return api;
}
