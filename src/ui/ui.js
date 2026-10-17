// UI module entry: DOM overlay inside #ui (DOS / Win9x look). See docs/CONTRACTS.md §5.10.
// Screens: boot, menu, HUD, build popup, tower panel, banners, tutorial, pause, BSOD, victory.
import './ui.css';
import { t, getLang } from '../core/i18n.js';
import { GAME } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { h } from './dom.js';
import { createBoot } from './boot.js';
import { createMenu } from './menu.js';
import { createHud } from './hud.js';
import { createPopups } from './popups.js';
import { createNotify } from './notify.js';
import { createTutorial } from './tutorial.js';
import { createScreens } from './screens.js';
import { towerCost } from './towerinfo.js';

const BROWSER_KEY = /^F\d{1,2}$/;

export function createUI(ctx) {
  const { events, game, settings } = ctx;
  const host = document.getElementById('ui') || ctx.container || document.body;

  // Touch layout only for touch-first devices: a Windows touchscreen laptop driven with a mouse keeps
  // the desktop layout (keyboard hints) until it is actually touched (see the pointerdown below).
  const isTouch = (() => {
    try {
      return !!(ctx.view?.isMobile) || matchMedia('(hover: none) and (pointer: coarse)').matches;
    } catch (e) { return false; }
  })();

  const root = h('div', { class: `fd-ui${isTouch ? ' touch' : ''}` });
  const crt = h('div', { class: 'crt-overlay', 'aria-hidden': 'true' }, h('div', { class: 'crt-roll' }));
  host.append(root, crt);

  // ---------------------------------------------------------------------------- shared UI context
  const keyOwners = [];
  const U = {
    ctx, events, game, settings, root, isTouch,
    size: { w: root.clientWidth || innerWidth, h: root.clientHeight || innerHeight },
    em: 14,
    inputHandlesPause: true,
    sfx(name, opts) { try { ctx.audio?.sfx?.(name, opts); } catch (e) { /* ignore */ } },
    emit(name, payload) { events.emit(name, payload); },
    setKeyOwner(fn) { const i = keyOwners.indexOf(fn); if (i !== -1) keyOwners.splice(i, 1); keyOwners.push(fn); },
    releaseKeyOwner(fn) { const i = keyOwners.indexOf(fn); if (i !== -1) keyOwners.splice(i, 1); },
    hudTop: () => 0,
  };

  // ---------------------------------------------------------------------------- widgets
  const hud = createHud(U);
  const notify = createNotify(U);
  const popups = createPopups(U);
  const tutorial = createTutorial(U, { notify, hud });
  const menu = createMenu(U);
  const boot = createBoot(U);
  const screens = createScreens(U);
  root.append(hud.el, notify.el, popups.el, tutorial.el, menu.el, screens.el, boot.el);

  let hudTopCache = 0;
  U.hudTop = () => hudTopCache;

  function measure() {
    U.size.w = root.clientWidth || innerWidth;
    U.size.h = root.clientHeight || innerHeight;
    U.em = parseFloat(getComputedStyle(root).fontSize) || 14;
    const top = hud.el.querySelector('.hud-top');
    hudTopCache = top && !hud.el.classList.contains('is-hidden') ? top.offsetTop + top.offsetHeight : Math.round(U.em * 2.6);
    popups.onResize();
  }
  measure();
  const onResize = () => requestAnimationFrame(measure);
  addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);
  try { new ResizeObserver(onResize).observe(root); } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------- keyboard routing
  // Modal screens (boot/menu/pause/end screens) own the keyboard and stop propagation so the
  // gameplay input module does not also react (e.g. 'M' while typing initials).
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || BROWSER_KEY.test(e.key)) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const owner = keyOwners[keyOwners.length - 1];
    if (owner && owner(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Inside the itch.io iframe the page only gets keyboard events once the frame has focus: take it on
  // the first click/tap anywhere (capture phase, so buttons that preventDefault still count).
  addEventListener('pointerdown', (e) => {
    try { if (!document.hasFocus()) window.focus(); } catch (err) { /* ignore */ }
    // A touchscreen laptop that started in desktop layout switches to the touch layout on first touch.
    if (e.pointerType === 'touch' && !U.isTouch) {
      U.isTouch = true;
      root.classList.add('touch');
      relang();
    }
  }, true);

  // Never let UI buttons keep keyboard focus (Space would re-click them).
  root.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------- CRT overlay
  function applyCRT() { crt.classList.toggle('is-off', !settings.crt); }
  applyCRT();

  // ---------------------------------------------------------------------------- language
  function relang() {
    hud.relang();
    menu.relang();
    boot.relang();
    screens.relang();
    popups.relang();
    tutorial.relang();
    notify.relang();
    requestAnimationFrame(measure);
  }

  // ---------------------------------------------------------------------------- events
  const name = (enemy) => (enemy ? enemy.name || (enemy.type ? t('enemy.' + enemy.type) : null) : null);
  // Wave names from waves.json ('GIFT HORSE') and the endless Y2K countdown ('04/1999', 'Y2K.BUG');
  // generic fresh-endless names ('ENDLESS 07') add nothing.
  const waveName = (info) => (info && info.name && !/^ENDLESS\b/i.test(info.name) ? String(info.name) : null);
  const pad = (n) => String(n).padStart(2, '0');
  let lastLeaker = null;
  let lastLeakerType = null;
  let endlessAnnounced = false;   // fresh endless run: banner on its first prep
  let continueAnnounced = false;  // victory -> KEEP GOING: banner once per run
  let restoring = false;          // LKG restore replays builds + KB: keep the MEM counter quiet until prep

  events.on('boot', () => { boot.start(); });

  events.on('menu', () => {
    boot.hide();
    menu.open();
  });

  events.on('phase:change', ({ from, to }) => {
    root.dataset.phase = to;
    if (to !== 'boot') boot.hide();
    if (to !== 'menu') menu.hide();
    hud.onPhase(to);
    screens.onPhase(to);
    tutorial.onPhase(to);
    if (to !== 'prep' && to !== 'wave' && to !== 'paused') {
      popups.close();
      notify.clear();
    }
    if (to !== 'prep' && to !== 'wave') popups.close();
    else if (from === 'paused' && game.selected) popups.onSelection(game.selected); // reopen after resume
    requestAnimationFrame(measure);
  });

  events.on('game:new', ({ mode, restored } = {}) => {
    hud.reset();
    notify.clear();
    popups.close();
    lastLeaker = null;
    lastLeakerType = null;
    endlessAnnounced = mode === 'endless' && !restored;
    continueAnnounced = false;
    restoring = !!restored;
    tutorial.onGameNew({ restored: !!restored });
    if (restored) notify.banner([t('banner.restored')], { cls: 'info', dur: 2.4, prio: 2 });
  });

  events.on('wave:prep', ({ wave } = {}) => {
    if (restoring) { restoring = false; hud.reset(); } // snap MEM to the restored value, no +/- tag
    const next = Number(wave) || game.wave + 1;
    const freshTypes = hud.onWavePrep(next);
    hud.setNextWave();
    if (endlessAnnounced && game.mode === 'endless' && game.wave === 0) {
      notify.banner([t('banner.endless')], { cls: 'info', dur: 2.6 });
      endlessAnnounced = false;
    }
    const total = game.totalWaves || GAME.TOTAL_WAVES;
    if (!continueAnnounced && game.mode === 'endless' && game.wave === total) {
      continueAnnounced = true;
      notify.banner([t('banner.endless')], { cls: 'info', dur: 2.6, prio: 2 });
    }
    // First sighting of a virus type (from wave 2): one short briefing per type, after the CLEARED banner.
    if (freshTypes.length && next >= 2) {
      setTimeout(() => {
        if (game.phase !== 'prep') return;
        const lang = getLang();
        for (const type of freshTypes.slice(0, 3)) {
          const def = ENEMIES[type];
          if (!def) continue;
          const desc = (def.desc && (def.desc[lang] || def.desc.en)) || t(`enemy.${type}.desc`);
          const l3 = type === 'trojan' ? t('tip.trojan') : def.boss ? t('tip.boss') : '';
          notify.banner([t('banner.newVirus', { name: def.name || t('enemy.' + type) }), desc, l3], { cls: 'info newv', dur: 3.2, prio: 1 });
        }
      }, 0);
    }
  });

  // economy pays the wave bonus / interest / early-call KB in its own listeners (before or after
  // ours): remember the latest payments and read them a tick later.
  const recentKb = { wave: null, interest: null, early: null };
  const recent = (reason) => {
    const r = recentKb[reason];
    return r && performance.now() - r.at < 1500 ? r.delta : 0; // payments are seconds apart
  };

  events.on('wave:start', ({ wave, isBoss, info, earlySeconds }) => {
    hud.onWaveStart(wave);
    const count = ((info && info.groups) || []).reduce((a, g) => a + (Number(g.count) || 0), 0);
    setTimeout(() => {
      if (game.phase !== 'wave') return;
      const early = recent('early') || Math.max(0, Number(earlySeconds) || 0) * (GAME.EARLY_CALL_KB_PER_SEC || 0);
      const l3 = early > 0 ? t('banner.early', { kb: Math.round(early) }) : '';
      if (isBoss) {
        const bossName = (info && info.bossName) || (wave % 10 === 0 ? t('enemy.boss_iloveyou') : t('enemy.boss_melissa'));
        notify.banner([t('banner.boss', { name: bossName }), t('banner.bossSub'), l3], { cls: 'boss', dur: 2.6, prio: 3, warn: true });
      } else {
        const wn = waveName(info);
        const l1 = wn ? t('banner.waveNamed', { n: pad(wave), name: wn }) : t('banner.wave', { n: pad(wave) });
        notify.banner([l1, count ? t('banner.waveSub', { n: count }) : t('banner.waveSubX'), l3], { cls: 'wave', dur: 1.8, prio: 2 });
      }
    }, 0);
  });

  events.on('kb:change', (p) => {
    if (!restoring) hud.onKb(p);
    if (p && p.reason in recentKb) recentKb[p.reason] = { delta: p.delta || 0, at: performance.now() };
  });

  events.on('wave:cleared', ({ wave, bonus, perfect }) => {
    setTimeout(() => {
      if (game.phase === 'gameover' || game.phase === 'victory') return;
      const kb = recent('wave') || bonus || 0;
      const interest = recent('interest');
      const extras = [];
      if (kb) extras.push(t('banner.bonus', { kb: Math.round(kb) }));
      if (interest > 0) extras.push(t('banner.interest', { kb: Math.round(interest) }));
      if (perfect) extras.push(t('banner.perfect'));
      notify.banner([t('banner.cleared', { n: pad(wave) }), t('banner.clearedSub'), extras.join('  ·  ')],
        { cls: 'clear', dur: 2.0, prio: 2 });
    }, 0);
  });

  events.on('boss:spawn', ({ enemy }) => {
    hud.setBoss(enemy);
  });
  events.on('boss:killed', ({ enemy }) => {
    const n = name(enemy) || 'BOSS';
    notify.banner([t('banner.bossKilled', { name: n }), t('banner.bossKilledSub')], { cls: 'clear', dur: 2.4, prio: 3 });
  });

  events.on('cpu:damage', ({ enemy }) => {
    if (enemy) {
      lastLeaker = name(enemy);
      lastLeakerType = enemy.type || null;
    }
    hud.onCpuDamage();
  });

  // heat:start has no banner: the HUD gauge, the heat line and the fan pointer already say it.
  events.on('heat:cooled', ({ spot }) => {
    const s = (spot && (spot.name || spot.id)) || 'RAM';
    notify.banner([t('banner.cooled', { spot: String(s).toUpperCase() })], { cls: 'clear', dur: 1.8, prio: 1 });
  });

  events.on('build:failed', ({ type, reason }) => {
    if (reason === 'kb') {
      const need = towerCost(U, type);
      notify.error(t('err.memory'), t('err.memoryDetail', { name: t('tower.' + type), need, have: Math.floor(game.kb) }));
    } else if (reason === 'occupied') {
      notify.error(t('err.occupied'), '', { dur: 1.6 });
    } else {
      notify.error(t('err.invalid'), t('err.retry'), { dur: 1.8 });
    }
  });

  events.on('upgrade:failed', ({ tower, reason }) => {
    if (reason === 'max') {
      notify.banner([t('banner.maxLevel')], { cls: 'info', dur: 1.6, prio: 1 });
    } else {
      let need = 0;
      try { need = Math.round(ctx.towers?.upgradeCost?.(tower) || 0); } catch (e) { need = 0; }
      notify.error(t('err.memory'), t('err.memoryUpgrade', { need, have: Math.floor(game.kb) }));
    }
  });

  events.on('selection:change', ({ selected }) => {
    if (!(game.phase === 'prep' || game.phase === 'wave')) { popups.close(); return; }
    popups.onSelection(selected);
  });
  events.on('tower:upgraded', ({ tower }) => { if (popups.tower === tower) popups.refresh(); });
  events.on('tower:targeting', ({ tower }) => { if (popups.tower === tower) popups.refresh(); });
  events.on('tower:sold', ({ tower }) => { if (popups.tower === tower) popups.close(); });

  events.on('settings:change', ({ key }) => {
    if (key === 'lang') relang();
    if (key === 'crt') applyCRT();
    menu.onSettings();
    screens.onSettings();
  });

  events.on('gameover', (p) => {
    popups.close();
    notify.clear();
    screens.openEnd('gameover', p || {}, { cause: lastLeaker, causeType: lastLeakerType });
  });

  let wasUnlocked = !!settings.endlessUnlocked;
  events.on('game:new', () => { wasUnlocked = !!settings.endlessUnlocked; });
  events.on('victory', (p) => {
    popups.close();
    notify.clear();
    screens.openEnd('victory', p || {}, { unlockedNow: !wasUnlocked && !!settings.endlessUnlocked });
    wasUnlocked = true;
  });

  // If something went wrong at boot (another module failed), say so in debug mode.
  if (ctx.debug && ctx.bootErrors && ctx.bootErrors.length) {
    setTimeout(() => notify.error('BOOT ERRORS', ctx.bootErrors.join(' | ').slice(0, 160), { dur: 6 }), 300);
  }

  // ---------------------------------------------------------------------------- per-frame
  function update(dt, time) {
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    boot.update(dt);
    menu.update(dt);
    const phase = game.phase;
    if (phase === 'prep' || phase === 'wave' || phase === 'paused') {
      hud.update(dt);
      popups.update(dt);
      tutorial.update(dt);
    }
    notify.update(phase === 'paused' ? 0 : dt);
    screens.update(dt, time);
  }

  return {
    update,
    root,
    get wantsKeyboard() { return keyOwners.length > 0; },
    get popupOpen() { return popups.isOpen; },
    banner: (l1, l2, opts) => notify.banner([l1, l2], opts),
    error: (msg, detail, opts) => notify.error(msg, detail, opts),
    relang,
  };
}
