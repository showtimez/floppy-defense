// FLOPPY DEFENSE - entry point, module wiring and game-flow state machine.
// Module APIs and event payloads are specified in docs/CONTRACTS.md.
import * as THREE from 'three';
import './style.css';
import { GAME, PALETTE } from './config.js';
import { events } from './core/events.js';
import { createGameState, resetGameState } from './core/state.js';
import { createLoop } from './core/loop.js';
import { settings, saveSettings } from './core/save.js';
import { setLang, t } from './core/i18n.js';
import { rng } from './core/rng.js';
import { createRenderer } from './render/renderer.js';
import { createFx } from './render/fx.js';
import { createMap } from './world/map.js';
import { createEnemies } from './game/enemies.js';
import { createProjectiles } from './game/projectiles.js';
import { createTowers } from './game/towers.js';
import { createEconomy } from './game/economy.js';
import { createHeat } from './game/heat.js';
import { createWaves } from './game/waves.js';
import { createInput } from './core/input.js';
import { createUI } from './ui/ui.js';
import { audio } from './audio/audio.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const TURBO = Math.max(1, Math.min(20, Number(params.get('turbo')) || 1)); // test-only simulation speed-up
const AUTOPLAY = params.has('autoplay');
const FORCE_MUTE = params.has('mute');             // test-only: mutes this session, never persisted
const PHOTO = DEBUG && params.has('photo');        // ?debug=1&photo=1: HUD-less showcase board (cover art / GIF)
const ATTRACT = !PHOTO && !AUTOPLAY && !params.has('autostart') && !params.has('noattract'); // demo behind the menu
const TAINTED = DEBUG || TURBO > 1 || AUTOPLAY;    // dev/bot runs never touch bestWave / unlocks / leaderboard

setLang(settings.lang);

const container = document.getElementById('game');
const game = createGameState();
const ctx = { THREE, events, game, settings, audio, rng, params, debug: DEBUG, container };
window.__FD = ctx; // debug / automated-test hook

// ---------------------------------------------------------------------------------------------
// Boot: create modules in dependency order. A module that throws is replaced by a no-op stub so
// the rest of the game keeps running (errors are logged and listed in ctx.bootErrors).
// ---------------------------------------------------------------------------------------------
ctx.bootErrors = [];
const ARRAY_KEYS = new Set(['list', 'slots', 'paths', 'heatSpots', 'ports']);
function stub() {
  // arrays stay iterable, isX flags read false, everything else is a callable no-op
  return new Proxy({}, {
    get: (_t, k) => (ARRAY_KEYS.has(k) ? [] : (typeof k === 'string' && /^is[A-Z]/.test(k) ? false : () => null)),
  });
}
function safeCreate(name, factory) {
  try {
    return factory(ctx);
  } catch (err) {
    console.error(`[boot] ${name} failed to initialise`, err);
    ctx.bootErrors.push(`${name}: ${err && err.message}`);
    return stub();
  }
}

ctx.view = safeCreate('renderer', (c) => createRenderer(c, container));
// Without WebGL nothing can be drawn: show a BIOS-style error and stop booting (no modules, loop or 'boot').
const WEBGL_OK = !!ctx.view?.renderer?.isWebGLRenderer;
if (WEBGL_OK) {
  ctx.map = safeCreate('map', createMap);
  ctx.fx = safeCreate('fx', createFx);
  ctx.enemies = safeCreate('enemies', createEnemies);
  ctx.projectiles = safeCreate('projectiles', createProjectiles);
  ctx.towers = safeCreate('towers', createTowers);
  ctx.economy = safeCreate('economy', createEconomy);
  ctx.heat = safeCreate('heat', createHeat);
  ctx.waves = safeCreate('waves', createWaves);
  ctx.input = safeCreate('input', createInput);
  ctx.ui = safeCreate('ui', createUI);
  try { audio.bindEvents(events, ctx); audio.setMuted(settings.muted || FORCE_MUTE); } catch (err) { console.error('[boot] audio', err); }
} else {
  showNoWebgl();
}

function showNoWebgl() {
  const NO_WEBGL_EN = 'VGA ADAPTER NOT FOUND. FLOPPY DEFENSE needs WebGL: turn on hardware acceleration in your '
    + 'browser settings or try another browser, then reload.';
  let msg = NO_WEBGL_EN;
  try { const s = t('boot.noWebgl'); if (s && s !== 'boot.noWebgl') msg = s; } catch (e) { /* keep English */ }
  const host = document.getElementById('ui') || container || document.body;
  const box = document.createElement('div');
  box.className = 'fd-nogl';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:absolute;inset:0;pointer-events:auto;background:#0000aa;color:#fff;'
    + 'font:16px var(--font-dos, monospace);display:flex;align-items:center;justify-content:center;'
    + 'text-align:center;padding:24px;line-height:1.6;z-index:100;';
  const text = document.createElement('div');
  text.style.cssText = 'max-width:40em;';
  const title = document.createElement('div');
  title.style.cssText = 'display:inline-block;background:#aaaaaa;color:#0000aa;padding:0 0.5em;margin-bottom:1.6em;';
  title.textContent = ` ${GAME.TITLE} `;
  const body = document.createElement('div');
  body.textContent = msg;
  text.append(title, body);
  box.append(text);
  host.append(box);
}

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------
let lkg = null;          // 'Last Known Good Configuration': snapshot taken at every wave start (BSOD RESTORE)
let timeScale = 1;       // hit-stop: < 1 briefly after a boss kill / the last kill of a wave
let hsHold = 0;          // real seconds to hold timeScale before easing back to 1
let photoFreeze = false; // photo mode: P freezes the simulation (rendering keeps running)
const photoEnemies = new WeakSet();
const photoRespawn = [];
let attract = false;     // attract demo running behind the menu
let attractT = 0;        // seconds to the next demo virus
let attractN = 0;        // demo viruses spawned so far

function setPhase(to) {
  const from = game.phase;
  if (from === to) return;
  game.phase = to;
  events.emit('phase:change', { from, to });
}

function resetWorld() {
  for (const m of ['enemies', 'projectiles', 'towers', 'heat', 'waves', 'economy', 'fx', 'map']) {
    try {
      ctx[m].reset();
    } catch (err) { console.error(`[flow] ${m}.reset failed`, err); }
  }
  select(null);
}

function resetFlowExtras() {
  lkg = null;
  game.lkg = null;
  timeScale = 1;
  hsHold = 0;
  photoRespawn.length = 0;
  attract = false;
}

function newGame(mode = 'campaign') {
  resetGameState(game, mode);
  resetFlowExtras();
  game.endlessFresh = mode === 'endless';
  resetWorld();
  ctx.map.setCpuIntegrity(1);
  events.emit('game:new', { mode });
  if (DEBUG && Number(params.get('wave')) > 1) {
    game.wave = Math.min(Number(params.get('wave')), 99) - 1;
    ctx.economy.earn(150 * game.wave, 'debug');
  }
  enterPrep(game.wave === 0);
}

function enterPrep(first = false) {
  const next = game.wave + 1;
  game.prepDuration = first ? GAME.FIRST_PREP_TIME : GAME.PREP_TIME;
  game.prepTimer = game.prepDuration;
  game.prepHold = !PHOTO && firstPrepHold(); // also refreshed every step (first floppy releases it)
  setPhase('prep');
  events.emit('wave:prep', { wave: next, duration: game.prepDuration, info: ctx.waves.info(next) });
}

function snapshotLKG() {
  try {
    lkg = {
      mode: game.mode,
      endlessFresh: game.endlessFresh,
      wave: game.wave,
      kb: game.kb,
      cpu: game.cpu,
      stats: cloneStats(game.stats),
      towers: ctx.towers.list.map((tw) => ({ type: tw.type, level: tw.level, slotId: tw.slot && tw.slot.id, targeting: tw.targeting })),
    };
    game.lkg = { wave: lkg.wave + 1 };
  } catch (err) { console.error('[flow] LKG snapshot failed', err); }
}

function cloneStats(s) {
  return typeof structuredClone === 'function' ? structuredClone(s || {}) : JSON.parse(JSON.stringify(s || {}));
}

function startWave() {
  if (game.phase !== 'prep') return;
  snapshotLKG(); // before game.wave += 1: a restore replays this prep
  const earlySeconds = Math.max(0, Math.floor(game.prepTimer));
  game.wave += 1;
  game.prepHold = false;
  game.cpuAtWaveStart = game.cpu;
  const info = ctx.waves.info(game.wave);
  setPhase('wave');
  ctx.waves.start(game.wave);
  events.emit('wave:start', { wave: game.wave, isBoss: !!(info && info.isBoss), info, earlySeconds });
}

function waveCleared() {
  const wave = game.wave;
  const info = ctx.waves.info(wave);
  const perfect = game.cpu >= (game.cpuAtWaveStart ?? game.cpu);
  if (perfect) game.stats.perfectWaves++;
  hitStop(0.35, 0.2); // softer beat on the last kill of a wave
  events.emit('wave:cleared', { wave, bonus: (info && info.bonus) || 0, perfect });
  if (game.mode === 'campaign' && wave >= game.totalWaves) {
    finish('victory');
    return;
  }
  enterPrep();
}

export function computeScore() {
  const s = game.stats;
  const cleared = game.phase === 'victory' ? game.wave : Math.max(0, game.wave - 1);
  const total = cleared * 1000 + s.kills * 10 + s.bossKills * 2500 + Math.round(game.cpu) * 25 + Math.round(game.kb);
  return Math.round(total * Math.pow(0.8, s.restores || 0)); // each Last Known Good restore costs 20 %
}
ctx.computeScore = computeScore;

function finish(kind) {
  game.speed = 1;
  select(null);
  const survived = kind === 'victory' ? game.wave : Math.max(0, game.wave - 1);
  if (!TAINTED) {
    settings.bestWave = Math.max(settings.bestWave || 0, survived);
    if (kind === 'victory') settings.endlessUnlocked = true;
  }
  saveSettings();
  setPhase(kind);
  events.emit(kind, { wave: game.wave, mode: game.mode, stats: game.stats, score: computeScore(), survived, tainted: TAINTED });
}

function toMenu() {
  resetGameState(game, game.mode);
  resetFlowExtras();
  resetWorld();
  ctx.map.setCpuIntegrity(1);
  setPhase('menu');
  events.emit('menu', {});
  startAttract();
}

function togglePause() {
  if (game.phase === 'paused') {
    setPhase(game.prevPhase || 'prep');
    events.emit('resume', {});
  } else if (game.phase === 'prep' || game.phase === 'wave') {
    game.prevPhase = game.phase;
    setPhase('paused');
    events.emit('pause', {});
  }
}

// Victory -> KEEP GOING: the same run continues in endless mode (wave 11+, towers/KB/CPU/stats kept).
function continueEndless() {
  if (game.phase !== 'victory') return;
  game.mode = 'endless';
  game.endlessFresh = false;
  select(null);
  enterPrep();
}

// BSOD -> RESTORE: rebuild the board exactly as it was when the lost wave started, then replay its prep.
function restoreLKG() {
  if (game.phase !== 'gameover' || !lkg) return;
  const s = lkg;
  resetGameState(game, s.mode);
  game.endlessFresh = s.endlessFresh;
  timeScale = 1;
  hsHold = 0;
  resetWorld();
  events.emit('game:new', { mode: s.mode, restored: true });
  ctx.economy.earn(1e6, 'debug'); // temporary credit so every floppy can be re-inserted; settled below
  for (const tw of s.towers) {
    try {
      const slot = slotById(tw.slotId);
      const tower = slot && !slot.tower ? ctx.towers.place(tw.type, slot) : null;
      if (!tower) continue;
      for (let l = 1; l < tw.level; l++) ctx.towers.upgrade(tower);
      if (tw.targeting) tower.targeting = tw.targeting;
    } catch (err) { console.error('[flow] LKG restore: floppy', tw, err); }
  }
  const diff = game.kb - s.kb;
  if (diff > 0) ctx.economy.spend(diff, 'debug');
  else if (diff < 0) ctx.economy.earn(-diff, 'debug');
  game.cpu = s.cpu;
  ctx.map.setCpuIntegrity(game.cpu / GAME.CPU_MAX);
  game.wave = s.wave;
  game.stats = cloneStats(s.stats);
  game.stats.restores = (s.stats.restores || 0) + 1;
  game.lkg = { wave: s.wave + 1 }; // lkg itself is kept: losing the same wave again can restore again
  enterPrep();
}

// Hit-stop: scale the simulation briefly (UI, camera and post keep running on real time).
function hitStop(scale, hold) {
  if (TURBO > 1) return; // tests/bots at turbo speed keep a constant sim rate
  timeScale = Math.min(timeScale, scale);
  hsHold = Math.max(hsHold, hold);
}

// ---------------------------------------------------------------------------------------------
// Selection (canonical): input emits select:*, main resolves it and broadcasts selection:change.
// ---------------------------------------------------------------------------------------------
function select(sel) {
  game.selected = sel;
  try {
    if (!sel) {
      ctx.map.setSelected(null);
      ctx.map.showRange(null);
    } else if (sel.kind === 'slot') {
      ctx.map.setSelected(sel.slot);
      ctx.map.showRange(null);
    } else if (sel.kind === 'tower') {
      ctx.map.setSelected(sel.tower.slot);
      ctx.map.showRange(sel.tower.pos, sel.tower.range, sel.tower.color ?? PALETTE.phosphor);
    }
    ctx.towers.select(sel && sel.kind === 'tower' ? sel.tower : null);
  } catch (err) { console.error('[flow] select', err); }
  events.emit('selection:change', { selected: sel });
}

const inPlay = () => game.phase === 'prep' || game.phase === 'wave';
const slotById = (id) => ctx.map.slots.find((s) => s.id === id);
const towerById = (id) => ctx.towers.list.find((tw) => tw.id === id);
const selectedTower = () => (game.selected && game.selected.kind === 'tower' ? game.selected.tower : null);

events.on('select:slot', ({ slot }) => {
  if (!inPlay() || !slot) return;
  if (slot.tower) select({ kind: 'tower', tower: slot.tower });
  else select({ kind: 'slot', slot });
});
events.on('select:tower', ({ tower }) => { if (inPlay() && tower) select({ kind: 'tower', tower }); });
events.on('select:none', () => select(null));

events.on('ui:previewRange', ({ slotId, type }) => {
  const slot = slotById(slotId);
  if (!slot || !type) {
    if (game.selected && game.selected.kind === 'slot') ctx.map.showRange(null);
    return;
  }
  const def = ctx.towers.getDef(type, 1);
  if (def) ctx.map.showRange(slot.pos, def.range, def.color);
});

// ---------------------------------------------------------------------------------------------
// Commands (from UI / input)
// ---------------------------------------------------------------------------------------------
events.on('cmd:newGame', ({ mode } = {}) => newGame(mode || 'campaign'));
events.on('cmd:menu', () => toMenu());
events.on('cmd:continueEndless', () => continueEndless());
events.on('cmd:restoreLKG', () => restoreLKG());
events.on('cmd:nextWave', () => { if (game.phase === 'prep') startWave(); });
events.on('cmd:pause', () => togglePause());
events.on('cmd:speed', () => {
  const i = GAME.SPEEDS.indexOf(game.speed);
  game.speed = GAME.SPEEDS[(i + 1) % GAME.SPEEDS.length];
  events.emit('speed:change', { speed: game.speed });
});

events.on('cmd:build', ({ type, slotId }) => {
  if (!inPlay()) return;
  const slot = slotById(slotId) || (game.selected && game.selected.kind === 'slot' ? game.selected.slot : null);
  if (!slot || slot.tower) return;
  const check = ctx.towers.canPlace(type, slot);
  if (!check.ok) {
    events.emit('build:failed', { type, slot, reason: check.reason });
    return;
  }
  const tower = ctx.towers.place(type, slot);
  if (tower) select(null);
});

events.on('cmd:quickbuild', ({ type, slotId }) => {
  const slot = slotById(slotId) || (game.selected && game.selected.kind === 'slot' ? game.selected.slot : null);
  if (slot) events.emit('cmd:build', { type, slotId: slot.id });
});

events.on('cmd:upgrade', ({ towerId } = {}) => {
  if (!inPlay()) return;
  const tower = towerId != null ? towerById(towerId) : selectedTower();
  if (!tower) return;
  if (ctx.towers.upgrade(tower)) select({ kind: 'tower', tower });
  else events.emit('upgrade:failed', { tower, reason: ctx.towers.upgradeCost(tower) == null ? 'max' : 'kb' });
});

events.on('cmd:sell', ({ towerId } = {}) => {
  if (!inPlay()) return;
  const tower = towerId != null ? towerById(towerId) : selectedTower();
  if (!tower) return;
  ctx.towers.sell(tower);
  select(null);
});

events.on('cmd:setTargeting', ({ towerId, mode }) => {
  const tower = towerById(towerId);
  if (tower) { tower.targeting = mode; events.emit('tower:targeting', { tower, mode }); }
});

events.on('fan:click', () => {
  if (!inPlay()) return;
  game.stats.fanClicks++;
  ctx.heat.coolClick();
});

events.on('cmd:setting', ({ key, value }) => {
  if (key === 'toggleMute') { key = 'muted'; value = !settings.muted; }
  settings[key] = value;
  if (key === 'lang') settings.langChosen = true;
  saveSettings();
  if (key === 'muted') audio.setMuted(value || FORCE_MUTE);
  if (key === 'musicVolume' || key === 'sfxVolume') audio.setVolumes?.(settings.musicVolume, settings.sfxVolume);
  if (key === 'lang') setLang(value);
  if (key === 'crt') ctx.view.setCRT(value);
  if (key === 'quality') ctx.view.setQuality(value);
  events.emit('settings:change', { key, value });
});
events.on('cmd:mute', () => events.emit('cmd:setting', { key: 'toggleMute' }));

// ---------------------------------------------------------------------------------------------
// Gameplay reactions
// ---------------------------------------------------------------------------------------------
events.on('enemy:leak', ({ enemy, damage }) => {
  if (!inPlay()) return;
  if (PHOTO) { // showcase board: no CPU damage; the showcase viruses walk the trace again
    if (enemy && photoEnemies.has(enemy)) photoRespawn.push([enemy.type, enemy.pathIndex]);
    return;
  }
  const amount = Math.max(0, damage ?? (enemy && enemy.cpuDamage) ?? 5);
  game.cpu = Math.max(0, game.cpu - amount);
  game.stats.leaks++;
  ctx.map.setCpuIntegrity(game.cpu / GAME.CPU_MAX);
  events.emit('cpu:damage', { amount, cpu: game.cpu, enemy });
  if (game.cpu <= 0) finish('gameover');
});

events.on('enemy:killed', ({ enemy }) => {
  if (!inPlay()) return;
  game.stats.kills++;
  if (enemy && enemy.isBoss) game.stats.bossKills++;
});

events.on('boss:killed', () => hitStop(0.12, 0.15));
events.on('tower:placed', () => { game.stats.towersBuilt++; });
events.on('tower:upgraded', () => { game.stats.upgrades++; });
events.on('heat:overheat', () => { game.stats.overheats++; });

events.on('tower:sold', ({ tower }) => {
  if (selectedTower() === tower) select(null);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && inPlay()) togglePause();
});
// Inside the itch.io iframe the tab stays visible when the player clicks the host page: pause on blur mid-wave.
window.addEventListener('blur', () => {
  if (game.phase === 'wave' && !AUTOPLAY && TURBO === 1) togglePause();
});

// ---------------------------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------------------------
function firstPrepHold() {
  return game.wave === 0 && game.mode === 'campaign' && !settings.tutorialDone && !AUTOPLAY
    && ctx.towers.list.length === 0;
}

function step(dt) {
  if (game.phase === 'menu') { if (attract) attractStep(dt); return; }
  if (!inPlay()) return; // gameover/victory/pause: nothing simulates (the loop also drops the rest of the frame)
  game.time += dt;
  if (game.phase === 'prep') {
    // First game: the wave-1 countdown waits for the first floppy (SPACE / RUN still start it).
    const hold = !PHOTO && firstPrepHold();
    game.prepHold = hold;
    if (!hold && !PHOTO) {
      game.prepTimer -= dt;
      if (game.prepTimer <= 0) startWave();
    }
  }
  if (game.phase === 'wave') ctx.waves.update(dt);
  ctx.heat.update(dt);
  ctx.enemies.update(dt);
  if (!inPlay()) return; // a leak just crashed the CPU
  ctx.towers.update(dt);
  ctx.projectiles.update(dt);
  ctx.economy.update(dt);
  ctx.fx.update(dt);
  if (PHOTO && photoRespawn.length) {
    for (const [type, pi] of photoRespawn.splice(0)) photoSpawn(type, pi, 0);
  }
  if (game.phase === 'wave' && ctx.waves.isDone()) waveCleared();
}

function guardedStep(dt) {
  try { step(dt); } catch (err) { console.error('[loop] step failed', err); }
}

// The boot (POST), BSOD and victory screens are opaque: once they cover the canvas, skip the 3D frame
// (saves GPU/battery; the first boot frames still render so shaders compile behind the BIOS text).
const OPAQUE_AFTER = { boot: 1.5, gameover: 1.6, victory: 1.6 };
let phaseT = 0;
events.on('phase:change', () => { phaseT = 0; });
function render(dt, tm) {
  phaseT += dt;
  if (timeScale < 1) { // hit-stop recovery runs on real time
    if (hsHold > 0) hsHold -= dt;
    else {
      timeScale += (1 - timeScale) * Math.min(1, (dt / 0.4) * 3);
      if (timeScale > 0.995) timeScale = 1;
    }
  }
  try { ctx.map.update(dt, tm); } catch (err) { console.error('[loop] map.update', err); }
  try { ctx.ui.update(dt, tm); } catch (err) { console.error('[loop] ui.update', err); }
  const hideAfter = OPAQUE_AFTER[game.phase];
  if (hideAfter != null && phaseT > hideAfter) return;
  try { ctx.view.render(dt, tm); } catch (err) { console.error('[loop] render', err); }
}

// ---------------------------------------------------------------------------------------------
// Photo mode (?debug=1&photo=1): a full, HUD-less board for the cover image and GIFs. P freezes the sim.
// ---------------------------------------------------------------------------------------------
function photoSpawn(type, pathIndex, dist) {
  try {
    const e = ctx.enemies.spawn(type, pathIndex, { dist, hpMul: 2000, speedMul: 0.15, noSpawnFx: dist > 0 });
    if (e) photoEnemies.add(e);
    return e;
  } catch (err) { console.error('[photo] spawn', err); return null; }
}

function setupPhoto() {
  try { if (ctx.ui && ctx.ui.root && ctx.ui.root.style) ctx.ui.root.style.visibility = 'hidden'; } catch (e) { /* ignore */ }
  ctx.economy.earn(20000, 'debug');
  const layout = [
    ['antivirus', 3, 1], ['antivirus', 5, 2], ['antivirus', 4, 3],
    ['firewall', 8, 1], ['firewall', 13, 2], ['firewall', 12, 3],
    ['defrag', 9, 1], ['defrag', 10, 2], ['defrag', 14, 3],
  ];
  for (const [type, id, level] of layout) {
    const slot = slotById(id);
    const tower = slot && !slot.tower ? ctx.towers.place(type, slot) : null;
    for (let l = 1; tower && l < level; l++) ctx.towers.upgrade(tower);
  }
  const np = Math.max(1, ctx.map.paths.length);
  const mix = ['worm', 'trojan', 'macro', 'macro_mini', 'worm'];
  for (let p = 0; p < Math.min(2, np); p++) {
    mix.forEach((type, i) => photoSpawn(type, p, 6 + i * 3.6 + p * 1.8));
  }
  photoSpawn('boss_melissa', np > 1 ? 1 : 0, 12);
  photoSpawn('boss_iloveyou', 0, 24);
  select(null);
}

// ---------------------------------------------------------------------------------------------
// Attract demo: behind the menu a few floppies fire at a slow trickle of viruses. Only enemies, towers, projectiles
// and fx step (no waves, heat or economy); kills pay nothing, leaks are ignored (inPlay guard) and audio keeps
// gameplay events silent in the menu. newGame()'s resetWorld() clears the board. ?noattract=1 turns it off.
// ---------------------------------------------------------------------------------------------
const ATTRACT_LAYOUT = [['antivirus', 4, 3], ['firewall', 8, 2], ['defrag', 9, 1], ['antivirus', 13, 1], ['firewall', 20, 3]];
const ATTRACT_MIX = ['worm', 'macro', 'worm', 'trojan', 'worm', 'macro'];
const ATTRACT_EVERY = 1.1;   // seconds between demo viruses
const ATTRACT_MAX = 14;      // viruses on the board at most

function startAttract() {
  attract = false;
  if (!ATTRACT || !WEBGL_OK) return;
  try {
    ctx.economy.earn(5000, 'debug');
    for (const [type, id, level] of ATTRACT_LAYOUT) {
      const slot = slotById(id);
      const tower = slot && !slot.tower ? ctx.towers.place(type, slot) : null;
      for (let l = 1; tower && l < level; l++) ctx.towers.upgrade(tower);
    }
    select(null);
    attractT = 0.6;
    attractN = 0;
    attract = true;
  } catch (err) { console.error('[attract] setup', err); }
}

function attractStep(dt) {
  game.time += dt;
  attractT -= dt;
  if (attractT <= 0) {
    attractT = ATTRACT_EVERY;
    if (ctx.enemies.aliveCount() < ATTRACT_MAX) {
      const type = ATTRACT_MIX[attractN % ATTRACT_MIX.length];
      ctx.enemies.spawn(type, attractN % Math.max(1, ctx.map.paths.length), { hpMul: 0.8, rewardMul: 0 });
      attractN++;
    }
  }
  ctx.enemies.update(dt);
  ctx.towers.update(dt);
  ctx.projectiles.update(dt);
  ctx.fx.update(dt);
}

if (PHOTO) {
  // capture phase: P must not reach input.js (pause); it toggles the photo freeze instead
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) photoFreeze = !photoFreeze;
  }, true);
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------
if (WEBGL_OK) {
  ctx.loop = createLoop({
    step: guardedStep,
    render,
    getSpeed: () => (inPlay() && !photoFreeze ? game.speed * TURBO * timeScale : attract && game.phase === 'menu' ? 1 : 0),
    fixed: GAME.FIXED_DT,
    maxSteps: 12 * TURBO,
  });

  // Debug helpers (?debug=1): K = +500 KB, J = kill all viruses, H = start overheat.
  if (DEBUG) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'k') ctx.economy.earn(500, 'debug');
      if (e.key === 'j') for (const en of [...ctx.enemies.list]) ctx.enemies.damage(en, 1e9, null);
      if (e.key === 'h') ctx.heat.start();
    });
  }

  // Start: boot screen (UI), or straight into a game with ?autostart=1 (tests) / ?photo=1.
  if (params.has('autostart') || PHOTO) {
    setPhase('menu');
    newGame(params.get('mode') === 'endless' ? 'endless' : 'campaign');
    if (params.has('speed')) game.speed = Number(params.get('speed')) || 1;
    if (PHOTO) setupPhoto();
  } else {
    events.emit('boot', {});
  }
  if (AUTOPLAY) {
    import('./core/autoplay.js').then((m) => m.startAutoplay(ctx)).catch((err) => console.error('[autoplay]', err));
  }
}
