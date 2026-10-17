// HUD: DOS status bar (wave / MEM / CPU / timer), control buttons, heat gauge, boss bar,
// next-wave preview + RUN button, bottom hint line.
import { t } from '../core/i18n.js';
import { GAME } from '../config.js';
import { h, setText, show, icon, setIcon, pad2, pulse, applyI18n } from './dom.js';
import { spriteImg, enemyLook } from './sprites.js';
import { ENEMIES } from '../data/enemies.js';

// Session-level memory (survives restarts): which entry ports / virus types the player has already
// been shown in a NEXT WAVE preview. First sightings get a blinking NEW badge.
const seenPorts = new Set();
const seenTypes = new Set();

const docEl = document.documentElement;
const fsSupported = () => {
  try {
    return !!((document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
      (docEl.requestFullscreen || docEl.webkitRequestFullscreen));
  } catch (e) { return false; }
};
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

function toggleFullscreen() {
  try {
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const p = exit && exit.call(document);
      if (p && p.catch) p.catch(() => {});
    } else {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
      const p = req && req.call(docEl, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

export function heatTemp(level) {
  return Math.round(40 + Math.max(0, Math.min(1, level || 0)) * 55);
}

// Prefer the heat module's own temperature (keeps HUD, banners and any world label in sync).
export function heatTempOf(U, ha) {
  const tp = U.ctx.heat?.temperature;
  return typeof tp === 'number' && isFinite(tp) ? Math.round(tp) : heatTemp(ha && ha.level);
}

export function createHud(U) {
  const { game, settings } = U;
  const g = game;

  // ---------------------------------------------------------------- top bar
  const seg = (cls, lblKey) => {
    const lbl = h('span', { class: 'lbl', t: lblKey });
    const val = h('span', { class: 'val' });
    const el = h('span', { class: `hs-seg ${cls}` }, lbl, val);
    return { el, lbl, val };
  };
  const wave = seg('hs-wave', 'hud.wave');
  const mem = seg('hs-mem', 'hud.mem');
  const memDelta = h('span', { class: 'hs-delta' });
  mem.el.append(memDelta);
  const cpu = seg('hs-cpu', 'hud.cpu');
  const cpuBar = h('span', { class: 'hs-cpubar', 'aria-hidden': 'true' }, h('i'));
  cpu.el.append(cpuBar);
  const timer = h('span', { class: 'hs-seg hs-timer' });

  const heatTxt = h('span', { class: 'hh-txt' });
  const heatFill = h('i');
  const heat = h('span', { class: 'hud-heat is-hidden' }, h('span', { class: 'hh-ico' }, '\u2668\ufe0e'), heatTxt,
    h('span', { class: 'hh-bar' }, heatFill));

  const mkBtn = (cls, titleKey, ico, fn, silent = false) => {
    const ic = icon(ico);
    const b = h('button', { class: `ui-hit hbtn ${cls}`, tabindex: '-1', 'data-t-title': titleKey, title: t(titleKey), 'aria-label': t(titleKey) }, ic);
    b.addEventListener('click', (e) => { e.currentTarget.blur(); if (!silent) U.sfx('click'); fn(); });
    return { b, ic };
  };
  const speedTxt = h('span', { class: 'hbtn-txt' }, 'x1');
  const bSpeed = mkBtn('hb-speed', 'hud.speed', 'ff', () => U.emit('cmd:speed'), true);
  bSpeed.b.append(speedTxt);
  const bPause = mkBtn('hb-pause', 'hud.pause', 'pause', () => U.emit('cmd:pause'));
  const bMute = mkBtn('hb-mute', 'hud.mute', 'sound', () => U.emit('cmd:mute'));
  const bFs = mkBtn('hb-fs', 'hud.fullscreen', 'fs', toggleFullscreen);

  // OVERCLOCK (heat.overclock from systems): wave-only, cooldown fill, red while active.
  const ocLbl = h('span', { class: 'oc-lbl' }, t(U.isTouch ? 'hud.ocTouch' : 'hud.oc'));
  const ocFill = h('i');
  const bOc = h('button', { class: 'ui-hit hbtn hb-oc is-hidden', tabindex: '-1', 'data-t-title': 'hud.ocTip', title: t('hud.ocTip'), 'aria-label': t('hud.ocTip') },
    ocLbl, h('span', { class: 'oc-bar', 'aria-hidden': 'true' }, ocFill));
  let ocHeard = false;
  // Feedback comes from heat's own events, so the T key and the button sound the same.
  bOc.addEventListener('click', (e) => {
    e.currentTarget.blur();
    ocHeard = false;
    U.emit('cmd:overclock');
    if (!ocHeard) { if (ocState()?.active) ocFeedback(); else ocDenied(); }
  });
  U.events.on('overclock:on', () => { ocHeard = true; ocFeedback(); });
  U.events.on('overclock:denied', () => { ocHeard = true; ocDenied(); });
  function ocFeedback() {
    U.sfx('fanSpin', { pitch: 1.5 });
    pulse(bOc, KF_OC, { duration: 500, easing: 'ease-out' });
  }
  function ocDenied() {
    if (!ocShown) return;
    U.sfx('error', { volume: 0.6 });
    pulse(bOc, KF_NOPE, { duration: 320, easing: 'ease-out' });
  }
  function ocState() {
    try { return typeof U.ctx.heat?.overclock === 'function' ? U.ctx.heat.overclockState || null : null; } catch (e) { return null; }
  }
  if (!fsSupported()) bFs.b.classList.add('is-hidden');
  const onFs = () => setIcon(bFs.ic, fsElement() ? 'fsExit' : 'fs');
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  const top = h('div', { class: 'hud-top' },
    h('div', { class: 'hud-status' }, h('span', { class: 'hs-prompt' }, 'C:\\>'), wave.el, mem.el, cpu.el, timer, heat),
    h('div', { class: 'hud-btns' }, bOc, bSpeed.b, bPause.b, bMute.b, bFs.b));

  // ---------------------------------------------------------------- boss bar
  const bossName = h('span', { class: 'bb-name' });
  const bossFill = h('i');
  const bossPct = h('span', { class: 'bb-pct' });
  const bossArt = h('span', { class: 'bb-art' });
  const boss = h('div', { class: 'hud-boss is-hidden' }, bossArt, bossName,
    h('span', { class: 'bb-bar' }, bossFill), bossPct);

  // ---------------------------------------------------------------- prep panel (next wave + RUN)
  const npHead = h('div', { class: 'np-head' });
  const npVia = h('div', { class: 'np-via' });
  const npList = h('div', { class: 'np-list' });
  const np = h('div', { class: 'np' }, npHead, npVia, npList);
  const runLabel = h('span', { class: 'run-label' });
  const runBonus = h('span', { class: 'run-bonus' });
  const runFill = h('i');
  const run = h('button', { class: 'ui-hit run', tabindex: '-1' }, h('span', { class: 'run-txt' }, runLabel, runBonus),
    h('span', { class: 'run-bar' }, runFill));
  run.addEventListener('click', (e) => { e.currentTarget.blur(); U.sfx('click'); U.emit('cmd:nextWave'); });
  const prep = h('div', { class: 'hud-prep is-hidden' }, np, run);

  // ---------------------------------------------------------------- hint line
  const hint = h('div', { class: 'hud-hint' });

  const el = h('div', { class: 'hud is-hidden' }, top, boss, prep, hint);

  // ---------------------------------------------------------------- state
  let shownKb = g.kb;
  let lastKbInt = -1;
  let lastWave = -1, lastTotal = -1, lastMode = '';
  let lastCpu = -1;
  let lastTimer = -1;
  let lastAlive = -1;
  let lastBonus = -1;
  let lastRunQ = -1;
  let lastHint = '';
  let lastHintSpot = null;
  let bossEnemy = null;
  let lastBossPct = -1;
  let lastHeatTemp = -1;
  let lastSpeed = -1;
  let lastMuted = null;
  let deltaTimer = 0;
  let pendingDelta = 0;
  let lastHold = false;
  let ocShown = false, ocActive = null, ocCdQ = -1, ocDisabled = null;
  const prepNewTypes = new Set(); // first sightings in the current prep (kept for re-renders)
  const prepNewPorts = new Set();

  const pathCount = () => Math.max(1, (U.ctx.map && U.ctx.map.paths && U.ctx.map.paths.length) || 2);
  const portName = (i) => {
    const p = U.ctx.map && U.ctx.map.ports && U.ctx.map.ports[i];
    return (p && p.name) || `COM${i + 1}`;
  };
  // Path field of a waves.json group -> port indices ('alt'/'both'/'rand' use every port).
  function portsOfPath(path, out) {
    if (typeof path === 'number' && isFinite(path)) out.add(Math.min(pathCount() - 1, Math.max(0, Math.floor(path))));
    else for (let i = 0; i < pathCount(); i++) out.add(i);
    return out;
  }
  function waveData(n) {
    let info = null, def = null;
    try { info = U.ctx.waves?.info?.(n) || null; } catch (e) { info = null; }
    try { def = U.ctx.waves?.def?.(n) || null; } catch (e) { def = null; }
    return { info, def };
  }
  function wavePorts(def) {
    const set = new Set();
    for (const gr of (def && def.groups) || []) if (gr) portsOfPath(gr.path, set);
    return [...set].sort((a, b) => a - b);
  }

  // Called on wave:prep: records first sightings, returns the virus types never seen before (wave >= 2).
  function onWavePrep(n) {
    prepNewTypes.clear();
    prepNewPorts.clear();
    const { info, def } = waveData(n);
    const fresh = [];
    for (const gr of (info && info.groups) || []) {
      if (!gr || !gr.type || seenTypes.has(gr.type)) continue;
      seenTypes.add(gr.type);
      if (n >= 2) { prepNewTypes.add(gr.type); fresh.push(gr.type); }
    }
    for (const pi of wavePorts(def)) {
      if (seenPorts.has(pi)) continue;
      seenPorts.add(pi);
      if (n >= 2) prepNewPorts.add(pi);
    }
    return fresh;
  }
  function onWaveStart() { prepNewTypes.clear(); prepNewPorts.clear(); }

  function setNextWave() {
    const n = g.wave + 1;
    const { info, def } = waveData(n);
    npHead.textContent = '';
    npVia.textContent = '';
    npList.textContent = '';
    const wname = info && info.name && !/^ENDLESS\b/i.test(info.name) ? ` \u00b7 ${info.name}` : '';
    npHead.append(h('span', { class: 'np-title' }, t('hud.next', { n: pad2(n) }) + wname));
    const isBoss = !!(info && info.isBoss);
    np.classList.toggle('is-boss', isBoss);
    if (isBoss) {
      let via = '';
      const bg = ((def && def.groups) || []).find((gr) => gr && ENEMIES[gr.type] && ENEMIES[gr.type].boss);
      if (bg) via = ` \u00b7 ${[...portsOfPath(bg.path, new Set())].map(portName).join('+')}`;
      npHead.append(h('span', { class: 'np-boss' }, icon('warn'), ' ', (info.bossName || t('hud.bossWave')) + via));
    }
    // VIA > COM1 + COM2 (NEW badge on a port never used before)
    const ports = wavePorts(def);
    show(npVia, ports.length > 0);
    if (ports.length) {
      const parts = t('hud.via', { ports: '\u0001' }).split('\u0001');
      npVia.append(parts[0]);
      ports.forEach((pi, k) => {
        if (k) npVia.append(' + ');
        npVia.append(h('span', { class: 'np-port' }, portName(pi)));
        if (prepNewPorts.has(pi)) npVia.append(h('span', { class: 'np-new' }, t('hud.new')));
      });
      if (parts[1]) npVia.append(parts[1]);
    }
    const agg = new Map();
    for (const gr of (info && info.groups) || []) {
      if (!gr || !gr.type) continue;
      agg.set(gr.type, (agg.get(gr.type) || 0) + (Number(gr.count) || 0));
    }
    if (!agg.size) {
      npList.append(h('span', { class: 'np-unknown' }, t('hud.unknown')));
      return;
    }
    for (const [type, count] of agg) {
      const look = enemyLook(type);
      npList.append(h('span', { class: `np-item ${type.startsWith('boss') ? 'is-boss' : ''}`, title: t('enemy.' + type) },
        spriteImg(look.sprite, look.color, 'spr spr-sm'),
        h('span', { class: 'np-count' }, `\u00d7${count}`),
        h('span', { class: 'np-name' }, t('enemy.' + type)),
        prepNewTypes.has(type) ? h('span', { class: 'np-new' }, t('hud.new')) : null));
    }
  }

  function setBoss(enemy) {
    bossEnemy = enemy || null;
    lastBossPct = -1;
    U.root.classList.toggle('has-boss', !!bossEnemy);
    if (bossEnemy) {
      const type = bossEnemy.type || '';
      const name = bossEnemy.name || (type ? t('enemy.' + type) : 'BOSS');
      setText(bossName, name);
      const look = enemyLook(type || 'boss_melissa');
      bossArt.textContent = '';
      bossArt.append(spriteImg(look.sprite, look.color, 'spr spr-sm'));
      show(boss, true);
      pulse(boss, [{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 300 });
    } else show(boss, false);
  }

  // One-shot flashes use the Web Animations API (no forced reflow on frequent kb:change events).
  const KF_UP = [{ color: '#ffffff', textShadow: '0 0 10px #39ff6a, 0 0 2px #fff' }, { color: '#c4ffd2' }];
  const KF_DOWN = [{ color: '#ff3b30', textShadow: '0 0 10px #ff3b30' }, { color: '#c4ffd2' }];
  // the +/- tag sits under the MEM value (the bar is at the top edge): pops out of it and drifts down
  const KF_DELTA = [
    { opacity: 0, transform: 'translateY(-5px) scale(0.8)' },
    { opacity: 1, transform: 'translateY(0) scale(1.15)', offset: 0.15 },
    { opacity: 1, transform: 'translateY(1px) scale(1)', offset: 0.7 },
    { opacity: 0, transform: 'translateY(5px) scale(1)' },
  ];
  const KF_SHAKE = [
    { transform: 'translateX(0)', color: '#ff3b30' }, { transform: 'translateX(-3px)', offset: 0.2 },
    { transform: 'translateX(3px)', offset: 0.4 }, { transform: 'translateX(-2px)', offset: 0.6 }, { transform: 'translateX(0)' },
  ];
  const KF_NOPE = [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)', offset: 0.25 }, { transform: 'translateX(3px)', offset: 0.5 }, { transform: 'translateX(-2px)', offset: 0.75 }, { transform: 'translateX(0)' }];
  const KF_OC = [{ boxShadow: '0 0 0 3px rgba(255,59,48,0.9), 0 0 24px rgba(255,59,48,0.9)' }, { boxShadow: '0 0 0 0 rgba(255,59,48,0)' }];
  const KF_BAR = [{ borderBottomColor: '#ff3b30', boxShadow: '0 3px 22px rgba(255,59,48,0.6)' }, { borderBottomColor: 'rgba(57,255,106,0.55)' }];

  function onKb({ delta, reason }) {
    if (!delta) return;
    pulse(mem.val, delta > 0 ? KF_UP : KF_DOWN, { duration: delta > 0 ? 450 : 550, easing: 'ease-out' });
    // Delta tag for meaningful changes (kills are frequent: accumulate them into one tag)
    pendingDelta = (deltaTimer > 0 ? pendingDelta : 0) + delta;
    deltaTimer = 1.1;
    if (reason !== 'kill' || Math.abs(pendingDelta) >= 5) {
      setText(memDelta, `${pendingDelta > 0 ? '+' : ''}${Math.round(pendingDelta)}`);
      memDelta.classList.toggle('neg', pendingDelta < 0);
      pulse(memDelta, KF_DELTA, { duration: 1100, easing: 'ease-out' });
    }
  }

  function onCpuDamage() {
    pulse(cpu.el, KF_SHAKE, { duration: 450, easing: 'ease-out' });
    pulse(top, KF_BAR, { duration: 550, easing: 'ease-out' });
  }

  function reset() {
    shownKb = g.kb;
    lastKbInt = -1;
    lastWave = -1;
    lastCpu = -1;
    lastTimer = -1;
    lastAlive = -1;
    lastBonus = -1;
    lastHint = '';
    deltaTimer = 0;
    setText(memDelta, '');
    setBoss(null);
    show(heat, false);
    lastHeatTemp = -1;
  }

  // Hint keys are constant strings (no per-frame string building).
  // (U.isTouch can flip to true on the first real touch, so the set is picked per call)
  const HINTS_TOUCH = { heat: 'hint.heat.touch', slot: 'hint.slot.touch', tower: 'hint.tower.touch', wave: 'hint.wave.touch', prep: 'hint.prep.touch', hold: 'hint.hold' };
  const HINTS_DESK = { heat: 'hint.heat', slot: 'hint.slot', tower: 'hint.tower', wave: 'hint.wave', prep: 'hint.prep', hold: 'hint.hold' };
  let hintSpot = null;
  function hintKey() {
    const HINTS = U.isTouch ? HINTS_TOUCH : HINTS_DESK;
    const sel = g.selected;
    const ha = U.ctx.heat?.active;
    if (ha && ha.spot && (ha.overheated || ha.level >= 0.5)) { hintSpot = ha.spot; return HINTS.heat; }
    if (sel && sel.kind === 'slot') return HINTS.slot;
    if (sel && sel.kind === 'tower') return HINTS.tower;
    if (g.phase === 'wave') return HINTS.wave;
    if (g.phase === 'prep' && g.prepHold) return HINTS.hold;
    return HINTS.prep;
  }

  function update(dt) {
    // KB counter animates toward the real value
    const kb = g.kb;
    const diff = kb - shownKb;
    shownKb = Math.abs(diff) < 0.5 ? kb : shownKb + diff * Math.min(1, dt * 10);
    const kbInt = Math.round(shownKb);
    if (kbInt !== lastKbInt) { lastKbInt = kbInt; setText(mem.val, `${kbInt}KB`); }
    if (deltaTimer > 0) { deltaTimer -= dt; if (deltaTimer <= 0) { pendingDelta = 0; } }

    // wave
    const total = g.mode === 'endless' ? 0 : (g.totalWaves || GAME.TOTAL_WAVES);
    // while paused, show what was on screen before the pause (prep countdown or virus count)
    const ph = g.phase === 'paused' ? (g.prevPhase || 'wave') : g.phase;
    const w = ph === 'prep' ? g.wave + 1 : Math.max(1, g.wave);
    if (w !== lastWave || total !== lastTotal || g.mode !== lastMode) {
      lastWave = w; lastTotal = total; lastMode = g.mode;
      setText(wave.val, total ? `${pad2(w)}/${pad2(total)}` : `${pad2(w)}/\u221e`);
    }

    // CPU
    const c = Math.max(0, Math.round(g.cpu));
    if (c !== lastCpu) {
      lastCpu = c;
      setText(cpu.val, `${c}%`);
      cpu.el.classList.toggle('is-amber', c < 60 && c >= 30);
      cpu.el.classList.toggle('is-red', c < 30);
      cpuBar.firstChild.style.transform = `scaleX(${c / GAME.CPU_MAX})`;
    }

    // timer / viruses
    if (ph === 'prep') {
      const s = Math.max(0, Math.ceil(g.prepTimer));
      if (s !== lastTimer || lastAlive !== -2) {
        lastTimer = s; lastAlive = -2;
        setText(timer, t('hud.timer', { s: pad2(s) }));
        timer.classList.toggle('is-urgent', s <= 3);
      }
      const hold = !!g.prepHold;
      if (hold !== lastHold) { lastHold = hold; timer.classList.toggle('is-hold', hold); }
      const bonus = Math.max(0, Math.floor(g.prepTimer)) * GAME.EARLY_CALL_KB_PER_SEC;
      if (bonus !== lastBonus) {
        lastBonus = bonus;
        setText(runLabel, t(g.wave === 0 ? 'hud.runFirst' : 'hud.run'));
        setText(runBonus, bonus > 0 ? ` ${t('hud.runBonus', { kb: bonus })}` : '');
      }
      const k = g.prepDuration > 0 ? Math.max(0, Math.min(1, g.prepTimer / g.prepDuration)) : 0;
      const kq = Math.round(k * 400);
      if (kq !== lastRunQ) { lastRunQ = kq; runFill.style.transform = `scaleX(${kq / 400})`; }
    } else if (ph === 'wave') {
      let alive = 0;
      try { alive = U.ctx.enemies?.aliveCount?.() || 0; } catch (e) { alive = 0; }
      if (alive !== lastAlive) {
        lastAlive = alive;
        lastTimer = -1;
        setText(timer, t('hud.viruses', { n: pad2(alive) }));
        timer.classList.remove('is-urgent');
        if (lastHold) { lastHold = false; timer.classList.remove('is-hold'); }
      }
    }

    // heat gauge
    const ha = U.ctx.heat?.active;
    if (ha && ha.spot) {
      const temp = heatTempOf(U, ha);
      if (temp !== lastHeatTemp || heat.classList.contains('is-hidden')) {
        lastHeatTemp = temp;
        show(heat, true);
        setText(heatTxt, t('hud.heat', { spot: ha.spot.name || String(ha.spot.id || '').toUpperCase(), temp }));
        heatFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ha.level || 0)).toFixed(3)})`;
      }
      heat.classList.toggle('is-hot', !!ha.overheated);
      heat.classList.toggle('is-warm', !ha.overheated && ha.level >= 0.5);
    } else if (!heat.classList.contains('is-hidden')) {
      show(heat, false);
      lastHeatTemp = -1;
    }

    // boss
    if (bossEnemy) {
      const alive = bossEnemy.alive !== false && bossEnemy.hp > 0;
      if (!alive) setBoss(null);
      else {
        const pct = Math.max(0, Math.min(100, Math.ceil((bossEnemy.hp / (bossEnemy.maxHp || 1)) * 100)));
        if (pct !== lastBossPct) {
          lastBossPct = pct;
          bossFill.style.transform = `scaleX(${pct / 100})`;
          setText(bossPct, `${pct}%`);
        }
      }
    }

    // buttons
    if (g.speed !== lastSpeed) {
      lastSpeed = g.speed;
      setText(speedTxt, `x${g.speed}`);
      bSpeed.b.classList.toggle('is-on', g.speed > 1);
    }
    const muted = !!settings.muted;
    if (muted !== lastMuted) {
      lastMuted = muted;
      setIcon(bMute.ic, muted ? 'muted' : 'sound');
      bMute.b.classList.toggle('is-off', muted);
    }
    bPause.b.classList.toggle('is-on', g.phase === 'paused');
    updateOc(ph);

    // hint
    const hk = hintKey();
    const hs = hk === HINTS_TOUCH.heat || hk === HINTS_DESK.heat ? hintSpot : null;
    if (hk !== lastHint || hs !== lastHintSpot) {
      lastHint = hk;
      lastHintSpot = hs;
      const spot = hs ? hs.name || String(hs.id || '').toUpperCase() : '';
      setText(hint, (U.isTouch ? '' : '> ') + t(hk, { spot }));
      hint.classList.toggle('is-hold', hk === 'hint.hold');
    }
  }

  function updateOc(ph) {
    const st = ph === 'wave' ? ocState() : null;
    const want = !!st;
    if (want !== ocShown) { ocShown = want; show(bOc, want); ocActive = null; ocCdQ = -1; ocDisabled = null; }
    if (!st) return;
    const active = !!st.active;
    if (active !== ocActive) { ocActive = active; bOc.classList.toggle('is-active', active); }
    const cdMax = st.cdMax > 0 ? st.cdMax : 30;
    const cd = Math.max(0, Math.min(cdMax, st.cd || 0));
    const q = active ? 0 : Math.round((1 - cd / cdMax) * 200);
    if (q !== ocCdQ) {
      ocCdQ = q;
      bOc.classList.toggle('is-cd', !active && cd > 0);
      ocFill.style.transform = `scaleX(${q / 200})`;
    }
    const disabled = g.phase !== 'wave' || (!active && cd > 0);
    if (disabled !== ocDisabled) { ocDisabled = disabled; bOc.classList.toggle('is-disabled', disabled); }
  }

  function onPhase(to) {
    const inGame = to === 'prep' || to === 'wave' || to === 'paused';
    show(el, inGame);
    show(prep, to === 'prep');
    el.dataset.phase = to;
    if (to === 'prep') lastBonus = -1;
    if (to === 'menu' || to === 'boot') setBoss(null);
  }

  function relang() {
    applyI18n(el);
    setText(ocLbl, t(U.isTouch ? 'hud.ocTouch' : 'hud.oc'));
    lastWave = -1; lastTimer = -1; lastAlive = -1; lastBonus = -1; lastHint = ''; lastHintSpot = null; lastHeatTemp = -1;
    setNextWave();
    if (bossEnemy) setBoss(bossEnemy);
  }

  return {
    el, update, onPhase, relang, reset, setNextWave, setBoss, onKb, onCpuDamage, onWavePrep, onWaveStart,
    runButton: run,
  };
}
