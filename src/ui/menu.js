// MENU screen: C:\> FLOPPY.EXE prompt, ANSI title, DOS menu box with sub-pages
// (how to play, high scores, settings, credits). Keyboard (arrows/Enter/Esc), mouse and touch.
import { t } from '../core/i18n.js';
import { GAME, PALETTE } from '../config.js';
import { getLeaderboard } from '../core/save.js';
import { h, setText, show, applyI18n, fmtNum, pad2 } from './dom.js';
import { drawTitle, spriteImg, enemyLook } from './sprites.js';
import { createSettingsPanel } from './settings.js';
import { towerCost, towerLook } from './towerinfo.js';

const ITEMS = ['start', 'endless', 'howto', 'scores', 'settings', 'credits'];
const LABELS = {
  start: 'menu.start', endless: 'menu.endless', howto: 'menu.howto', scores: 'menu.scores',
  settings: 'menu.settings', credits: 'menu.credits',
};
const TAGLINES = 8;

export function createMenu(U) {
  const s = U.settings;
  let page = 'main';
  let focus = 0;
  let active = false;
  let time = 0;
  let t0 = 0;
  let tagIdx = Math.floor(Math.random() * TAGLINES);
  let tagTimer = 0;
  let lockTimer = 0;
  let scoreTab = 'campaign';

  // --- prompt + title
  const promptText = h('span');
  const prompt = h('div', { class: 'menu-prompt' }, promptText, h('span', { class: 'cursor' }, '_'));
  const loading = h('div', { class: 'menu-loading' });
  const titleCanvas = drawTitle(document.createElement('canvas'), 'FLOPPY DEFENSE', 8);
  titleCanvas.className = 'menu-title-canvas';
  titleCanvas.setAttribute('role', 'img');
  titleCanvas.setAttribute('aria-label', GAME.TITLE);
  const tagline = h('div', { class: 'menu-tagline' });
  const sub = h('div', { class: 'menu-sub', t: 'menu.sub' });
  const titleWrap = h('div', { class: 'menu-title' },
    h('div', { class: 'menu-floppies', 'aria-hidden': 'true' },
      spriteImg('floppy', PALETTE.antivirus, 'spr menu-fl fl1'),
      spriteImg('floppy', PALETTE.firewall, 'spr menu-fl fl2'),
      spriteImg('floppy', PALETTE.defrag, 'spr menu-fl fl3')),
    titleCanvas, sub, tagline);

  // --- box
  const boxTitle = h('span', { class: 'box-title' });
  const body = h('div', { class: 'menu-body' });
  const nav = h('div', { class: 'menu-nav' });
  const backBtn = h('button', { class: 'ui-hit btn btn-small menu-back is-hidden', tabindex: '-1' });
  backBtn.addEventListener('click', () => { U.sfx('click'); goto('main'); });
  const box = h('div', { class: 'dos-box menu-box ui-hit' }, boxTitle, body, h('div', { class: 'menu-foot' }, backBtn, nav));
  const footer = h('div', { class: 'menu-footer' });

  const el = h('div', { class: 'scr scr-menu is-hidden' },
    h('div', { class: 'menu-shade' }),
    prompt, loading,
    h('div', { class: 'menu-main' }, titleWrap, box),
    footer);

  // --- main list
  const items = ITEMS.map((id, i) => {
    const label = h('span', { class: 'mi-label' });
    const extra = h('span', { class: 'mi-extra' });
    const b = h('button', { class: 'ui-hit mi', tabindex: '-1', 'data-id': id },
      h('span', { class: 'mi-cursor' }, '\u25ba'), label, extra);
    b.addEventListener('click', () => { setFocus(i, true); activate(id); });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setFocus(i); });
    return { id, b, label, extra };
  });
  const lockMsg = h('div', { class: 'menu-lockmsg is-hidden' });
  const list = h('div', { class: 'menu-list' }, items.map((it) => it.b), lockMsg);

  const settingsPanel = createSettingsPanel(U);

  function endlessLocked() { return !s.endlessUnlocked; }

  function renderMain() {
    for (const it of items) {
      setText(it.label, t(LABELS[it.id]));
      const locked = it.id === 'endless' && endlessLocked();
      it.b.classList.toggle('is-locked', locked);
      setText(it.extra, locked ? `[${t('menu.locked')}]` : '');
    }
    setText(lockMsg, t('menu.lockedMsg'));
    items.forEach((it, k) => it.b.classList.toggle('is-focus', k === focus));
  }

  function setFocus(i, silent) {
    const n = (i + items.length) % items.length;
    if (n !== focus && !silent) U.sfx('hover');
    focus = n;
    items.forEach((it, k) => it.b.classList.toggle('is-focus', k === focus));
  }

  function activate(id) {
    if (id === 'start') { U.sfx('click'); U.emit('cmd:newGame', { mode: 'campaign' }); return; }
    if (id === 'endless') {
      if (endlessLocked()) {
        U.sfx('error');
        lockTimer = 2.6;
        show(lockMsg, true);
        const it = items[1].b;
        it.classList.remove('shake');
        void it.offsetWidth;
        it.classList.add('shake');
        return;
      }
      U.sfx('click');
      U.emit('cmd:newGame', { mode: 'endless' });
      return;
    }
    U.sfx('click');
    goto(id);
  }

  // --- sub pages
  function buildHowto() {
    const p = (k) => h('p', { class: 'howto-p' }, h('span', { class: 'howto-bullet' }, '\u25a0 '), t(k));
    const towers = ['antivirus', 'firewall', 'defrag'].map((type) => {
      const look = towerLook(type);
      return h('div', { class: 'howto-unit' }, spriteImg('floppy', look.color, 'spr spr-md'),
        h('div', null, h('div', { class: 'howto-unit-name', style: `color:${look.light}` }, `${t('tower.' + type)} `,
          h('span', { class: 'howto-cost' }, `${towerCost(U, type)}KB`)),
        h('div', { class: 'howto-unit-desc' }, t(`tower.${type}.desc`))));
    });
    const viruses = ['worm', 'trojan', 'macro', 'boss_melissa', 'boss_iloveyou'].map((type) => {
      const look = enemyLook(type);
      return h('div', { class: 'howto-unit' }, spriteImg(look.sprite, look.color, 'spr spr-md'),
        h('div', null, h('div', { class: 'howto-unit-name' }, t('enemy.' + type)),
          h('div', { class: 'howto-unit-desc' }, t(`enemy.${type}.desc`))));
    });
    return withMoreHint(h('div', { class: 'howto scrolly ui-hit' },
      h('div', { class: 'howto-text' }, p('howto.goal'), p('howto.build'), p('howto.upgrade'), p('howto.heat'), p('howto.waves')),
      h('div', { class: 'howto-units' },
        h('div', { class: 'howto-h' }, t('howto.floppies')), h('div', { class: 'howto-grid g1' }, towers),
        h('div', { class: 'howto-h' }, t('howto.viruses')), h('div', { class: 'howto-grid g2' }, viruses)),
      U.isTouch ? null : h('div', { class: 'howto-keys' }, h('span', { class: 'howto-h' }, t('howto.keys') + ': '), t('howto.keyList'))));
  }

  // Scrollable page: fade the bottom edge and show "▼ more" while there is content below the fold.
  function withMoreHint(scroller) {
    const mark = h('div', { class: 'more-mark', 'aria-hidden': 'true' }, t('howto.more'));
    const wrap = h('div', { class: 'scroll-wrap' }, scroller, mark);
    const check = () => {
      const more = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 4;
      wrap.classList.toggle('has-more', more);
    };
    scroller.addEventListener('scroll', check, { passive: true });
    requestAnimationFrame(check);
    setTimeout(check, 450); // after the menu fade-in / font settle
    return wrap;
  }

  function buildScores() {
    const tabs = h('div', { class: 'tabs' }, ['campaign', 'endless'].map((m) => {
      const b = h('button', { class: `ui-hit tab ${m === scoreTab ? 'is-on' : ''}`, tabindex: '-1' }, t('scores.' + m));
      b.addEventListener('click', () => { if (scoreTab !== m) { scoreTab = m; U.sfx('click'); renderPage(); } });
      return b;
    }));
    let board = [];
    try { board = getLeaderboard(scoreTab) || []; } catch (e) { board = []; }
    const table = board.length
      ? h('table', { class: 'scores' },
        h('tr', null, h('th', null, '#'), h('th', null, t('scores.name')), h('th', { class: 'r' }, t('scores.score')), h('th', { class: 'r' }, t('scores.wave'))),
        board.map((e, i) => h('tr', { class: i === 0 ? 'top1' : '' },
          h('td', null, pad2(i + 1)), h('td', null, e.name), h('td', { class: 'r' }, fmtNum(e.score)), h('td', { class: 'r' }, pad2(e.wave)))))
      : h('div', { class: 'scores-empty' }, t('scores.empty'), h('span', { class: 'cursor' }, '_'));
    return h('div', { class: 'scores-page' }, tabs, h('div', { class: 'scrolly ui-hit' }, table));
  }

  function buildCredits() {
    return withMoreHint(h('div', { class: 'credits scrolly ui-hit' },
      h('div', { class: 'credits-made' }, t('credits.made')),
      h('div', { class: 'credits-line' }, t('credits.theme')),
      h('div', { class: 'credits-line dim' }, t('credits.tech')),
      h('div', { class: 'credits-floppies' },
        spriteImg('floppy', PALETTE.antivirus, 'spr spr-md'), spriteImg('floppy', PALETTE.firewall, 'spr spr-md'),
        spriteImg('floppy', PALETTE.defrag, 'spr spr-md')),
      h('div', { class: 'credits-line amber' }, t('credits.thanks'))));
  }

  function goto(p) {
    page = p;
    lockTimer = 0;
    show(lockMsg, false);
    renderPage();
  }

  function renderPage() {
    body.textContent = '';
    box.dataset.page = page;
    el.dataset.page = page;
    show(backBtn, page !== 'main');
    setText(backBtn, `\u25c4 ${t('menu.back')}`);
    if (page === 'main') {
      setText(boxTitle, ' FLOPPY.EXE ');
      renderMain();
      body.append(list);
    } else if (page === 'settings') {
      setText(boxTitle, ` ${t('set.title')} `);
      settingsPanel.refresh();
      body.append(settingsPanel.el);
    } else if (page === 'howto') {
      setText(boxTitle, ` ${t('howto.title')} `);
      body.append(buildHowto());
    } else if (page === 'scores') {
      setText(boxTitle, ` ${t('scores.title')} `);
      body.append(buildScores());
    } else if (page === 'credits') {
      setText(boxTitle, ` ${t('credits.title')} `);
      body.append(buildCredits());
    }
    setText(nav, t(U.isTouch ? 'menu.navTouch' : 'menu.nav'));
    renderFooter();
  }

  function renderFooter() {
    const best = s.bestWave ? `  \u00b7  ${t('menu.best', { n: pad2(s.bestWave) })}` : '';
    setText(footer, t('menu.footer', { v: GAME.VERSION }) + best);
    setText(tagline, t(`tagline.${tagIdx}`));
  }

  function onKey(e) {
    const k = e.key;
    if (page === 'main') {
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { setFocus(focus - 1); return true; }
      if (k === 'ArrowDown' || k === 's' || k === 'S') { setFocus(focus + 1); return true; }
      if (k === 'Enter' || k === ' ') { if (!e.repeat) activate(items[focus].id); return true; }
      return k === 'Escape';
    }
    if (k === 'Escape' || k === 'Backspace') { U.sfx('click'); goto('main'); return true; }
    if (page === 'settings') return settingsPanel.onKey(e);
    if (page === 'scores' && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      scoreTab = scoreTab === 'campaign' ? 'endless' : 'campaign';
      U.sfx('hover');
      renderPage();
      return true;
    }
    if (k === 'Enter' || k === ' ') { U.sfx('click'); goto('main'); return true; }
    return k.startsWith('Arrow');
  }

  function open() {
    active = true;
    time = 0;
    t0 = performance.now();
    page = 'main';
    focus = 0;
    el.classList.remove('is-ready');
    renderPage();
    setText(promptText, '');
    setText(loading, '');
    show(el, true);
    U.setKeyOwner(onKey);
  }

  function hide() {
    if (!active) return;
    active = false;
    show(el, false);
    U.releaseKeyOwner(onKey);
  }

  function update(dt) {
    if (!active) return;
    time = (performance.now() - t0) / 1000; // wall clock (slow first frames must not stall the intro)
    // typed prompt, then title reveal
    const full = t('menu.prompt');
    const n = Math.min(full.length, Math.floor(time * 28));
    setText(promptText, full.slice(0, n));
    if (time > 0.6) setText(loading, t('menu.loading'));
    if (time > 0.75 && !el.classList.contains('is-ready')) el.classList.add('is-ready');
    tagTimer += dt;
    if (tagTimer > 4.5) {
      tagTimer = 0;
      tagIdx = (tagIdx + 1) % TAGLINES;
      setText(tagline, t(`tagline.${tagIdx}`));
      tagline.classList.remove('splash-in');
      void tagline.offsetWidth;
      tagline.classList.add('splash-in');
    }
    if (lockTimer > 0) {
      lockTimer -= dt;
      if (lockTimer <= 0) show(lockMsg, false);
    }
  }

  function relang() {
    applyI18n(el);
    if (active) renderPage();
    settingsPanel.refresh();
  }

  function onSettings() {
    if (active && page === 'settings') settingsPanel.refresh();
    if (active && page === 'main') renderMain();
  }

  return { el, open, hide, update, relang, onSettings, get active() { return active; } };
}
