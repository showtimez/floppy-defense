// BUILD popup (three floppy cards anchored at a free slot) and TOWER panel (stats, targeting,
// upgrade, sell) anchored at a placed floppy. Both follow their anchor via view.worldToScreen.
import { t } from '../core/i18n.js';
import { h, setText, show, icon, clamp, fmtNum } from './dom.js';
import { spriteImg } from './sprites.js';
import { TOWER_TYPES, towerDef, towerCost, towerLook, towerStats, fmtStat } from './towerinfo.js';

const MODES = ['first', 'last', 'strong', 'close'];
const NO_TARGETING = new Set(['firewall', 'defrag']);
// Matchup line on each build card (stays visible on phones, where the description is hidden).
const VS_CLASS = { antivirus: 'is-bad', firewall: 'is-good', defrag: 'is-slow' };
const DEFAULT_PREVIEW = 'antivirus';
const RING_N = 12; // samples of the range circle used to find its on-screen bounding box

export function createPopups(U) {
  const { game } = U;

  // ================================================================ BUILD POPUP
  const buildClose = h('button', { class: 'ui-hit pop-x', tabindex: '-1', 'aria-label': 'close' }, icon('close'));
  buildClose.addEventListener('click', (e) => { e.stopPropagation(); U.sfx('click'); U.emit('select:none'); });
  const buildTitle = h('span', { class: 'pop-title-txt' });
  const cards = TOWER_TYPES.map((type, i) => {
    const look = towerLook(type);
    const name = h('span', { class: 'card-name' });
    const cost = h('span', { class: 'card-cost' });
    const desc = h('span', { class: 'card-desc' });
    const vs = h('span', { class: `card-vs ${VS_CLASS[type] || ''}` });
    const card = h('button', { class: 'ui-hit card', tabindex: '-1', 'data-type': type, style: `--tc:${look.css}` },
      h('span', { class: 'card-key' }, String(i + 1)),
      h('span', { class: 'card-art' }, spriteImg('floppy', look.color, 'spr spr-card')),
      name, cost, desc, vs);
    // Hovering a card previews its range; leaving goes back to the default (ANTIVIRUS) disc.
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { preview(type); U.sfx('hover', { volume: 0.5 }); } });
    card.addEventListener('pointerleave', () => preview(DEFAULT_PREVIEW));
    card.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') preview(type); });
    card.addEventListener('pointercancel', () => preview(DEFAULT_PREVIEW));
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      e.currentTarget.blur();
      if (!buildSlot) return;
      // a successful build changes the selection (which hides the disc); a failed one keeps the preview
      U.emit('cmd:build', { type, slotId: buildSlot.id });
    });
    return { type, card, name, cost, desc, vs };
  });
  const buildCaret = h('div', { class: 'pop-caret' });
  const build = h('div', { class: 'pop pop-build ui-hit is-hidden' },
    h('div', { class: 'pop-title' }, buildTitle, buildClose),
    h('div', { class: 'cards' }, cards.map((c) => c.card)),
    buildCaret);

  // ================================================================ TOWER PANEL
  const tpClose = h('button', { class: 'ui-hit pop-x', tabindex: '-1', 'aria-label': 'close' }, icon('close'));
  tpClose.addEventListener('click', (e) => { e.stopPropagation(); U.sfx('click'); U.emit('select:none'); });
  const tpArt = h('span', { class: 'tp-art' });
  const tpName = h('span', { class: 'tp-name' });
  const tpVer = h('span', { class: 'tp-ver' });
  const statRow = (cls) => {
    const lbl = h('span', { class: 'st-lbl' });
    const val = h('span', { class: 'st-val' });
    const nxt = h('span', { class: 'st-next' });
    const row = h('div', { class: `st ${cls}` }, lbl, val, nxt);
    return { row, lbl, val, nxt };
  };
  const stDmg = statRow('st-dmg');
  const stRate = statRow('st-rate');
  const stRange = statRow('st-range');
  const stSlow = statRow('st-slow');
  const stKills = statRow('st-kills');
  const tpHeat = h('div', { class: 'tp-heat is-hidden' });
  const tpSpecial = h('div', { class: 'tp-special is-hidden' });
  const tgtVal = h('span', { class: 'tgt-val' });
  const tgtLbl = h('span', { class: 'tgt-lbl' });
  const tgt = h('button', { class: 'ui-hit tp-tgt', tabindex: '-1' }, tgtLbl, h('span', { class: 'tgt-arrows' }, '◄ ', tgtVal, ' ►'));
  tgt.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    if (!tower) return;
    const i = MODES.indexOf(tower.targeting || 'first');
    U.emit('cmd:setTargeting', { towerId: tower.id, mode: MODES[(i + 1) % MODES.length] });
    refreshTower();
  });
  const upLbl = h('span', { class: 'act-lbl' });
  const upCost = h('span', { class: 'act-val' });
  const up = h('button', { class: 'ui-hit act act-up', tabindex: '-1' }, h('span', { class: 'act-key' }, 'U'), upLbl, upCost);
  up.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    if (tower) U.emit('cmd:upgrade', { towerId: tower.id });
  });
  const sellLbl = h('span', { class: 'act-lbl' });
  const sellVal = h('span', { class: 'act-val' });
  const sell = h('button', { class: 'ui-hit act act-sell', tabindex: '-1' }, h('span', { class: 'act-key' }, 'S'), sellLbl, sellVal);
  sell.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    if (tower) U.emit('cmd:sell', { towerId: tower.id });
  });
  const tpCaret = h('div', { class: 'pop-caret' });
  const panel = h('div', { class: 'pop pop-tower ui-hit is-hidden' },
    h('div', { class: 'pop-title' }, tpArt, tpName, tpVer, tpClose),
    h('div', { class: 'tp-stats' }, stDmg.row, stRate.row, stRange.row, stSlow.row, stKills.row),
    tpSpecial, tpHeat, tgt,
    h('div', { class: 'tp-acts' }, up, sell),
    tpCaret);

  const el = h('div', { class: 'pops' }, build, panel);

  // ================================================================ state
  let buildSlot = null;
  let tower = null;
  let size = { w: 0, h: 0 };
  let sizeDirty = true;
  let lastKills = -1;
  let lastKb = -1;
  let lastX = -1e9, lastY = -1e9;
  let lastBoss = false;
  let previewing = null;
  let lastShape = -1;
  let lastShapeTower = null;
  let ringV = null;                          // scratch Vector3 (lazy: THREE comes from ctx)
  const ringBox = { l: 0, r: 0, t: 0, b: 0 };
  const ringPt = { x: 0, y: 0, visible: false };

  function preview(type) {
    if (!buildSlot || previewing === type) return;
    previewing = type;
    U.emit('ui:previewRange', { slotId: buildSlot.id, type: type || null });
  }

  function openBuild(slot) {
    tower = null;
    show(panel, false);
    buildSlot = slot;
    previewing = null;
    preview(DEFAULT_PREVIEW); // a range disc right away: how far would an ANTIVIRUS reach from here?
    refreshBuild();
    show(build, true);
    restartAnim(build);
    sizeDirty = true;
    lastX = -1e9;
    position();
  }

  function openTower(tw) {
    buildSlot = null;
    show(build, false);
    const changed = tower !== tw;
    tower = tw;
    refreshTower();
    show(panel, true);
    if (changed) restartAnim(panel);
    sizeDirty = true;
    lastX = -1e9;
    position();
  }

  function close() {
    if (buildSlot && previewing) U.emit('ui:previewRange', { slotId: buildSlot.id, type: null });
    previewing = null;
    buildSlot = null;
    tower = null;
    show(build, false);
    show(panel, false);
  }

  function restartAnim(node) {
    node.classList.remove('pop-in');
    void node.offsetWidth;
    node.classList.add('pop-in');
  }

  function refreshBuild() {
    setText(buildTitle, t('build.title'));
    const kb = game.kb;
    lastKb = kb;
    for (const c of cards) {
      const cost = towerCost(U, c.type);
      setText(c.name, t('tower.' + c.type));
      setText(c.cost, `${cost}KB`);
      setText(c.desc, t(`tower.${c.type}.desc`));
      setText(c.vs, t(`card.vs.${c.type}`));
      c.card.classList.toggle('is-poor', kb < cost);
    }
  }

  function upgradeCost() {
    try { return U.ctx.towers?.upgradeCost?.(tower) ?? null; } catch (e) { return null; }
  }
  function sellValue() {
    try { return Math.round(U.ctx.towers?.sellValue?.(tower) || 0); } catch (e) { return 0; }
  }

  function refreshTower() {
    if (!tower) return;
    const type = tower.type;
    const look = towerLook(type);
    const level = tower.level || 1;
    panel.style.setProperty('--tc', look.css);
    if (tpArt.__type !== type) {
      tpArt.__type = type;
      tpArt.textContent = '';
      tpArt.append(spriteImg('floppy', look.color, 'spr spr-sm'));
    }
    setText(tpName, t('tower.' + type) === 'tower.' + type ? (tower.def?.name || type.toUpperCase()) : t('tower.' + type));
    setText(tpVer, `v${level}.0`);
    const cur = towerStats(tower.def || towerDef(U, type, level), tower);
    const cost = upgradeCost();
    const next = cost != null ? towerStats(towerDef(U, type, level + 1), null) : null;
    const rowSet = (r, lblKey, v, nv, suffix = '') => {
      const has = v !== undefined;
      show(r.row, has);
      if (!has) return;
      setText(r.lbl, t(lblKey));
      setText(r.val, fmtStat(v) + suffix);
      const showNext = nv !== undefined && nv !== null && Math.abs(nv - v) > 0.01;
      setText(r.nxt, showNext ? `▸${fmtStat(nv)}${suffix}` : '');
    };
    rowSet(stDmg, 'panel.dmg', cur.dmg > 0 ? cur.dmg : (type === 'defrag' ? undefined : cur.dmg), next?.dmg);
    rowSet(stRate, 'panel.rate', cur.rate, next?.rate, t('panel.perSec'));
    rowSet(stRange, 'panel.range', cur.range, next?.range);
    rowSet(stSlow, 'panel.slow', cur.slow !== undefined ? Math.round((1 - cur.slow) * 100) : undefined,
      next?.slow !== undefined ? Math.round((1 - next.slow) * 100) : undefined, '%');
    const curDef = tower.def || towerDef(U, type, level);
    const nextDef = cost != null ? towerDef(U, type, level + 1) : null;
    if (curDef && curDef.special) {
      show(tpSpecial, true);
      tpSpecial.classList.remove('is-next');
      setText(tpSpecial, `\u263c ${t('special.' + curDef.special)}`);
    } else if (nextDef && nextDef.special) {
      show(tpSpecial, true);
      tpSpecial.classList.add('is-next');
      setText(tpSpecial, t('special.unlock', { v: `v${level + 1}.0`, what: t('special.' + nextDef.special) }));
    } else show(tpSpecial, false);
    lastKills = tower.kills || 0;
    setText(stKills.lbl, t('panel.kills'));
    setText(stKills.val, fmtNum(lastKills));
    setText(stKills.nxt, '');
    const tgtOn = !NO_TARGETING.has(type);
    show(tgt, tgtOn);
    setText(tgtLbl, t('panel.target'));
    setText(tgtVal, t('target.' + (tower.targeting || 'first')));
    const kb = game.kb;
    lastKb = kb;
    if (cost == null) {
      setText(upLbl, t('panel.max'));
      setText(upCost, '');
      up.classList.add('is-max');
      up.classList.remove('is-poor');
    } else {
      setText(upLbl, `${t('panel.upgrade')} v${level + 1}.0`);
      setText(upCost, `${Math.round(cost)}KB`);
      up.classList.remove('is-max');
      up.classList.toggle('is-poor', kb < cost);
    }
    setText(sellLbl, t('panel.sell'));
    setText(sellVal, `+${sellValue()}KB`);
    // Re-measure only when the panel's shape changed (rows shown/hidden, other tower, level).
    let shape = level * 7 + (tgtOn ? 1 : 0);
    for (const r of [stDmg, stRate, stRange, stSlow]) shape = shape * 2 + (r.row.classList.contains('is-hidden') ? 0 : 1);
    shape = shape * 3 + (tpSpecial.classList.contains('is-hidden') ? 0 : tpSpecial.classList.contains('is-next') ? 1 : 2);
    if (shape !== lastShape || tower !== lastShapeTower) { lastShape = shape; lastShapeTower = tower; sizeDirty = true; }
  }

  function measure() {
    const node = buildSlot ? build : panel;
    size = { w: node.offsetWidth, h: node.offsetHeight };
    sizeDirty = false;
  }

  // On-screen bounding box of the range circle (radius R, world units) around the anchor.
  function ringBounds(anchor, R) {
    const THREE = U.ctx.THREE;
    const view = U.ctx.view;
    if (!THREE || !view || !view.worldToScreen) return null;
    if (!ringV) ringV = new THREE.Vector3();
    let l = Infinity, r = -Infinity, tp = Infinity, b = -Infinity;
    for (let i = 0; i < RING_N; i++) {
      const a = (i / RING_N) * Math.PI * 2;
      ringV.set(anchor.x + Math.cos(a) * R, 0, anchor.z + Math.sin(a) * R);
      let o = null;
      try { o = view.worldToScreen(ringV, ringPt); } catch (e) { o = null; }
      if (!o) return null;
      if (o.x < l) l = o.x;
      if (o.x > r) r = o.x;
      if (o.y < tp) tp = o.y;
      if (o.y > b) b = o.y;
    }
    ringBox.l = l; ringBox.r = r; ringBox.t = tp; ringBox.b = b;
    return ringBox;
  }

  // Place the popup beside the range disc (right, left, then above/below it) so the disc stays
  // readable; falls back to hugging the anchor when nothing fits.
  function position() {
    const node = buildSlot ? build : tower ? panel : null;
    if (!node) return;
    const anchor = buildSlot ? buildSlot.pos : (tower.pos || tower.slot?.pos);
    if (!anchor) return;
    let s = null;
    try { s = U.ctx.view?.worldToScreen?.(anchor); } catch (e) { s = null; }
    if (!s) return;
    if (sizeDirty) { measure(); lastX = -1e9; }
    // keep the banner strip (and the boss bar above it) clear: banners come and go while a popup is open
    const boss = U.root.classList.contains('has-boss');
    if (boss !== lastBoss) { lastBoss = boss; lastX = -1e9; }
    if (Math.abs(s.x - lastX) < 0.5 && Math.abs(s.y - lastY) < 0.5) return;
    lastX = s.x; lastY = s.y;
    const W = size.w, H = size.h;
    const sw = U.size.w, sh = U.size.h;
    const top = (U.hudTop?.() || 0) + Math.round(U.em * (boss ? 4.5 : 2.1)) + 4;
    const bottom = sh - 6;
    const PAD = 8;
    let R = 3.0;
    if (buildSlot) { const d = towerDef(U, DEFAULT_PREVIEW, 1); if (d && d.range > 0) R = d.range; }
    else if (tower && tower.range > 0) R = tower.range;
    const box = ringBounds(anchor, R);
    const yMid = () => clamp(s.y - H / 2, top, Math.max(top, bottom - H));
    const xMid = () => clamp(s.x - W / 2, 6, Math.max(6, sw - W - 6));
    let x = 0, y = 0, side = null;
    if (box) {
      if (box.r + PAD + W <= sw - 6) { side = 'right'; x = box.r + PAD; y = yMid(); }
      else if (box.l - PAD - W >= 6) { side = 'left'; x = box.l - PAD - W; y = yMid(); }
      else if (box.t - PAD - H >= top) { side = 'above'; y = box.t - PAD - H; x = xMid(); }
      else if (box.b + PAD + H <= bottom) { side = 'below'; y = box.b + PAD; x = xMid(); }
    }
    if (!side) {
      // not enough room around the disc: hug the anchor (previous behaviour)
      const gap = Math.max(14, U.em * 1.4);
      if (s.y - gap - H >= top) { y = s.y - gap - H; side = 'above'; }
      else if (s.y + gap + H <= bottom) { y = s.y + gap; side = 'below'; }
      else {
        side = s.x + gap + W <= sw - 6 ? 'right' : 'left';
        y = yMid();
      }
      if (side === 'above' || side === 'below') x = xMid();
      else x = side === 'right' ? s.x + gap : Math.max(6, s.x - gap - W);
    }
    node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    node.dataset.side = side;
    const caret = buildSlot ? buildCaret : tpCaret;
    if (side === 'above' || side === 'below') caret.style.cssText = `left:${Math.round(clamp(s.x - x, 14, W - 14))}px`;
    else caret.style.cssText = `top:${Math.round(clamp(s.y - y, 14, H - 14))}px`;
    node.classList.toggle('is-offscreen', s.visible === false);
  }

  function onSelection(sel) {
    if (!sel) { close(); return; }
    if (sel.kind === 'slot' && sel.slot) openBuild(sel.slot);
    else if (sel.kind === 'tower' && sel.tower) openTower(sel.tower);
    else close();
  }

  function update() {
    if (!buildSlot && !tower) return;
    if (game.kb !== lastKb) {
      if (buildSlot) refreshBuild();
      else refreshTower();
    }
    if (tower) {
      if (tower.slot && tower.slot.tower !== tower) { close(); return; } // sold elsewhere
      if ((tower.kills || 0) !== lastKills) {
        lastKills = tower.kills || 0;
        setText(stKills.val, fmtNum(lastKills));
      }
      let mul = 1;
      try { mul = U.ctx.heat?.fireRateMul?.(tower.pos) ?? 1; } catch (e) { mul = 1; }
      const hot = mul < 1;
      if (hot !== !tpHeat.classList.contains('is-hidden')) {
        show(tpHeat, hot);
        setText(tpHeat, `♨︎ ${t('hud.slowed')} ×${mul}`);
        sizeDirty = true;
      }
    }
    position();
  }

  function relang() {
    if (buildSlot) refreshBuild();
    if (tower) refreshTower();
    sizeDirty = true;
  }

  return {
    el, update, relang, close, onSelection,
    onResize() { sizeDirty = true; lastX = -1e9; },
    refresh() { if (buildSlot) refreshBuild(); if (tower) refreshTower(); },
    get isOpen() { return !!(buildSlot || tower); },
    get tower() { return tower; },
  };
}
