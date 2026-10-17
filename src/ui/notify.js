// Banners (typewriter), heat warning line, DOS error box, fan pointer, tutorial slot pointer.
import { t } from '../core/i18n.js';
import { h, setText, show, icon, pulse } from './dom.js';
import { heatTempOf } from './hud.js';

export function createNotify(U) {
  const { game } = U;

  // ---------------------------------------------------------------- main banner
  // Each line = typed part + invisible remainder, so the box keeps its final size while typing.
  const mkLine = (cls) => {
    const vis = h('span', { class: 'tw' });
    const ghost = h('span', { class: 'tw-ghost' });
    return { el: h('div', { class: cls }, vis, ghost), vis, ghost };
  };
  const L1 = mkLine('bn-l1');
  const L2 = mkLine('bn-l2');
  const L3 = mkLine('bn-l3');
  const LINES = [L1, L2, L3];
  const bIcon = h('span', { class: 'bn-ico' });
  const banner = h('div', { class: 'banner is-hidden' }, bIcon, h('div', { class: 'bn-txt' }, L1.el, L2.el, L3.el));
  let cur = null; // { lines: [s1,s2,s3], cls, dur, prio, warn, time, shown, skip }
  const queue = [];
  const CPS1 = 46, CPS2 = 120; // typewriter speed (chars/s): headline, then the smaller lines
  const MIN_READ = 0.9;        // s a banner stays fully typed before fading, whatever its duration
  let shortMq = null;
  try { shortMq = matchMedia('(max-height: 470px)'); } catch (e) { shortMq = null; }

  // The banner is a one-line strip under the HUD: line 2 (flavour) is dropped when the strip would
  // not fit (or on short screens, via CSS), so the actionable parts (name, KB bonus, tip) stay whole.
  function start(spec) {
    cur = spec;
    cur.time = 0;
    cur.shown = [-1, -1, -1];
    cur.skip = [false, !!(shortMq && shortMq.matches), false];
    banner.className = `banner ${spec.cls}`;
    show(banner, true);
    pulse(banner, [{ opacity: 0, transform: 'scaleY(0.2)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 220, easing: 'ease-out' });
    bIcon.textContent = '';
    if (spec.warn) bIcon.append(icon('warn'));
    show(bIcon, spec.warn);
    LINES.forEach((L, i) => {
      setText(L.vis, '');
      setText(L.ghost, spec.lines[i]);
      L.vis.classList.remove('typing');
      show(L.el, !!spec.lines[i]);
    });
    // One forced layout per banner (rare): drop the flavour line if anything got clipped.
    if (spec.lines[1] && !cur.skip[1]) {
      const clipped = LINES.some((L) => L.el.offsetParent && L.el.scrollWidth > L.el.clientWidth + 1);
      if (clipped) { cur.skip[1] = true; show(L2.el, false); }
    }
    const len = (i) => (cur.skip[i] ? 0 : spec.lines[i].length);
    const typeTime = len(0) / CPS1 + (len(1) + len(2)) / CPS2;
    cur.dur = Math.max(spec.dur, typeTime + MIN_READ);
    U.root.classList.add('has-banner');
  }

  // Higher/equal priority replaces the current banner (re-queued if it was barely seen); lower waits.
  function bannerShow(lines, { cls = '', dur = 2.6, prio = 1, warn = false } = {}) {
    const spec = { lines: [lines[0] || '', lines[1] || '', lines[2] || ''], cls, dur, prio, warn: !!warn };
    if (cur && cur.time < cur.dur - 0.3) {
      if (prio < cur.prio) {
        if (queue.length < 3) queue.push(spec);
        return;
      }
      if (cur.time < cur.dur * 0.5 && queue.length < 3) queue.unshift({ ...cur });
    }
    start(spec);
  }

  function bannerUpdate(dt) {
    if (!cur) return;
    cur.time += dt;
    const s1 = cur.lines[0];
    const s2 = cur.skip[1] ? '' : cur.lines[1];
    const s3 = cur.lines[2];
    const n1 = Math.min(s1.length, Math.floor(cur.time * CPS1));
    const t2 = Math.max(0, cur.time - s1.length / CPS1);
    const n2 = Math.min(s2.length, Math.floor(t2 * CPS2));
    const t3 = Math.max(0, t2 - s2.length / CPS2);
    const n3 = Math.min(s3.length, Math.floor(t3 * CPS2));
    const ns = [n1, n2, n3];
    for (let i = 0; i < 3; i++) {
      const n = ns[i];
      if (n === cur.shown[i]) continue;
      cur.shown[i] = n;
      const s = i === 1 ? s2 : cur.lines[i];
      const L = LINES[i];
      setText(L.vis, s.slice(0, n));
      setText(L.ghost, s.slice(n));
      L.vis.classList.toggle('typing', n > 0 && n < s.length);
    }
    if (cur.time >= cur.dur && !banner.classList.contains('out')) banner.classList.add('out');
    if (cur.time >= cur.dur + 0.35) {
      cur = null;
      const next = queue.shift();
      if (next) start(next);
      else { show(banner, false); U.root.classList.remove('has-banner'); }
    }
  }

  // ---------------------------------------------------------------- heat warning line (persistent while hot)
  const heatTxt = h('span');
  const heatLine = h('div', { class: 'heat-line is-hidden' }, h('span', { class: 'hl-ico' }, '\u2668\ufe0e '), heatTxt);
  let heatMode = null; // null | 'warn' | 'over'
  let lastHeatKey = null, lastHeatSpot = null, lastHeatTemp = -1;

  function heatUpdate() {
    const ha = U.ctx.heat?.active;
    const inPlay = game.phase === 'prep' || game.phase === 'wave';
    let mode = null;
    if (inPlay && ha && ha.spot) mode = ha.overheated ? 'over' : ha.level >= 0.5 ? 'warn' : null;
    if (mode !== heatMode) {
      heatMode = mode;
      show(heatLine, !!mode);
      heatLine.classList.toggle('is-over', mode === 'over');
      lastHeatKey = null;
    }
    if (mode) {
      const key = mode === 'over' ? (U.isTouch ? 'banner.overheatTouch' : 'banner.overheat')
        : (U.isTouch ? 'banner.heatWarnTouch' : 'banner.heatWarn');
      const temp = heatTempOf(U, ha);
      if (key !== lastHeatKey || ha.spot !== lastHeatSpot || temp !== lastHeatTemp) {
        lastHeatKey = key; lastHeatSpot = ha.spot; lastHeatTemp = temp;
        setText(heatTxt, t(key, { spot: ha.spot.name || String(ha.spot.id || '').toUpperCase(), temp }));
      }
    }
    return mode;
  }

  // ---------------------------------------------------------------- DOS error box
  const errTitle = h('div', { class: 'de-title' });
  const errMsg = h('div', { class: 'de-msg' });
  const errDetail = h('div', { class: 'de-detail' });
  const errOk = h('button', { class: 'ui-hit de-ok', tabindex: '-1' }, '[ OK ]');
  // The box itself lets clicks through to the board (only [ OK ] is clickable): an error must never
  // swallow the next tap on a drive bay.
  const err = h('div', { class: 'dos-err is-hidden', role: 'alert' }, errTitle, errMsg, errDetail, h('div', { class: 'de-btns' }, errOk));
  let errTime = 0;
  errOk.addEventListener('click', (e) => { e.stopPropagation(); U.sfx('click'); errTime = 0; hideErr(); });
  function hideErr() { show(err, false); }

  function error(msg, detail = '', { title = t('err.title'), dur = 2.2, cls = '' } = {}) {
    setText(errTitle, ` ${title} `);
    setText(errMsg, msg);
    setText(errDetail, detail);
    show(errDetail, !!detail);
    err.className = `dos-err ${cls}`;
    errTime = dur;
    err.classList.remove('shake');
    void err.offsetWidth;
    err.classList.add('shake');
  }

  // ---------------------------------------------------------------- fan pointer
  const fanLbl = h('span', { class: 'fp-lbl' });
  const fanPtr = h('div', { class: 'fan-ptr is-hidden' }, h('div', { class: 'fp-ring' }), h('div', { class: 'fp-ring r2' }),
    h('div', { class: 'fp-arrow' }, fanLbl, h('span', { class: 'fp-tri' }, '▼')));
  let fanForced = false;
  let fanX = -1, fanY = -1;

  function fanUpdate(heatMode) {
    const ha = U.ctx.heat?.active;
    const inPlay = game.phase === 'prep' || game.phase === 'wave';
    const want = inPlay && (fanForced || !!heatMode || !!(ha && ha.level >= 0.35));
    const fan = U.ctx.map?.fan;
    if (!want || !fan || !fan.pos) { if (!fanPtr.classList.contains('is-hidden')) show(fanPtr, false); return; }
    let s = null;
    try { s = U.ctx.view?.worldToScreen?.(fan.pos); } catch (e) { s = null; }
    if (!s || s.visible === false) { show(fanPtr, false); return; }
    if (fanPtr.classList.contains('is-hidden')) { show(fanPtr, true); setText(fanLbl, t(U.isTouch ? 'fan.tap' : 'fan.click')); }
    const fx = Math.round(s.x), fy = Math.round(s.y);
    if (fx !== fanX || fy !== fanY) { fanX = fx; fanY = fy; fanPtr.style.transform = `translate(${fx}px, ${fy}px)`; }
    fanPtr.classList.toggle('is-over', heatMode === 'over');
  }

  // ---------------------------------------------------------------- slot pointer (tutorial)
  const slotLbl = h('span', { class: 'fp-lbl' });
  const slotPtr = h('div', { class: 'slot-ptr is-hidden' }, h('i', { class: 'c1' }), h('i', { class: 'c2' }), h('i', { class: 'c3' }), h('i', { class: 'c4' }),
    h('div', { class: 'sp-arrow' }, slotLbl));
  let slotTarget = null;
  let slotX = -1, slotY = -1;
  function pointSlot(slot) { slotTarget = slot || null; if (!slot) show(slotPtr, false); }
  function slotUpdate() {
    if (!slotTarget) return;
    if (slotTarget.tower || !(game.phase === 'prep' || game.phase === 'wave')) { show(slotPtr, false); return; }
    let s = null;
    try { s = U.ctx.view?.worldToScreen?.(slotTarget.pos); } catch (e) { s = null; }
    if (!s || s.visible === false) { show(slotPtr, false); return; }
    if (slotPtr.classList.contains('is-hidden')) { show(slotPtr, true); setText(slotLbl, t(U.isTouch ? 'ptr.tap' : 'ptr.click')); }
    const sx = Math.round(s.x), sy = Math.round(s.y);
    if (sx !== slotX || sy !== slotY) { slotX = sx; slotY = sy; slotPtr.style.transform = `translate(${sx}px, ${sy}px)`; }
  }

  const el = h('div', { class: 'notify' }, slotPtr, fanPtr, banner, heatLine, err);

  function update(dt) {
    bannerUpdate(dt);
    const hm = heatUpdate();
    fanUpdate(hm);
    slotUpdate();
    if (errTime > 0) { errTime -= dt; if (errTime <= 0) hideErr(); }
  }

  function clear() {
    cur = null;
    queue.length = 0;
    show(banner, false);
    U.root.classList.remove('has-banner');
    hideErr();
    errTime = 0;
    fanForced = false;
    pointSlot(null);
    heatMode = null;
    show(heatLine, false);
    show(fanPtr, false);
  }

  return {
    el, update, clear, banner: bannerShow, error, pointSlot,
    set fanForced(v) { fanForced = !!v; },
    relang() {
      lastHeatKey = null;
      setText(fanLbl, t(U.isTouch ? 'fan.tap' : 'fan.click'));
      setText(slotLbl, t(U.isTouch ? 'ptr.tap' : 'ptr.click'));
    },
  };
}
