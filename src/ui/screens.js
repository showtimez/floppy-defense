// PAUSE overlay, GAME OVER (Win9x BSOD) and VICTORY ("It's now safe to turn off your computer.")
// plus the arcade-style initials entry for the local leaderboard.
import { t } from '../core/i18n.js';
import { GAME } from '../config.js';
import { isHighScore, addScore, getLeaderboard } from '../core/save.js';
import { h, setText, show, applyI18n, fmtNum, pad2 } from './dom.js';
import { createSettingsPanel } from './settings.js';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
const BSOD_BLACK = 0.85; // s after game over: CRT goes black (the board glitches until then)
const BSOD_LIVE = 1.0;   // s after game over: the blue screen appears

// ================================================================================== initials
function createInitials(U, onDone) {
  const init = String(U.settings.lastInitials || 'AAA').toUpperCase().replace(/[^A-Z0-9-]/g, 'A').padEnd(3, 'A').slice(0, 3);
  const chars = init.split('');
  let pos = 0;
  let done = false;
  const cells = [];
  const label = h('div', { class: 'ini-label' });
  const row = h('div', { class: 'ini-row' });
  for (let i = 0; i < 3; i++) {
    const upB = h('button', { class: 'ui-hit ini-btn', tabindex: '-1', 'aria-label': 'up' }, '▲');
    const ch = h('button', { class: 'ui-hit ini-ch', tabindex: '-1' }, chars[i]);
    const dnB = h('button', { class: 'ui-hit ini-btn', tabindex: '-1', 'aria-label': 'down' }, '▼');
    upB.addEventListener('click', (e) => { e.stopPropagation(); pos = i; cycle(1); });
    dnB.addEventListener('click', (e) => { e.stopPropagation(); pos = i; cycle(-1); });
    ch.addEventListener('click', (e) => { e.stopPropagation(); pos = i; U.sfx('hover'); render(); });
    cells.push(ch);
    row.append(h('div', { class: 'ini-cell' }, upB, ch, dnB));
  }
  const okB = h('button', { class: 'ui-hit btn ini-ok', tabindex: '-1' });
  okB.addEventListener('click', (e) => { e.stopPropagation(); confirm(); });
  row.append(okB);
  const el = h('div', { class: 'initials' }, label, row);

  function render() {
    setText(label, t('hs.new'));
    setText(okB, t('hs.ok'));
    cells.forEach((c, i) => {
      setText(c, chars[i]);
      c.classList.toggle('is-cur', i === pos && !done);
    });
  }
  function cycle(d) {
    if (done) return;
    const i = CHARSET.indexOf(chars[pos]);
    chars[pos] = CHARSET[(i + d + CHARSET.length) % CHARSET.length];
    U.sfx('hover');
    render();
  }
  function confirm() {
    if (done) return;
    done = true;
    U.sfx('click');
    render();
    onDone(chars.join(''));
  }
  function onKey(e) {
    if (done) return false;
    const k = e.key;
    if (k.length === 1 && /[a-z0-9-]/i.test(k)) {
      chars[pos] = k.toUpperCase();
      pos = Math.min(2, pos + 1);
      U.sfx('hover');
      render();
      return true;
    }
    if (k === 'Backspace') { pos = Math.max(0, pos - 1); render(); return true; }
    if (k === 'ArrowLeft') { pos = Math.max(0, pos - 1); render(); return true; }
    if (k === 'ArrowRight') { pos = Math.min(2, pos + 1); render(); return true; }
    if (k === 'ArrowUp') { cycle(1); return true; }
    if (k === 'ArrowDown') { cycle(-1); return true; }
    if (k === 'Enter') { confirm(); return true; }
    return true; // swallow everything else while typing
  }
  render();
  return { el, onKey, render, confirm, get done() { return done; } };
}

// Waves survived: main.js reports it (payload.survived); older payloads only carry the wave reached.
function survivedOf(payload, kind) {
  if (typeof payload.survived === 'number' && isFinite(payload.survived)) return payload.survived;
  return kind === 'victory' ? (payload.wave || 0) : Math.max(0, (payload.wave || 1) - 1);
}

// One-line hint on the BSOD for the virus type that dealt the final blow.
function tipKey(type) {
  if (!type) return null;
  if (type === 'trojan') return 'tip.trojan';
  if (type === 'worm') return 'tip.worm';
  if (type === 'macro' || type === 'macro_mini') return 'tip.macro';
  if (type.startsWith('boss')) return 'tip.boss';
  return null;
}

function statLines(U, payload, kind) {
  const st = payload.stats || {};
  const total = U.game.totalWaves || GAME.TOTAL_WAVES;
  const survived = survivedOf(payload, kind);
  const waves = payload.mode === 'endless' ? pad2(survived) : `${pad2(survived)} / ${pad2(total)}`;
  return [
    ['stats.waves', waves],
    ['stats.kills', fmtNum(st.kills || 0)],
    ['stats.towers', fmtNum(st.towersBuilt || 0)],
    ['stats.kb', `${fmtNum(st.kbEarned || 0)}KB`],
    ['stats.perfect', pad2(st.perfectWaves || 0)],
    ['stats.combo', st.bestCombo >= 3 ? `x${st.bestCombo}` : '--'],
  ];
}

function leader(label, value, width = 34) {
  const dots = Math.max(3, width - label.length - value.length);
  return `${label} ${'.'.repeat(dots)} ${value}`;
}

// ================================================================================== screens
export function createScreens(U) {
  const { game } = U;

  // ------------------------------------------------------------------ PAUSE
  const PITEMS = ['resume', 'restart', 'settings', 'quit'];
  const pLabels = { resume: 'pause.resume', restart: 'pause.restart', settings: 'pause.settings', quit: 'pause.quit' };
  let pFocus = 0;
  let pPage = 'list';
  const pTitle = h('span', { class: 'box-title' });
  const pSub = h('div', { class: 'pause-sub' });
  const pItems = PITEMS.map((id, i) => {
    const lbl = h('span', { class: 'mi-label' });
    const b = h('button', { class: 'ui-hit mi', tabindex: '-1' }, h('span', { class: 'mi-cursor' }, '►'), lbl);
    b.addEventListener('click', (e) => { e.stopPropagation(); pSetFocus(i, true); pActivate(id); });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') pSetFocus(i); });
    return { id, b, lbl };
  });
  const pList = h('div', { class: 'menu-list' }, pItems.map((x) => x.b));
  const pSettings = createSettingsPanel(U);
  const pBack = h('button', { class: 'ui-hit btn btn-small', tabindex: '-1' });
  pBack.addEventListener('click', (e) => { e.stopPropagation(); U.sfx('click'); pGoto('list'); });
  const pSetWrap = h('div', { class: 'pause-set is-hidden' }, pSettings.el, h('div', { class: 'menu-foot' }, pBack));
  const pauseBox = h('div', { class: 'dos-box pause-box ui-hit' }, pTitle, pSub, pList, pSetWrap);
  const pause = h('div', { class: 'scr scr-pause is-hidden' }, pauseBox);

  function pRender() {
    setText(pTitle, ` ${t(pPage === 'list' ? 'pause.title' : 'set.title')} `);
    setText(pSub, `${t('pause.sub')}  ·  ${U.isTouch ? '' : '[P] '}${t('pause.resume')}`);
    pItems.forEach((x, k) => { setText(x.lbl, t(pLabels[x.id])); x.b.classList.toggle('is-focus', k === pFocus); });
    setText(pBack, `◄ ${t('menu.back')}`);
    show(pList, pPage === 'list');
    show(pSub, pPage === 'list');
    show(pSetWrap, pPage === 'settings');
    if (pPage === 'settings') pSettings.refresh();
  }
  function pSetFocus(i, silent) {
    const n = (i + pItems.length) % pItems.length;
    if (n !== pFocus && !silent) U.sfx('hover');
    pFocus = n;
    pItems.forEach((x, k) => x.b.classList.toggle('is-focus', k === pFocus));
  }
  function pGoto(p) { pPage = p; pRender(); }
  function pActivate(id) {
    U.sfx('click');
    if (id === 'resume') U.emit('cmd:pause');
    else if (id === 'restart') U.emit('cmd:newGame', { mode: game.mode || 'campaign' });
    else if (id === 'settings') pGoto('settings');
    else if (id === 'quit') U.emit('cmd:menu');
  }
  function pauseKey(e) {
    const k = e.key;
    if (pPage === 'settings') {
      if (k === 'Escape' || k === 'Backspace') { U.sfx('click'); pGoto('list'); return true; }
      return pSettings.onKey(e);
    }
    if (k === 'ArrowUp') { pSetFocus(pFocus - 1); return true; }
    if (k === 'ArrowDown') { pSetFocus(pFocus + 1); return true; }
    if (k === 'Enter' || k === ' ') { if (!e.repeat) pActivate(pItems[pFocus].id); return true; }
    if ((k === 'Escape' || k === 'p' || k === 'P') && !U.inputHandlesPause) { if (!e.repeat) U.emit('cmd:pause'); return true; }
    return false;
  }
  function pauseOpen() {
    pFocus = 0;
    pPage = 'list';
    pRender();
    show(pause, true);
    pauseBox.classList.remove('pop-in');
    void pauseBox.offsetWidth;
    pauseBox.classList.add('pop-in');
    U.setKeyOwner(pauseKey);
  }
  function pauseClose() {
    show(pause, false);
    U.releaseKeyOwner(pauseKey);
  }

  // ------------------------------------------------------------------ BSOD
  const bsTitle = h('div', { class: 'bsod-title' });
  const bsMain = h('p', { class: 'bsod-p' });
  const bsB1 = h('p', { class: 'bsod-p bsod-bul' });
  const bsB2 = h('p', { class: 'bsod-p bsod-bul' });
  const bsCause = h('p', { class: 'bsod-p bsod-bul bsod-cause' });
  const bsTip = h('p', { class: 'bsod-p bsod-tip is-hidden' });
  const bsReport = h('div', { class: 'bsod-report' });
  const bsIniWrap = h('div', { class: 'bsod-ini' });
  const bsTag = h('div', { class: 'end-tag is-hidden' });
  // Action row (appears once the report has had a moment): [R] RESTORE  [N] RETRY  [ESC] MENU
  const BS_ACTS = ['restore', 'retry', 'menu'];
  const BS_KEYS = { restore: 'R', retry: 'N', menu: 'ESC' };
  const bsBtns = BS_ACTS.map((id) => {
    const key = h('span', { class: 'bb-key' }, `[${BS_KEYS[id]}] `);
    const lbl = h('span', { class: 'bb-lbl' });
    const b = h('button', { class: `ui-hit btn bsod-btn bs-${id}`, tabindex: '-1' }, key, lbl);
    b.addEventListener('click', (e) => { e.stopPropagation(); if (canContinue()) bsActivate(id); });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && canContinue()) bsSetFocus(bsAvail().indexOf(id)); });
    return { id, b, lbl };
  });
  const bsNav = h('div', { class: 'bsod-nav' });
  const bsCont = h('div', { class: 'bsod-cont' }, h('div', { class: 'bsod-acts' }, bsBtns.map((x) => x.b)), bsNav);
  const bsod = h('div', { class: 'scr scr-bsod ui-hit is-hidden' },
    h('div', { class: 'bsod-inner' }, bsTitle, bsMain, bsB1, bsB2, bsCause, bsTip, bsReport, bsTag, bsIniWrap, bsCont));

  // ------------------------------------------------------------------ VICTORY
  const wShut = h('div', { class: 'win-shut' });
  const wSafe = h('div', { class: 'win-safe' });
  const wSub = h('div', { class: 'win-sub' });
  const wUnlock = h('div', { class: 'win-unlock is-hidden' });
  const wStats = h('div', { class: 'win-stats' });
  const wIniWrap = h('div', { class: 'win-ini' });
  const wBoardTitle = h('div', { class: 'win-board-title' });
  const wBoard = h('div', { class: 'win-board' });
  const wEndless = h('button', { class: 'ui-hit btn win-btn', tabindex: '-1' });
  const wMenu = h('button', { class: 'ui-hit btn win-btn', tabindex: '-1' });
  // Leaving with a pending high score saves it with the initials shown (never lose a score).
  const flushInitials = () => { if (initials && !initials.done) initials.confirm(); };
  wEndless.addEventListener('click', (e) => { e.stopPropagation(); flushInitials(); U.sfx('click'); continueEndless(); });
  wMenu.addEventListener('click', (e) => { e.stopPropagation(); flushInitials(); U.sfx('click'); U.emit('cmd:menu'); });
  // KEEP GOING: the same run continues into endless (wave 11, towers/KB kept). Falls back to a fresh
  // endless run if main.js does not handle cmd:continueEndless.
  function continueEndless() {
    U.emit('cmd:continueEndless');
    if (game.phase === 'victory') U.emit('cmd:newGame', { mode: 'endless' });
  }
  const wTag = h('div', { class: 'end-tag is-hidden' });
  const wMore = h('div', { class: 'win-more' }, wSub, wUnlock,
    h('div', { class: 'win-cols' }, h('div', { class: 'win-col' }, wStats, wTag, wIniWrap), h('div', { class: 'win-col' }, wBoardTitle, wBoard)),
    h('div', { class: 'win-btns' }, wEndless, wMenu));
  const victory = h('div', { class: 'scr scr-win ui-hit is-hidden' }, wShut, h('div', { class: 'win-inner' }, wSafe, wMore));

  const el = h('div', { class: 'screens' }, pause, bsod, victory);

  // ------------------------------------------------------------------ end-screen state
  let endKind = null;   // 'gameover' | 'victory'
  let endPayload = null;
  let endTime = 0;   // seconds since the end screen opened (wall clock, robust to slow frames)
  let endT0 = 0;
  const nowS = () => performance.now() / 1000;
  let graceUntil = 0; // after confirming initials, swallow the same Enter for a moment
  let initials = null;
  let savedRank = 0;
  let scoreShown = 0;
  let scoreEl = null;
  let winFocus = 0;
  let bsFocus = 0;
  let unlockedNow = false;
  let cause = null;
  let causeType = null;

  function renderReport(container, payload, kind) {
    container.textContent = '';
    container.append(h('div', { class: 'rep-title' }, t('bsod.report')));
    for (const [k, v] of statLines(U, payload, kind)) container.append(h('div', { class: 'rep-line' }, leader(t(k), v)));
    scoreEl = h('span', { class: 'rep-score-val' }, fmtNum(scoreShown));
    container.append(h('div', { class: 'rep-line rep-score' }, `${t('stats.score')} `, h('span', { class: 'rep-dots' }, '.'.repeat(8)), ' ', scoreEl));
    if (savedRank) container.append(h('div', { class: 'rep-line rep-rank' }, t('hs.saved', { rank: savedRank })));
  }

  function renderBoard() {
    wBoard.textContent = '';
    let board = [];
    try { board = getLeaderboard(endPayload?.mode || 'campaign') || []; } catch (e) { board = []; }
    if (!board.length) { wBoard.append(h('div', { class: 'scores-empty' }, t('scores.empty'))); return; }
    const table = h('table', { class: 'scores' });
    board.slice(0, 5).forEach((e, i) => {
      table.append(h('tr', { class: savedRank === i + 1 ? 'is-new' : '' },
        h('td', null, pad2(i + 1)), h('td', null, e.name), h('td', { class: 'r' }, fmtNum(e.score)), h('td', { class: 'r' }, `W${pad2(e.wave)}`)));
    });
    wBoard.append(table);
  }

  function setupInitials(wrap) {
    wrap.textContent = '';
    initials = null;
    savedRank = 0;
    if (endPayload.tainted) return; // debug / turbo / bot runs never reach the leaderboard
    let high = false;
    try { high = endPayload.score > 0 && isHighScore(endPayload.score, endPayload.mode || 'campaign'); } catch (e) { high = false; }
    if (!high) return;
    initials = createInitials(U, (name) => {
      try {
        savedRank = addScore({ name, score: endPayload.score, wave: survivedOf(endPayload, endKind), mode: endPayload.mode || 'campaign' }) || 0;
      } catch (e) { savedRank = 0; }
      U.emit('cmd:setting', { key: 'lastInitials', value: name });
      graceUntil = nowS() + 0.35; // the Enter that confirmed the initials must not also press a button
      renderEnd();
    });
    wrap.append(initials.el);
  }

  // ---- BSOD actions
  const lkgWave = () => (game.lkg && game.lkg.wave) || 0;
  const bsAvail = () => (lkgWave() ? BS_ACTS : BS_ACTS.slice(1));

  function bsSetFocus(i) {
    const avail = bsAvail();
    if (i < 0 || !avail.length) i = 0;
    const n = ((i % avail.length) + avail.length) % avail.length;
    bsFocus = n;
    for (const x of bsBtns) x.b.classList.toggle('is-focus', x.id === avail[n]);
  }

  function bsActivate(id) {
    if (!endPayload) return;
    if (id === 'restore' && !lkgWave()) return;
    U.sfx('click');
    if (id === 'restore') U.emit('cmd:restoreLKG');
    else if (id === 'retry') U.emit('cmd:newGame', { mode: endPayload.mode || 'campaign' });
    else U.emit('cmd:menu');
  }

  function renderEnd() {
    if (!endPayload) return;
    if (endKind === 'gameover') {
      setText(bsTitle, t('bsod.title'));
      setText(bsMain, t('bsod.main'));
      setText(bsB1, `*  ${t('bsod.b1')}`);
      setText(bsB2, `*  ${t('bsod.b2')}`);
      setText(bsCause, `*  ${cause ? t('bsod.cause', { name: cause }) : t('bsod.causeGeneric')}`);
      const tk = tipKey(causeType);
      show(bsTip, !!tk);
      if (tk) setText(bsTip, t(tk));
      renderReport(bsReport, endPayload, 'gameover');
      setText(bsTag, t('end.debugRun'));
      show(bsTag, !!endPayload.tainted);
      const lw = lkgWave();
      for (const x of bsBtns) {
        if (x.id === 'restore') {
          show(x.b, !!lw);
          setText(x.lbl, lw ? t('bsod.restore', { n: pad2(lw) }) : '');
        } else setText(x.lbl, t('bsod.' + x.id));
      }
      setText(bsNav, U.isTouch ? '' : t('bsod.nav'));
      show(bsNav, !U.isTouch);
      bsSetFocus(bsFocus);
      if (initials) initials.render();
      show(bsIniWrap, !!initials && !initials.done);
    } else {
      setText(wShut, t('win.shutdown'));
      setText(wSafe, t('win.safe'));
      setText(wSub, t('win.sub', { n: endPayload.wave || GAME.TOTAL_WAVES }));
      setText(wUnlock, `★ ${t('win.unlocked')} ★`);
      show(wUnlock, unlockedNow);
      renderReport(wStats, endPayload, 'victory');
      setText(wTag, t('end.debugRun'));
      show(wTag, !!endPayload.tainted);
      setText(wBoardTitle, t('win.top'));
      renderBoard();
      setText(wEndless, `► ${t('win.endless')}`);
      setText(wMenu, t('win.menu'));
      if (initials) initials.render();
      show(wIniWrap, !!initials && !initials.done);
      winSetFocus(winFocus);
    }
  }

  function winSetFocus(i) {
    winFocus = (i + 2) % 2;
    wEndless.classList.toggle('is-focus', winFocus === 0);
    wMenu.classList.toggle('is-focus', winFocus === 1);
  }

  function canContinue() {
    const now = nowS(); // wall clock, not the per-frame endTime: keys must not wait for a slow frame
    return now - endT0 > (endKind === 'victory' ? 3.0 : BSOD_LIVE + 0.8) && now > graceUntil && (!initials || initials.done);
  }

  function endKey(e) {
    // initials take the keyboard once they are on screen (victory reveals them later)
    if (initials && !initials.done && nowS() - endT0 > (endKind === 'victory' ? 3.0 : BSOD_LIVE + 0.2)) return initials.onKey(e);
    if (!canContinue() || e.repeat) return true;
    const k = e.key;
    if (endKind === 'gameover') {
      const avail = bsAvail();
      if (k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) { bsSetFocus(bsFocus - 1); U.sfx('hover'); return true; }
      if (k === 'ArrowRight' || k === 'Tab') { bsSetFocus(bsFocus + 1); U.sfx('hover'); return true; }
      if (k === 'Enter' || k === ' ') { bsActivate(avail[bsFocus] || 'retry'); return true; }
      if (k === 'r' || k === 'R') { if (lkgWave()) bsActivate('restore'); return true; }
      if (k === 'n' || k === 'N') { bsActivate('retry'); return true; }
      if (k === 'Escape') { bsActivate('menu'); return true; }
      return true;
    }
    // victory
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab') { winSetFocus(winFocus + 1); U.sfx('hover'); return true; }
    if (k === 'Enter' || k === ' ') {
      U.sfx('click');
      if (winFocus === 0) continueEndless();
      else U.emit('cmd:menu');
      return true;
    }
    if (k === 'Escape') { U.emit('cmd:menu'); return true; }
    return true;
  }

  function openEnd(kind, payload, opts = {}) {
    endKind = kind;
    endPayload = { ...payload, stats: { ...(payload.stats || {}) }, score: Math.round(payload.score || 0) };
    endTime = 0;
    endT0 = nowS();
    graceUntil = 0;
    scoreShown = 0;
    cause = opts.cause || null;
    causeType = opts.causeType || null;
    unlockedNow = !!opts.unlockedNow;
    winFocus = 0;
    bsFocus = 0; // RESTORE when available, otherwise RETRY
    pauseClose();
    const wrap = kind === 'gameover' ? bsIniWrap : wIniWrap;
    setupInitials(wrap);
    renderEnd();
    const scr = kind === 'gameover' ? bsod : victory;
    show(kind === 'gameover' ? victory : bsod, false);
    scr.classList.remove('is-live', 'is-more', 'is-black');
    bsCont.classList.remove('is-ready');
    show(scr, true);
    U.setKeyOwner(endKey);
  }

  function closeEnd() {
    endKind = null;
    show(bsod, false);
    show(victory, false);
    U.releaseKeyOwner(endKey);
  }

  function update(dt) {
    if (!endKind) return;
    endTime = nowS() - endT0;
    const scr = endKind === 'gameover' ? bsod : victory;
    // BSOD: the crashing board glitches for a moment behind a transparent (input-blocking) layer,
    // the CRT drops to black, then the blue screen comes up.
    if (endKind === 'gameover') {
      if (endTime > BSOD_BLACK && !scr.classList.contains('is-black')) scr.classList.add('is-black');
      if (endTime > BSOD_LIVE && !scr.classList.contains('is-live')) scr.classList.add('is-live');
    }
    if (endKind === 'victory') {
      if (endTime > 1.3 && !scr.classList.contains('is-live')) scr.classList.add('is-live');
      if (endTime > 3.0 && !scr.classList.contains('is-more')) scr.classList.add('is-more');
    }
    const startCount = endKind === 'gameover' ? BSOD_LIVE + 0.5 : 3.4;
    if (endTime > startCount && scoreShown < endPayload.score) {
      const step = Math.max(1, Math.ceil(endPayload.score * dt * 0.9));
      scoreShown = Math.min(endPayload.score, scoreShown + step);
      if (scoreEl) setText(scoreEl, fmtNum(scoreShown));
      if (Math.random() < 0.35) U.sfx('tick', { volume: 0.25, pitch: 1.6 });
    }
    if (endKind === 'gameover') {
      const ready = canContinue();
      if (ready !== bsCont.classList.contains('is-ready')) {
        bsCont.classList.toggle('is-ready', ready);
        // short screens scroll the BSOD: bring the actions into view when they appear
        if (ready && bsod.scrollHeight > bsod.clientHeight + 2) {
          try { bsCont.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
        }
      }
    }
  }

  function onPhase(to) {
    if (to === 'paused') pauseOpen();
    else pauseClose();
    if (to !== 'gameover' && to !== 'victory') closeEnd();
  }

  function relang() {
    applyI18n(el);
    pRender();
    renderEnd();
  }

  function onSettings() {
    if (pPage === 'settings') pSettings.refresh();
  }

  return { el, update, onPhase, relang, onSettings, openEnd, closeEnd, get endKind() { return endKind; } };
}
