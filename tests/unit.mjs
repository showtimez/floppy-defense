// Fast Node-only unit tests (no browser, no dev server) for the systems modules: economy, heat, autoplay strategy.
// Usage: node tests/unit.mjs      (also run first by tests/smoke.mjs)
import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import { GAME } from '../src/config.js';
import { createGameState } from '../src/core/state.js';
import { createRng } from '../src/core/rng.js';
import { createEconomy, INTEREST_MAX, COMBO } from '../src/game/economy.js';
import { createHeat, HEAT, OC } from '../src/game/heat.js';
import { startAutoplay } from '../src/core/autoplay.js';

// Isolated event bus per test (src/core/events.js is a module singleton).
function createBus() {
  const map = new Map();
  const log = [];
  return {
    log,
    on(n, fn) { if (!map.has(n)) map.set(n, new Set()); map.get(n).add(fn); return () => map.get(n).delete(fn); },
    off(n, fn) { map.get(n)?.delete(fn); },
    emit(n, p = {}) { log.push([n, p]); for (const fn of [...(map.get(n) || [])]) fn(p); },
    count(n) { return log.filter((e) => e[0] === n).length; },
  };
}

const cell = (c, r) => new THREE.Vector3(c + 0.5 - 12, 0, r + 0.5 - 7.5);

function fakeWorld() {
  const pts = [[0, 3], [8, 3], [8, 10], [18, 10], [18, 7]].map(([c, r]) => cell(c, r));
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
  const visuals = [];
  const fan = { speed: 1 };
  const slotCells = [[1, 2], [3, 4], [6, 2], [7, 5], [9, 9], [9, 11], [12, 9], [14, 11], [16, 9], [17, 6], [19, 8], [5, 7], [10, 6]];
  const map = {
    paths: [{ id: 'COM1', name: 'COM1', points: pts, length }],
    samplePath(pi, dist, out) {
      let d = Math.max(0, Math.min(length, dist));
      for (let i = 1; i < pts.length; i++) {
        const L = pts[i].distanceTo(pts[i - 1]);
        if (d <= L) return out.copy(pts[i - 1]).lerp(pts[i], d / L);
        d -= L;
      }
      return out.copy(pts[pts.length - 1]);
    },
    slots: slotCells.map(([c, r], id) => ({ id, c, r, pos: cell(c, r), tower: null })),
    cpu: { pos: cell(18, 7), radius: 1 },
    fan: { pos: cell(20, 4), radius: 0.8 },
    heatSpots: [
      { id: 'ram', name: 'RAM', pos: cell(4, 6), radius: 3 },
      { id: 'chipset', name: 'CHIPSET', pos: cell(15, 10), radius: 3 },
      { id: 'cpu', name: 'CPU', pos: cell(18, 7), radius: 2.5 },
    ],
    setHeatVisual: (id, level, over) => visuals.push([id, level, over]),
    setFanSpeed: (m) => { fan.speed = m; },
  };
  return { map, visuals, fan };
}

function fakeTowers(ctx) {
  const DEFS = { antivirus: { cost: 64, range: 3 }, firewall: { cost: 128, range: 2 }, defrag: { cost: 96, range: 2.4 } };
  let id = 1;
  const towers = {
    list: [],
    getDef: (t) => DEFS[t] || null,
    canPlace: (t, s) => (!DEFS[t] || !s ? { ok: false, reason: 'invalid' } : s.tower ? { ok: false, reason: 'occupied' }
      : ctx.economy.canAfford(DEFS[t].cost) ? { ok: true } : { ok: false, reason: 'kb' }),
    place(t, s) {
      if (!ctx.economy.spend(DEFS[t].cost, 'build')) return null;
      const tw = { id: id++, type: t, level: 1, slot: s, pos: s.pos, range: DEFS[t].range };
      s.tower = tw; towers.list.push(tw);
      ctx.events.emit('tower:placed', { tower: tw });
      return tw;
    },
    upgradeCost: (tw) => (tw.level >= 3 ? null : Math.round(DEFS[tw.type].cost * (tw.level === 1 ? 0.9 : 1.5))),
    upgrade(tw) {
      const c = towers.upgradeCost(tw);
      if (c == null || !ctx.economy.spend(c, 'upgrade')) return false;
      tw.level++;
      return true;
    },
  };
  return towers;
}

export function makeCtx({ seed = 1, params = '' } = {}) {
  const events = createBus();
  const game = createGameState();
  const world = fakeWorld();
  const smoke = [];
  const texts = [];
  const fxCount = { ring: 0, spark: 0 };
  const ctx = {
    THREE, events, game, rng: createRng(seed), params: new URLSearchParams(params),
    map: world.map,
    fx: {
      smoke: (pos, o) => smoke.push([pos.x, pos.z, o]),
      text: (pos, str, color, o) => texts.push({ x: pos.x, y: pos.y, z: pos.z, str, color, o }),
      ring: () => { fxCount.ring++; },
      spark: () => { fxCount.spark++; },
    },
  };
  ctx.economy = createEconomy(ctx);
  ctx.heat = createHeat(ctx);
  ctx.towers = fakeTowers(ctx);
  return { ctx, events, game, world, smoke, texts, fxCount };
}

// Minimal flow mirroring main.js so the bot can be exercised headless.
export function wireFlow(ctx) {
  const { events, game } = ctx;
  const enterPrep = () => {
    game.prepTimer = game.prepDuration = game.wave === 0 ? GAME.FIRST_PREP_TIME : GAME.PREP_TIME;
    game.phase = 'prep';
    events.emit('wave:prep', { wave: game.wave + 1, duration: game.prepDuration });
  };
  events.on('cmd:newGame', () => { game.phase = 'prep'; game.wave = 0; enterPrep(); });
  events.on('cmd:nextWave', () => {
    if (game.phase !== 'prep') return;
    const earlySeconds = Math.floor(game.prepTimer);
    game.wave++; game.phase = 'wave'; game.waveTimer = 3;
    events.emit('wave:start', { wave: game.wave, earlySeconds });
  });
  events.on('cmd:build', ({ type, slotId }) => {
    const slot = ctx.map.slots.find((s) => s.id === slotId);
    if (slot && ctx.towers.canPlace(type, slot).ok) ctx.towers.place(type, slot);
  });
  events.on('cmd:upgrade', ({ towerId }) => {
    const t = ctx.towers.list.find((x) => x.id === towerId);
    if (t) ctx.towers.upgrade(t);
  });
  events.on('fan:click', () => ctx.heat.coolClick());
  return (dt) => {
    game.time += dt;
    if (game.phase === 'prep') { game.prepTimer -= dt; if (game.prepTimer <= 0) events.emit('cmd:nextWave'); }
    if (game.phase === 'wave') {
      game.waveTimer -= dt;
      game.killTimer = (game.killTimer || 0) + dt;
      if (game.killTimer >= 0.5) { game.killTimer = 0; events.emit('enemy:killed', { enemy: { reward: 6 }, reward: 6 }); } // income stream
      if (game.waveTimer <= 0) {
        events.emit('wave:cleared', { wave: game.wave, bonus: 20, perfect: true });
        if (game.wave >= 10) { game.phase = 'victory'; events.emit('victory', { score: 1 }); } else enterPrep();
      }
    }
    ctx.heat.update(dt);
    ctx.economy.update(dt);
  };
}

// ---------------------------------------------------------------------------------------------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }
const DT = 1 / 60;
const run = (step, seconds) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) step(DT); };

test('economy: spend / earn / stats / reasons', () => {
  const { ctx, events, game } = makeCtx();
  game.phase = 'prep';
  const e = ctx.economy;
  eq(e.kb, GAME.START_KB, 'start kb');
  eq(e.spend(1000), false, 'overspend refused');
  eq(e.kb, GAME.START_KB, 'kb unchanged after refused spend');
  eq(e.spend(64, 'build'), true, 'spend ok');
  eq(game.stats.kbSpent, 64, 'kbSpent');
  e.earn(50, 'sell');
  e.earn(500, 'debug');
  eq(game.stats.kbEarned, 0, 'sell/debug do not count as earned');
  events.emit('enemy:killed', { enemy: { reward: 7 }, reward: 7 });
  eq(game.stats.kbEarned, 7, 'kill reward counted');
  const last = events.log.filter((x) => x[0] === 'kb:change').pop()[1];
  eq(last.reason, 'kill', 'kb:change reason');
  eq(last.delta, 7, 'kb:change delta');
  eq(last.kb, game.kb, 'kb:change kb');
  eq(e.canAfford(game.kb), true, 'canAfford exact');
  eq(e.canAfford(game.kb + 1), false, 'canAfford +1');
});

test('economy: wave clear bonus + capped interest, early call', () => {
  const { ctx, events, game } = makeCtx();
  game.phase = 'prep';
  game.kb = 300;
  events.emit('wave:cleared', { wave: 1, bonus: 20, perfect: true });
  eq(ctx.economy.lastBonus, 20, 'bonus');
  eq(ctx.economy.lastInterest, Math.floor(320 * 0.05), 'interest on current KB');
  eq(game.kb, 320 + 16, 'kb after clear');
  game.kb = 5000;
  eq(ctx.economy.interestFor(), INTEREST_MAX, 'interest cap');
  events.emit('wave:start', { wave: 2, earlySeconds: 9 });
  eq(ctx.economy.lastEarly, 9 * GAME.EARLY_CALL_KB_PER_SEC, 'early bonus');
  events.emit('wave:start', { wave: 3, earlySeconds: 0 });
  eq(ctx.economy.lastEarly, 0, 'no early bonus');
  const reasons = events.log.filter((x) => x[0] === 'kb:change').map((x) => x[1].reason);
  ok(reasons.includes('wave') && reasons.includes('interest') && reasons.includes('early'), `reasons ${reasons}`);
  ctx.economy.reset();
  eq(game.kb, GAME.START_KB, 'reset');
});

test('economy: kills ignored outside play', () => {
  const { events, game } = makeCtx();
  game.phase = 'menu';
  events.emit('enemy:killed', { enemy: { reward: 7 }, reward: 7 });
  eq(game.kb, GAME.START_KB, 'menu kill ignored');
});

test('economy: CACHE HIT - 5 kills in one burst pay x5 +3KB once', () => {
  const { ctx, events, game, texts } = makeCtx();
  game.phase = 'wave';
  const at = (x, z) => ({ pos: new THREE.Vector3(x, 0.35, z), reward: 4 });
  const kb0 = game.kb;
  for (let i = 0; i < 5; i++) events.emit('enemy:killed', { enemy: at(1 + i * 0.3, 2), reward: 4 });
  eq(ctx.economy.chain, 5, 'chain running');
  for (let i = 0; i < 20; i++) { game.time += DT; ctx.economy.update(DT); }
  eq(events.count('combo'), 0, 'not paid while the window is open');
  for (let i = 0; i < 30; i++) { game.time += DT; ctx.economy.update(DT); }
  eq(events.count('combo'), 1, 'one combo');
  const c = events.log.find((e) => e[0] === 'combo')[1];
  ok(c.n === 5 && c.kb === 3, `payload ${JSON.stringify({ n: c.n, kb: c.kb })}`);
  eq(game.kb, kb0 + 5 * 4 + 3, 'kills + combo bonus');
  eq(texts.length, 1, 'one floating label');
  eq(texts[0].str, 'CACHE HIT x5 +3KB', 'label text');
  ok(Math.abs(texts[0].x - 1.6) < 1e-6 && texts[0].y > 0.35, 'label at the burst centre, above the kills');
  const reasons = events.log.filter((e) => e[0] === 'kb:change').map((e) => e[1].reason);
  ok(reasons.includes('combo'), 'kb:change reason combo');
  eq(game.stats.bestCombo, 5, 'stats.bestCombo');
  eq(game.stats.combos, 1, 'stats.combos');
});

test('economy: CACHE HIT - slow, far-apart and 2-kill chains pay nothing; wave clear flushes', () => {
  const { ctx, events, game } = makeCtx();
  game.phase = 'wave';
  const at = (x, z) => ({ pos: new THREE.Vector3(x, 0.35, z), reward: 4 });
  const step = (s) => { for (let i = 0, n = Math.round(s / DT); i < n; i++) { game.time += DT; ctx.economy.update(DT); } };
  for (let i = 0; i < 4; i++) { events.emit('enemy:killed', { enemy: at(0, 0), reward: 4 }); step(COMBO.WINDOW + 0.05); }
  eq(events.count('combo'), 0, 'kills further apart than the window do not chain');
  for (let i = 0; i < 4; i++) events.emit('enemy:killed', { enemy: at(-10 + i * 6, 0), reward: 4 });
  step(1);
  eq(events.count('combo'), 0, 'kills across the board do not chain');
  events.emit('enemy:killed', { enemy: at(3, 3), reward: 4 });
  events.emit('enemy:killed', { enemy: at(3, 3), reward: 4 });
  step(1);
  eq(events.count('combo'), 0, '2 kills are not a combo');
  // two simultaneous fights chain separately
  for (let i = 0; i < 3; i++) { events.emit('enemy:killed', { enemy: at(-8, 0), reward: 4 }); events.emit('enemy:killed', { enemy: at(8, 0), reward: 4 }); }
  step(1);
  eq(events.count('combo'), 2, 'two local chains');
  // the last chain of a wave pays with the clear, before bonus and interest
  for (let i = 0; i < 4; i++) events.emit('enemy:killed', { enemy: at(2, 2), reward: 4 });
  events.emit('wave:cleared', { wave: 3, bonus: 20, perfect: true });
  eq(events.count('combo'), 3, 'flushed on wave:cleared');
  const order = events.log.filter((e) => e[0] === 'kb:change').map((e) => e[1].reason).slice(-3);
  eq(order.join(','), 'combo,wave,interest', 'combo before bonus and interest');
  game.phase = 'menu';
  for (let i = 0; i < 6; i++) events.emit('enemy:killed', { enemy: at(0, 0), reward: 4 });
  step(1);
  eq(events.count('combo'), 3, 'no combos outside play');
  game.phase = 'wave';
  for (let i = 0; i < 6; i++) events.emit('enemy:killed', { enemy: at(0, 0), reward: 4 });
  ctx.economy.reset();
  step(1);
  eq(events.count('combo'), 3, 'reset drops the running chain');
});

test('heat: wave 2 heats 3 s into prep, rises, warns, overheats', () => {
  const { ctx, events, game, world, smoke } = makeCtx();
  const step = (dt) => { game.time += dt; ctx.heat.update(dt); };
  game.phase = 'prep';
  events.emit('wave:prep', { wave: 1 });
  run(step, 5);
  eq(ctx.heat.active, null, 'no heat before wave 2');
  events.emit('wave:prep', { wave: 2 });
  eq(ctx.heat.active, null, 'not on the WAVE CLEARED banner');
  run(step, HEAT.FIRST_DELAY - 0.1);
  eq(ctx.heat.active, null, 'still waiting');
  run(step, 0.2);
  ok(ctx.heat.active, `heat active ${HEAT.FIRST_DELAY} s into wave 2 prep`);
  eq(events.count('heat:start'), 1, 'heat:start once');
  const spot = ctx.heat.active.spot;
  run(step, HEAT.RISE_TIME * 0.55);
  eq(events.count('heat:warning'), 1, 'warning at 50 %');
  eq(ctx.heat.active.overheated, false, 'not yet overheated');
  eq(ctx.heat.fireRateMul(spot.pos), 1, 'no penalty before overheat');
  run(step, HEAT.RISE_TIME * 0.5);
  eq(ctx.heat.active.overheated, true, `overheated after ~${HEAT.RISE_TIME} s`);
  eq(events.count('heat:overheat'), 1, 'overheat event once');
  eq(ctx.heat.fireRateMul(spot.pos), HEAT.PENALTY, 'penalty inside radius');
  const far = spot.pos.clone(); far.x += spot.radius + 0.5;
  eq(ctx.heat.fireRateMul(far), 1, 'no penalty outside radius');
  ok(smoke.length >= 1, 'smoke puffs while overheated');
  const last = world.visuals[world.visuals.length - 1];
  ok(last[0] === spot.id && last[1] === 1 && last[2] === true, `visual ${last}`);
  run(step, 5);
  eq(events.count('heat:overheat'), 1, 'no repeated overheat events');
});

test('heat: from wave 3 it starts mid-wave (6-12 s after wave:start), pause-safe, one spot at a time', () => {
  const { ctx, events, game } = makeCtx({ seed: 9 });
  const step = (dt) => { game.time += dt; ctx.heat.update(dt); };
  for (let w = 3; w <= 8; w++) {
    game.phase = 'prep';
    events.emit('wave:prep', { wave: w });
    run(step, 4);
    eq(ctx.heat.active, null, `wave ${w}: nothing during prep`);
    game.phase = 'wave';
    let startedIn = null;
    const off = events.on('heat:start', () => { startedIn = { phase: game.phase, t: game.time }; });
    const t0 = game.time;
    events.emit('wave:start', { wave: w });
    const p = ctx.heat.pendingStart;
    ok(p >= HEAT.MID_DELAY && p <= HEAT.MID_DELAY + HEAT.MID_DELAY_RND, `wave ${w}: delay ${p}`);
    run(step, HEAT.MID_DELAY + HEAT.MID_DELAY_RND + 0.1);
    off();
    ok(startedIn && startedIn.phase === 'wave', `wave ${w}: heat:start fired during the wave`);
    const dt = startedIn.t - t0;
    ok(dt >= HEAT.MID_DELAY - 0.02 && dt <= HEAT.MID_DELAY + HEAT.MID_DELAY_RND + 0.02, `wave ${w}: started after ${dt.toFixed(2)} s`);
    // a wave:start while a spot is still hot schedules nothing
    events.emit('wave:start', { wave: w });
    eq(ctx.heat.pendingStart, 0, 'no second spot while one is hot');
    while (ctx.heat.active) { game.time += 0.1; ctx.heat.coolClick(); }
  }
  // the timer only runs in update(): no sim steps (pause) -> nothing starts
  game.phase = 'wave';
  events.emit('wave:start', { wave: 9 });
  ok(ctx.heat.pendingStart > 0, 'scheduled');
  eq(ctx.heat.active, null, 'not started without sim steps');
  ctx.heat.reset();
  eq(ctx.heat.pendingStart, 0, 'reset clears the schedule');
  run(step, 15);
  eq(ctx.heat.active, null, 'nothing after reset');
});

test('heat: 4 fan clicks cool a full overheat, 10 Hz mashing all counts, fan boost decays', () => {
  const { ctx, events, game, world } = makeCtx();
  game.phase = 'wave';
  ctx.heat.start('ram');
  const step = (dt) => { game.time += dt; ctx.heat.update(dt); };
  run(step, HEAT.RISE_TIME + 0.2);
  ok(ctx.heat.active.overheated, 'overheated');
  eq(ctx.heat.coolClick(), true, 'click 1');
  eq(ctx.heat.coolClick(), false, 'same-instant double fire ignored');
  ok(world.fan.speed > 1, 'fan boosted');
  for (let i = 2; i <= 3; i++) {
    run(step, 0.1); // 10 Hz mashing, the sim keeps running in between
    eq(ctx.heat.coolClick(), true, `click ${i} counts`);
    ok(ctx.heat.active && ctx.heat.active.overheated, `still overheated after ${i} clicks`);
  }
  eq(+ctx.heat.active.level.toFixed(3), 0.25, 'no heat creep while the fan is being clicked');
  run(step, HEAT.FAN_HOLD + 0.5);
  ok(ctx.heat.active.level > 0.25, 'creeps back up once the clicking stops');
  ctx.heat.active.level = 0.25;
  ctx.heat.coolClick();
  eq(ctx.heat.active, null, 'cooled after 4 clicks');
  eq(events.count('heat:cooled'), 1, 'heat:cooled');
  eq(events.count('fan:cool'), 4, 'fan:cool per effective click');
  const v = world.visuals[world.visuals.length - 1];
  ok(v[0] === 'ram' && v[1] === 0 && v[2] === false, 'visual cleared');
  run(step, 4);
  eq(world.fan.speed, 1, 'fan back to idle');
  eq(ctx.heat.fireRateMul(ctx.map.heatSpots[0].pos), 1, 'penalty gone');
});

test('heat: OVERCLOCK x1.5 for 8 s, +50 % heat on the busiest spot, 30 s cooldown, waves only', () => {
  const { ctx, events, game, fxCount } = makeCtx({ seed: 5 });
  const step = (dt) => { game.time += dt; ctx.heat.update(dt); };
  // three floppies near the chipset spot, one near the RAM
  for (const id of [6, 7, 8, 2]) ctx.towers.place('antivirus', ctx.map.slots[id]);
  game.phase = 'prep';
  events.emit('cmd:overclock');
  eq(ctx.heat.overclockState.active, false, 'not in prep');
  eq(events.count('overclock:denied'), 1, 'denied event');
  game.phase = 'wave';
  events.emit('cmd:overclock');
  const st = ctx.heat.overclockState;
  ok(st.active && st.t === OC.TIME && st.cd === OC.COOLDOWN && st.cdMax === OC.COOLDOWN, `state ${JSON.stringify(st)}`);
  eq(events.count('overclock:on'), 1, 'overclock:on');
  ok(ctx.heat.active, 'heat started by overclock');
  const busiest = ctx.heat.active.spot;
  const cover = (s) => ctx.towers.list.filter((t) => t.pos.distanceTo(s.pos) <= s.radius).length;
  const max = Math.max(...ctx.map.heatSpots.map(cover));
  eq(cover(busiest), max, `overclock heats the spot covering the most floppies (${busiest.id})`);
  eq(+ctx.heat.active.level.toFixed(3), OC.HEAT, 'heat +0.5');
  eq(fxCount.ring, ctx.towers.list.length, 'activation ring per floppy');
  const far = new THREE.Vector3(-30, 0, -30);
  eq(ctx.heat.fireRateMul(far), OC.MUL, 'x1.5 everywhere');
  run(step, 1);
  ok(fxCount.spark > 0, 'sparks while overclocked');
  events.emit('cmd:overclock');
  eq(events.count('overclock:on'), 1, 'second press during cooldown does nothing');
  eq(events.count('overclock:denied'), 2, 'cooldown denial');
  run(step, OC.TIME);
  eq(ctx.heat.overclockState.active, false, 'ends after 8 s');
  eq(events.count('overclock:off'), 1, 'overclock:off');
  eq(ctx.heat.fireRateMul(far), 1, 'back to x1');
  ok(ctx.heat.active.overheated, 'the boosted spot overheated meanwhile (0.5 + 9 s of heating)');
  run(step, OC.COOLDOWN - OC.TIME - 1 + 0.05);
  ok(ctx.heat.overclockState.ready, `cooldown over (${ctx.heat.overclockState.cd})`);
  events.emit('cmd:overclock');
  eq(events.count('overclock:on'), 2, 'usable again after 30 s');
  eq(ctx.heat.fireRateMul(busiest.pos), OC.MUL * HEAT.PENALTY, 'x1.5 x0.5 inside the overheated spot');
  ctx.heat.reset();
  const s2 = ctx.heat.overclockState;
  ok(!s2.active && s2.cd === 0 && s2.ready, 'reset clears overclock');
});

test('heat: random spot never repeats, one at a time, reset clears', () => {
  const { ctx, events, game, world } = makeCtx({ seed: 42 });
  game.phase = 'prep';
  const seq = [];
  for (let i = 0; i < 30; i++) { ctx.heat.start(); seq.push(ctx.heat.active.spot.id); }
  ok(seq.every((s, i) => i === 0 || s !== seq[i - 1]), `repeat in ${seq.join(',')}`);
  ok(new Set(seq).size === 3, 'all spots used');
  // a wave:prep / wave:start while a spot is still hot does not start another one
  const cur = ctx.heat.active.spot.id;
  events.emit('wave:prep', { wave: 2 });
  events.emit('wave:start', { wave: 5 });
  for (let i = 0; i < 60 * 14; i++) { game.time += DT; ctx.heat.update(DT); }
  eq(ctx.heat.active.spot.id, cur, 'only one hot spot');
  eq(events.count('heat:start'), 30, 'no extra heat:start');
  ctx.heat.reset();
  eq(ctx.heat.active, null, 'reset');
  ok(world.visuals.slice(-3).every((v) => v[1] === 0 && v[2] === false), 'reset clears visuals');
  eq(world.fan.speed, 1, 'reset fan');
});

test('heat: falls back to the CPU when the map has no heat spots', () => {
  const { ctx, game } = makeCtx();
  ctx.map.heatSpots = [];
  game.phase = 'prep';
  ctx.heat.start();
  eq(ctx.heat.active && ctx.heat.active.spot.id, 'cpu', 'fallback spot');
});

test('autoplay: plays a 10-wave fake campaign, mixes towers, cools heat, logs', () => {
  const { ctx, events, game } = makeCtx({ params: 'autoplay=1&quiet=1' });
  const step = wireFlow(ctx);
  const bot = startAutoplay(ctx);
  try {
    events.emit('cmd:newGame', { mode: 'campaign' });
    for (let i = 0; i < 60 * 60 * 10 && game.phase !== 'victory'; i++) step(DT);
    eq(game.phase, 'victory', 'fake campaign finished');
    eq(ctx.autoplayLog.length, 10, 'one log row per wave');
    const row = ctx.autoplayLog[9];
    ok(['wave', 'cpu', 'kb', 'towers', 'leaks', 'time'].every((k) => k in row), 'log row shape');
    const types = new Set(ctx.towers.list.map((t) => t.type));
    ok(ctx.towers.list.length >= 6, `built ${ctx.towers.list.length} towers`);
    ok(types.has('antivirus') && types.has('defrag'), `tower mix ${[...types]}`);
    ok(ctx.towers.list.slice(0, 3).every((t) => t.type === 'antivirus'), 'antivirus opening');
    ok(events.count('fan:click') > 0, 'bot clicked the fan');
    ok(events.count('heat:overheat') === 0, 'bot never let the board overheat');
    eq(events.count('heat:start'), events.count('heat:cooled'), 'bot cooled every hot spot');
    eq(events.count('overclock:on'), 0, 'bot never overclocks');
    ok(ctx.autoplayResult && ctx.autoplayResult.result === 'victory', 'autoplayResult');
    const maxed = ctx.map.slots.every((sl) => sl.tower && sl.tower.level === 3);
    ok(maxed || game.kb < 250, `bot spends its KB (left ${game.kb}, all maxed ${maxed})`);
  } finally { bot.stop(); }
});

test('autoplay: picks the slots with the most path coverage first', () => {
  const { ctx, events, game } = makeCtx({ params: 'autoplay=greedy&quiet=1' });
  const step = wireFlow(ctx);
  const bot = startAutoplay(ctx);
  try {
    events.emit('cmd:newGame', { mode: 'campaign' });
    run(step, 0.5);
    const cov = bot.coverage().sort((a, b) => b.antivirus - a.antivirus);
    const built = ctx.towers.list.map((t) => t.slot.id);
    eq(built.length, 3, 'greedy builds 3 antivirus with 200 KB');
    const best = cov[0].antivirus;
    ok(built.every((id) => cov.find((c) => c.id === id).antivirus >= cov[3].antivirus), `built ${built} cov ${JSON.stringify(cov.slice(0, 4))}`);
    ok(cov.find((c) => c.id === built[0]).antivirus === best, 'first tower on the best slot');
  } finally { bot.stop(); }
});

test('autoplay: idle builds nothing and calls waves', () => {
  const { ctx, events, game } = makeCtx({ params: 'autoplay=idle&quiet=1' });
  const step = wireFlow(ctx);
  const bot = startAutoplay(ctx);
  try {
    events.emit('cmd:newGame', { mode: 'campaign' });
    run(step, 2);
    eq(ctx.towers.list.length, 0, 'no towers');
    eq(game.phase, 'wave', 'wave called early');
  } finally { bot.stop(); }
});

// ---------------------------------------------------------------------------------------------
export async function runUnit({ print = true } = {}) {
  const results = [];
  for (const t of tests) {
    try { await t.fn(); results.push({ name: t.name, ok: true }); }
    catch (err) { results.push({ name: t.name, ok: false, error: err.message }); }
  }
  if (print) {
    for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       ${r.error}`}`);
    const f = results.filter((r) => !r.ok).length;
    console.log(`  unit: ${results.length - f}/${results.length} passed`);
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const res = await runUnit();
  process.exit(res.some((r) => !r.ok) ? 1 : 0);
}
