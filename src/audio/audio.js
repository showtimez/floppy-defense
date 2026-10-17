// adapted from Giocomobile/tempesta-fixart/src/game/audio.js (buses, compressor, per-name throttling, lazy context)
// FLOPPY DEFENSE audio: 100 % WebAudio synthesis, no files. SFX are rendered offline into AudioBuffers (lazily and
// time-sliced after the unlock), music is a tracker-style FM / PC-speaker sequencer on the audio clock.
// Contract: docs/CONTRACTS.md section 5.11. Every public call is a no-op before unlock() and never throws.
import { SFX, renderSfx } from './sfx.js';
import { createMusic } from './music.js';

const SR = 32000;          // offline SFX bank sample rate (lo-fi on purpose, cheap to render)
const VOICE_CAP = 32;      // concurrent SFX voices (+8 headroom for priority sounds)
const SFX_BASE = 1.0;      // bus gain at sfxVolume = 1
const MUSIC_BASE = 0.62;   // bus gain at musicVolume = 1 (music sits well below the SFX)
// kill streak: climbs a minor pentatonic from B5 (the kill recipe's note = the 5th of E minor, the wave track's key)
const KILL_SCALE = [0, 3, 5, 7, 10, 12, 15];
const KILL_WINDOW = 0.6;   // game seconds between two played kills that keep the streak alive (same feel at x1 and x2)
// campaign waves 1-9: wave-track transpose in semitones (waves 1, 4 and 9 all sit in different keys)
const WAVE_TR = [0, 0, 0, 2, 0, 2, 2, 3, 5];
// combat budget: a 1 s sliding count of played combat sounds. Each priority stops playing once the count reaches its
// limit, so the busiest moments keep kills/splits and shed the hit ticks first (the music's lead stays audible).
const COMBAT_PRI = { hit: 0, defragPulse: 1, shootAntivirus: 2, shootFirewall: 3, split: 4, kill: 5 };
const COMBAT_LIMIT = [8, 9, 10, 11, 12, Infinity];
const COMBAT_RING = 48;
const PENDING_MAX = 4, PENDING_TTL = 400; // sounds requested while the context is still starting (ms)

const hasWindow = typeof window !== 'undefined';
const AC = hasWindow ? (window.AudioContext || window.webkitAudioContext) : null;
const EMPTY = {};
const IOS = hasWindow && typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let ac = null;
let master = null, sfxBus = null, musicBus = null, musicDuck = null, musicLp = null;
let music = null;
let muted = false, musicVol = 0.55, sfxVol = 0.8;
let started = false, wantTrack = null, wantOpts = EMPTY, pendingBoot = false, paused = false;
let voices = 0;
let seqTimer = 0, muteTimer = 0, warmQueue = null;
let keyOff = 0;            // semitones: the kill scale follows the key of the music that is playing
let keepAlive = null;      // iOS < 17: a looping silent <audio> puts the page in a 'playback' session
const active = Object.create(null);
const lastAt = Object.create(null);
const bank = Object.create(null);
const rr = Object.create(null);
const combatT = new Float64Array(COMBAT_RING).fill(-99);
let combatI = 0;
const pending = [];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (ac ? ac.currentTime : 0);

// ---------------------------------------------------------------- context & buses
function createContext() {
  if (!AC) return false;
  try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) {
    try { ac = new AC(); } catch (e2) { ac = null; return false; }
  }
  master = ac.createGain();
  master.gain.value = muted ? 0 : 1;
  // DC / sub-sonic blocker before the compressor (no wasted headroom, no pumping on offsets)
  const dcBlock = ac.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 25;
  dcBlock.Q.value = 0.7;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(dcBlock);
  dcBlock.connect(comp);
  comp.connect(ac.destination);
  sfxBus = ac.createGain();
  sfxBus.gain.value = sfxVol * SFX_BASE;
  sfxBus.connect(master);
  musicDuck = ac.createGain();
  musicLp = ac.createBiquadFilter();
  musicLp.type = 'lowpass';
  musicLp.frequency.value = 20000;
  musicLp.Q.value = 0.7;
  musicBus = ac.createGain();
  musicBus.gain.value = musicVol * MUSIC_BASE;
  musicDuck.connect(musicLp);
  musicLp.connect(musicBus);
  musicBus.connect(master);
  try { music = createMusic(ac, musicDuck); } catch (e) { console.warn('[audio] music disabled', e); music = null; }
  seqTimer = setInterval(tickMusic, 50);
  return true;
}

function tickMusic() {
  try {
    if (!ac || !music || muted || ac.state !== 'running') return;
    music.update();
  } catch (e) { /* never throw from a timer */ }
}

function silentKick() { // iOS: a one-sample buffer played inside the gesture unlocks output
  try {
    const b = ac.createBuffer(1, 1, 22050);
    const s = ac.createBufferSource();
    s.buffer = b;
    s.connect(ac.destination);
    s.start(0);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- iOS: play through the ring/silent switch
// Safari 17+: the Audio Session API. Older iOS: WebAudio follows the 'ambient' session (muted by the silent switch)
// until an HTML media element plays, so a looping, code-generated 0.5 s silent WAV keeps the session on 'playback'.
function setPlaybackSession() {
  try { if (hasWindow && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
}
function silentWavUrl(sec = 0.5) {
  const rate = 8000, n = Math.floor(rate * sec), ab = new ArrayBuffer(44 + n), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8-bit unsigned PCM: 128 = silence
  let bin = '';
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < u8.length; i += 0x2000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x2000));
  return 'data:audio/wav;base64,' + btoa(bin);
}
function keepAliveOn() { // must run inside a user gesture the first time
  try {
    if (!IOS || !hasWindow || navigator.audioSession || muted || document.hidden) return;
    if (!keepAlive) {
      keepAlive = document.createElement('audio');
      keepAlive.setAttribute('playsinline', '');
      keepAlive.setAttribute('x-webkit-airplay', 'deny');
      keepAlive.preload = 'auto';
      keepAlive.loop = true;
      keepAlive.src = silentWavUrl(0.5);
    }
    if (keepAlive.paused) { const p = keepAlive.play(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* ignore */ }
}
function keepAliveOff() {
  try { if (keepAlive && !keepAlive.paused) keepAlive.pause(); } catch (e) { /* ignore */ }
}

function onRunning() {
  if (!ac || ac.state !== 'running') return;
  if (!started) {
    started = true;
    startWarmup();
  }
  if (muted) { pending.length = 0; suspendSoon(); return; }
  if (pendingBoot) { pendingBoot = false; sfx('boot'); }
  flushPending();
  // replay the wanted track with its options (rate / section / transpose / level), so a track that was requested
  // while the context was suspended or muted starts at the right tempo and key
  if (wantTrack !== undefined && music && music.current !== wantTrack) music.play(wantTrack, { ...wantOpts, fade: 1.5 });
}

function unlock() {
  try {
    if (!AC) return;
    setPlaybackSession();
    if (!ac && !createContext()) return;
    keepAliveOn();
    if (ac.state !== 'running' && !muted) {
      silentKick();
      if (!(hasWindow && document.hidden)) {
        const p = ac.resume();
        if (p && p.then) p.then(onRunning, () => {});
      }
    }
    onRunning();
  } catch (e) { /* ignore */ }
}

// sounds asked for while the context is still starting (the boot tap -> first sounds) are kept briefly, not dropped
function queuePending(name, opts) {
  if (pending.length >= PENDING_MAX) pending.shift();
  pending.push({ name, opts, t: hasWindow && window.performance ? performance.now() : Date.now() });
}
function flushPending() {
  if (!pending.length) return;
  const q = pending.splice(0, pending.length);
  const t = hasWindow && window.performance ? performance.now() : Date.now();
  for (const p of q) if (t - p.t < PENDING_TTL) sfx(p.name, p.opts);
}

// ---------------------------------------------------------------- the SFX bank
function toBuffer(r) {
  const ch = r.R ? 2 : 1;
  const b = ac.createBuffer(ch, r.L.length, SR);
  b.getChannelData(0).set(r.L);
  if (r.R) b.getChannelData(1).set(r.R);
  return b;
}
function variant(name, i) {
  let arr = bank[name];
  if (!arr) arr = bank[name] = new Array(SFX[name].v);
  if (!arr[i]) {
    const r = renderSfx(name, SR, i);
    if (!r) return null;
    arr[i] = toBuffer(r);
  }
  return arr[i];
}

const WARM_ORDER = [
  'click', 'hover', 'tick', 'error', 'boot', 'diskLoad', 'shootAntivirus', 'hit', 'kill', 'floppyInsert', 'modem',
  'modemShort', 'modemBlip', 'shootFirewall', 'defragPulse', 'kbGain', 'waveClear', 'split', 'leak', 'cpuHit', 'sell',
  'upgrade', 'warn', 'overheat', 'fanSpin', 'cooled', 'latch', 'mailChime', 'bossSpawn', 'bossKill', 'bsod', 'victory',
];
const HEAVY = new Set(['bossSpawn', 'bossKill', 'bsod', 'victory']); // main-thread fallback renders these on demand
function startWarmup() {
  const list = [];
  for (const n of WARM_ORDER) if (SFX[n]) for (let v = 0; v < SFX[n].v; v++) list.push([n, v]);
  for (const n in SFX) if (!WARM_ORDER.includes(n)) for (let v = 0; v < SFX[n].v; v++) list.push([n, v]);
  // preferred: render the whole bank in a worker (zero main-thread hitches); fallback: idle-time slices
  const fallback = () => {
    warmQueue = list.filter(([n, v]) => !HEAVY.has(n) && !(bank[n] && bank[n][v]));
    scheduleWarm();
  };
  let worker = null;
  try {
    if (typeof Worker !== 'undefined') worker = new Worker(new URL('./bank.worker.js', import.meta.url), { type: 'module' });
  } catch (e) { worker = null; }
  if (!worker) { fallback(); return; }
  warmQueue = null;
  music?.inst.setKitPending(true);
  setTimeout(() => music?.inst.setKitPending(false), 5000); // watchdog: never wait forever for the worker's kit
  worker.onmessage = (e) => {
    const d = e.data || EMPTY;
    if (d.done) { worker.terminate(); return; }
    if (d.kit) { try { music?.inst.setKit(d.kit); } catch (err) { music?.inst.setKitPending(false); } return; }
    if (d.kitError) { music?.inst.setKitPending(false); return; }
    if (d.error || !d.L || !SFX[d.name]) return;
    try {
      const arr = bank[d.name] || (bank[d.name] = new Array(SFX[d.name].v));
      if (!arr[d.v]) arr[d.v] = toBuffer(d);
    } catch (err) { /* ignore */ }
  };
  worker.onerror = (e) => {
    try { e.preventDefault?.(); worker.terminate(); } catch (err) { /* ignore */ }
    music?.inst.setKitPending(false);
    fallback();
  };
  worker.postMessage({ sr: SR, list, kit: true });
}
function scheduleWarm() {
  if (!warmQueue || !warmQueue.length) { warmQueue = null; return; }
  if (hasWindow && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warmSlice, { timeout: 250 });
  else setTimeout(warmSlice, 24);
}
function warmSlice(deadline) {
  try {
    const t0 = performance.now();
    const budget = deadline && deadline.timeRemaining ? Math.max(4, Math.min(10, deadline.timeRemaining())) : 6;
    do {
      const item = warmQueue.shift();
      if (!item) break;
      variant(item[0], item[1]);
    } while (warmQueue.length && performance.now() - t0 < budget);
  } catch (e) { /* skip a broken recipe */ }
  scheduleWarm();
}

// ---------------------------------------------------------------- combat budget
function combatCount(t) {
  let c = 0;
  for (let i = 0; i < COMBAT_RING; i++) if (t - combatT[i] < 1) c++;
  return c;
}

// ---------------------------------------------------------------- public API
export function sfx(name, opts) {
  try {
    if (!ac || muted) return false;
    const def = SFX[name];
    if (!def) return false;
    if (ac.state !== 'running') { queuePending(name, opts); return false; }
    const o = opts || EMPTY;
    const t = ac.currentTime + Math.max(0, o.delay || 0);
    if (t - (lastAt[name] ?? -9) < def.gap) return false;
    if ((active[name] || 0) >= def.max) return false;
    if (voices >= VOICE_CAP + (def.pri ? 8 : 0)) return false;
    const cp = COMBAT_PRI[name];
    if (cp !== undefined && combatCount(t) >= COMBAT_LIMIT[cp]) return false;
    const i = o.variant != null ? clamp(o.variant | 0, 0, def.v - 1) : (rr[name] = ((rr[name] ?? Math.floor(Math.random() * def.v)) + 1) % def.v);
    const buf = variant(name, i);
    if (!buf) return false;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const jit = def.jit ? 1 + (Math.random() - 0.5) * 2 * def.jit : 1;
    src.playbackRate.value = clamp((o.pitch ?? 1) * jit, 0.25, 4);
    const g = ac.createGain();
    g.gain.value = clamp(o.volume ?? 1, 0, 2);
    src.connect(g);
    let tail = g, p = null;
    if (o.pan && ac.createStereoPanner) {
      p = ac.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p);
      tail = p;
    }
    tail.connect(sfxBus);
    src.start(t);
    lastAt[name] = t;
    voices++;
    active[name] = (active[name] || 0) + 1;
    if (cp !== undefined) { combatT[combatI] = t; combatI = (combatI + 1) % COMBAT_RING; }
    src.onended = () => {
      voices--;
      active[name]--;
      try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { /* ignore */ }
    };
    return true;
  } catch (e) {
    return false;
  }
}

// semitones of the playing music relative to E minor, folded into [-7, +4] so the kill scale stays in a sane range
function keyFor(track, tr) {
  const k = track === 'wave' ? tr : track === 'boss' ? 3 + tr : 0; // boss track is in D minor (B5 -> D6 = +3)
  return ((k % 12) + 19) % 12 - 7;
}

// opts: { at, fade, rate, section, transpose, level } (see music.play)
function playMusic(track, opts) {
  try {
    const o = opts || EMPTY;
    wantTrack = track || null;
    wantOpts = { rate: o.rate, section: o.section, transpose: o.transpose, level: o.level }; // 'at' is not replayed
    keyOff = keyFor(wantTrack, o.transpose || 0);
    if (!ac || !music || ac.state !== 'running') return;
    music.play(wantTrack, o);
  } catch (e) { /* ignore */ }
}

function setMuted(m) {
  muted = !!m;
  try {
    if (muted) keepAliveOff(); else keepAliveOn();
    if (!ac) return;
    master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.03);
    clearTimeout(muteTimer);
    if (muted) { pending.length = 0; suspendSoon(); }
    else if (ac.state !== 'running' && !(hasWindow && document.hidden)) ac.resume().then(onRunning, () => {});
  } catch (e) { /* ignore */ }
}
// muted: after the fade, suspend the whole context (no audio thread work on phones)
function suspendSoon() {
  clearTimeout(muteTimer);
  muteTimer = setTimeout(() => { try { if (muted && ac && ac.state === 'running') ac.suspend(); } catch (e) { /* ignore */ } }, 150);
}

function setVolumes(mv, sv) {
  try {
    if (Number.isFinite(mv)) musicVol = clamp(mv, 0, 1);
    if (Number.isFinite(sv)) sfxVol = clamp(sv, 0, 1);
    if (!ac) return;
    musicBus.gain.setTargetAtTime(musicVol * MUSIC_BASE, ac.currentTime, 0.05);
    sfxBus.gain.setTargetAtTime(sfxVol * SFX_BASE, ac.currentTime, 0.05);
  } catch (e) { /* ignore */ }
}

// music ducking: pause (muffled + quieter), short ducks under big stings, a brown-out glitch on CPU hits
function setPaused(on) {
  paused = !!on;
  try {
    if (!ac) return;
    const t = ac.currentTime;
    musicDuck.gain.cancelScheduledValues(t);
    musicDuck.gain.setTargetAtTime(paused ? 0.35 : 1, t, 0.08);
    musicLp.frequency.cancelScheduledValues(t);
    musicLp.frequency.setTargetAtTime(paused ? 900 : 20000, t, 0.08);
  } catch (e) { /* ignore */ }
}
function duck(level = 0.4, hold = 1, release = 0.5) {
  try {
    if (!ac || paused) return;
    const t = ac.currentTime;
    musicDuck.gain.cancelScheduledValues(t);
    musicDuck.gain.setTargetAtTime(level, t, 0.05);
    musicDuck.gain.setTargetAtTime(1, t + hold, release / 3);
  } catch (e) { /* ignore */ }
}
function glitch() {
  try {
    if (!ac || paused) return;
    const t = ac.currentTime;
    musicDuck.gain.cancelScheduledValues(t);
    musicDuck.gain.setValueAtTime(0.22, t);
    musicDuck.gain.setTargetAtTime(1, t + 0.09, 0.06);
    musicLp.frequency.cancelScheduledValues(t);
    musicLp.frequency.setValueAtTime(650, t);
    musicLp.frequency.setTargetAtTime(20000, t + 0.1, 0.09);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- central sound mapping
let bound = false;
function bindEvents(events, ctx) {
  if (bound || !events) return;
  bound = true;
  const dbg = !!ctx?.debug;
  // the menu's attract demo runs the real sim behind the menu: its gameplay events stay silent there
  const MENU_QUIET = /^(tower|enemy|boss|kb|combo|cpu|heat|fan|build|upgrade):?/;
  const inMenu = () => ctx?.game?.phase === 'menu';
  const on = (name, fn) => {
    const quiet = MENU_QUIET.test(name);
    events.on(name, (p) => {
      if (quiet && inMenu()) return;
      try { fn(p || EMPTY); } catch (e) { if (dbg) console.warn('[audio]', name, e); } // never break the bus
    });
  };
  let forceMute = false; // ?mute=1: test sessions stay muted whatever the saved setting says
  try { forceMute = !!ctx?.params?.has?.('mute'); } catch (e) { /* ignore */ }
  const st = ctx?.settings;
  if (st) {
    setVolumes(st.musicVolume, st.sfxVolume);
    setMuted(!!st.muted || forceMute);
  }
  const panOf = (pos) => (pos && Number.isFinite(pos.x) ? clamp(pos.x / 12, -1, 1) * 0.55 : 0);
  // the last campaign wave: its clear is the victory moment, so the clear jingle / KB blips stay out of the way
  const isFinalWave = (w) => {
    const g = ctx?.game;
    return !!g && g.mode === 'campaign' && (w ?? g.wave ?? 0) >= (g.totalWaves || 10);
  };
  let killCombo = 0, lastKill = -9, lastTick = 99, finalAt = -9, lastBossKill = -9;

  const bossKilled = () => { if (sfx('bossKill')) { lastBossKill = now(); duck(0.3, 1.6, 0.8); } };

  on('boot', () => { pendingBoot = true; });
  on('menu', () => { pendingBoot = false; if (paused) setPaused(false); playMusic('menu', { fade: 1.5 }); });
  on('game:new', () => { pendingBoot = false; if (paused) setPaused(false); finalAt = -9; sfx('diskLoad', { volume: 0.8 }); });
  // prep: from wave 2 it opens on the section with the melody (heard within ~1.5 s)
  on('wave:prep', ({ wave }) => { lastTick = 99; playMusic('prep', { fade: 1.6, section: (wave | 0) >= 2 ? 1 : 0 }); });
  on('wave:start', ({ wave, isBoss }) => {
    const n = Math.max(1, wave | 0);
    killCombo = 0; lastKill = -9;
    // wave 1 and boss waves get the full dial-up handshake, waves 2-3 the short one, later waves a 0.45 s reconnect
    let name = 'modemBlip', vol = 0.55, len = 0.45;
    if (n === 1 || isBoss) { name = 'modem'; vol = 0.85; len = 2.2; }
    else if (n <= 3) { name = 'modemShort'; vol = 0.6; len = 1.0; }
    sfx(name, { volume: vol });
    // the music "connects" with the modem: prep fades out now, the wave track hits its first downbeat at the end.
    // Escalation: each wave is a little faster, starts on a different section and (campaign) in its own key.
    // Boss waves start on the wave track too: the boss theme drops on the boss sting's impact (boss:spawn).
    const endless = ctx?.game?.mode === 'endless';
    const transpose = endless ? (n % 3) * 2 : (WAVE_TR[n - 1] || 0);
    const rate = Math.min(1.22, 1 + (n - 1) * 0.02);
    playMusic('wave', { at: now() + len, fade: 0.4, rate, section: (n - 1) % 4, transpose, level: n });
  });
  // a boss-kill fanfare (Eb) rings for ~2.4 s: the C-major clear jingle and the KB blips wait for it instead of clashing
  const fanfareLeft = () => { const s = now() - lastBossKill; return s >= 0 && s < 2.4 ? 2.4 - s : 0; };
  on('wave:cleared', ({ wave }) => {
    if (isFinalWave(wave)) { finalAt = now(); return; } // the victory handler owns this moment
    sfx('waveClear', { delay: fanfareLeft() });
  });
  on('kb:change', ({ delta, reason }) => {
    if (!(delta > 0) || reason === 'kill' || reason === 'sell' || reason === 'debug' || reason === 'reset') return;
    // wave bonus + interest arrive just before audio sees wave:cleared (economy listens first): land after the jingle
    if (reason === 'wave' || reason === 'interest') {
      if (!isFinalWave()) sfx('kbGain', { delay: fanfareLeft() + 0.45, volume: 0.9 });
      return;
    }
    // other gains (early call, CACHE HIT combos) can be flushed by the very kill that ends the game: decide at the end
    // of this task, once the boss kill / final clear handlers have run
    Promise.resolve().then(() => {
      if (now() - finalAt < 3 || fanfareLeft() > 0) return;
      sfx('kbGain', { volume: 0.9 });
    });
  });

  on('tower:placed', ({ tower }) => sfx('floppyInsert', { pan: panOf(tower?.pos) }));
  on('tower:upgraded', ({ tower }) => sfx('upgrade', { pan: panOf(tower?.pos), pitch: (tower?.level || 2) >= 3 ? 1.12 : 1 }));
  on('tower:sold', ({ tower }) => sfx('sell', { pan: panOf(tower?.pos) }));
  on('tower:targeting', () => sfx('click'));
  const SHOT = { antivirus: 'shootAntivirus', firewall: 'shootFirewall', defrag: 'defragPulse' };
  const SHOT_VOL = { shootAntivirus: 0.55, shootFirewall: 0.75, defragPulse: 0.5 };
  on('tower:fire', ({ tower }) => {
    const n = SHOT[tower?.type];
    if (!n) return;
    const lv = clamp(tower.level || 1, 1, 3);
    sfx(n, { pitch: 1 + (lv - 1) * 0.06, volume: SHOT_VOL[n] + (lv - 1) * 0.08, pan: panOf(tower.pos) });
  });

  // the scan bolt's own shot already says "hit": tick only for firewall / defrag / burn damage
  on('enemy:hit', ({ enemy, by }) => { if (by?.type !== 'antivirus') sfx('hit', { volume: 0.6, pan: panOf(enemy?.pos) }); });
  const gameTime = () => (Number.isFinite(ctx?.game?.time) ? ctx.game.time : now());
  on('enemy:killed', ({ enemy }) => {
    if (enemy?.isBoss) { bossKilled(); return; }
    const t = gameTime();
    const dt = t - lastKill;
    const step = dt >= 0 && dt < KILL_WINDOW ? Math.min(killCombo + 1, KILL_SCALE.length - 1) : 0;
    // the streak only advances on kills that were actually heard (dropped ones don't skip scale steps)
    if (sfx('kill', { pitch: Math.pow(2, (KILL_SCALE[step] + keyOff) / 12), pan: panOf(enemy?.pos), volume: 0.9 })) {
      killCombo = step;
      lastKill = t;
    }
  });
  on('boss:killed', () => bossKilled()); // gap-throttled: no double with enemy:killed
  on('enemy:split', ({ parent }) => sfx('split', { pan: panOf(parent?.pos) }));
  on('boss:summon', ({ enemy }) => {
    sfx('split', { pitch: 1.4, volume: 0.9, pan: panOf(enemy?.pos) });
    sfx('mailChime', { volume: 0.85, pan: panOf(enemy?.pos) * 0.5, delay: 0.06 });
  });
  on('enemy:leak', ({ enemy }) => sfx('leak', { pan: panOf(enemy?.pos), volume: 0.8 }));
  let lastCpu = 100;
  on('cpu:damage', ({ amount, cpu }) => {
    // danger outranks rewards: never quieter than the wave-clear jingle, louder for big hits
    sfx('cpuHit', { volume: 1 + Math.min(0.25, (amount || 0) / 40) });
    glitch();
    // "CPU integrity critical": a low warning when crossing 30 % and 15 %
    if (Number.isFinite(cpu) && cpu > 0 && ((cpu <= 30 && lastCpu > 30) || (cpu <= 15 && lastCpu > 15))) sfx('warn', { pitch: 0.7, delay: 0.35 });
    if (Number.isFinite(cpu)) lastCpu = cpu;
  });
  on('game:new', () => { lastCpu = 100; });
  // the boss theme drops exactly on the sting's impact (+2.35 s); the wave track fades out under the riser
  on('boss:spawn', ({ enemy }) => {
    if (sfx('bossSpawn')) duck(0.6, 1, 0.5);
    const w = ctx?.game?.wave | 0;
    const ilu = enemy?.type ? enemy.type === 'boss_iloveyou' : w >= 10;
    playMusic('boss', { at: now() + 2.35, fade: 2.0, rate: w >= 10 ? 1.05 : 1, transpose: ilu ? 3 : 0 });
  });

  on('heat:warning', () => sfx('warn'));
  on('heat:overheat', () => sfx('overheat'));
  on('heat:cooled', () => sfx('cooled'));
  on('fan:cool', () => sfx('fanSpin'));
  on('fan:click', () => sfx('fanSpin', { volume: 0.8 }));

  on('build:failed', () => sfx('error'));
  on('upgrade:failed', () => sfx('error'));
  on('selection:change', ({ selected }) => { if (selected) sfx('click', { volume: 0.7 }); });
  on('speed:change', ({ speed }) => sfx('click', { pitch: speed > 1 ? 1.5 : 1 }));

  on('gameover', () => {
    setPaused(false);
    playMusic(null, { fade: 0.05 }); // the crash cuts the music dead
    sfx('bsod');
    playMusic('gameover', { at: now() + 2.7, fade: 2 });
  });
  on('victory', () => {
    setPaused(false);
    playMusic(null, { fade: 0.6 });
    // one moment, in order: the boss-kill fanfare (Eb) resolves into the Eb victory pad, then the Eb victory loop.
    // If the boss died a while ago, don't make the player wait for a fanfare that already finished.
    const since = now() - lastBossKill;
    const d = since >= 0 && since < 1.4 ? 1.4 - since : 0.3;
    sfx('victory', { delay: d, volume: d > 0.3 ? 0.8 : 1 }); // under the fanfare's tail: keep the sum below -3 dBFS
    playMusic('victory', { at: now() + d + 3.8, fade: 0.5, transpose: 3 });
  });
  on('pause', () => setPaused(true));
  on('resume', () => setPaused(false));
  on('settings:change', ({ key, value }) => {
    if (key === 'muted') setMuted(value || forceMute); // ?mute=1 (tests) always wins, like main.js
    if (key === 'musicVolume') setVolumes(value, undefined);
    if (key === 'sfxVolume') setVolumes(undefined, value);
  });

  // countdown beeps in the last 3 s of prep (reads game.prepTimer; cheap interval)
  setInterval(() => {
    try {
      const g = ctx?.game;
      if (!g || g.phase !== 'prep') { if (g && g.phase !== 'paused') lastTick = 99; return; }
      const s = Math.ceil(g.prepTimer);
      if (s >= 1 && s <= 3 && s < lastTick) { lastTick = s; sfx('tick', { pitch: s === 1 ? 1.5 : 1 }); }
    } catch (e) { /* ignore */ }
  }, 100);

  // unlock on the first gesture anywhere (UI also calls unlock()); iOS needs touchend
  if (hasWindow) {
    const gesture = () => { if (!ac || (!muted && ac.state !== 'running') || (keepAlive && keepAlive.paused && !muted)) unlock(); };
    const opt = { capture: true, passive: true };
    for (const ev of ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click']) window.addEventListener(ev, gesture, opt);
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden) keepAliveOff(); else if (!muted) keepAliveOn();
        if (!ac) return;
        if (document.hidden) { if (ac.state === 'running') ac.suspend(); } else if (started && !muted) ac.resume().then(onRunning, () => {});
      } catch (e) { /* ignore */ }
    });
  }
}

export const audio = {
  unlock,
  sfx,
  music: playMusic,
  setMuted,
  setVolumes,
  bindEvents,
  get muted() { return muted; },
  set muted(v) { setMuted(v); },
  // extras (optional for other modules)
  get ready() { return !!ac && ac.state === 'running'; },
  get context() { return ac; },
  get track() { return music ? music.current : null; },
  duck,
  glitch,
  stopMusic(fade = 0.6) { playMusic(null, { fade }); },
  stats() {
    return {
      state: ac ? ac.state : 'none', voices, musicVoices: music ? music.voices : 0, track: music ? music.current : null,
      banked: Object.keys(bank).length, warmLeft: warmQueue ? warmQueue.length : 0, combat1s: ac ? combatCount(ac.currentTime) : 0,
      pending: pending.length, keyOff, keepAlive: !!(keepAlive && !keepAlive.paused), music: music ? music.state : null,
    };
  },
};

export default audio;
