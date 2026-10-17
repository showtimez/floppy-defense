// BOOT screen: Award-style BIOS POST. Any key / tap unlocks audio and boots into the menu.
import { t } from '../core/i18n.js';
import { h, setText, show, applyI18n } from './dom.js';
import { spriteImg } from './sprites.js';

export function createBoot(U) {
  const L = (cls = '') => h('div', { class: `post-line is-hidden ${cls}` });

  // Energy-Star-ish logo drawn with CP437 characters (all present in common monospace fonts so
  // the box stays aligned). Each inner row is padded to exactly INNER columns.
  const INNER = 20;
  const row = (segs) => {
    let len = 0;
    let html = '<span class="pl-b">║</span>';
    for (const [txt, cls] of segs) { len += txt.length; html += cls ? `<span class="${cls}">${txt}</span>` : txt; }
    return html + ' '.repeat(Math.max(0, INNER - len)) + '<span class="pl-b">║</span>';
  };
  const logo = h('pre', { class: 'post-logo', 'aria-hidden': 'true' });
  logo.innerHTML = [
    `<span class="pl-b">╔${'═'.repeat(INNER)}╗</span>`,
    row([['  ', ''], ['*', 'pl-s'], ['  ', ''], ['☼', 'pl-y'], ['   .   ', 'pl-s'], ['*', 'pl-s']]),
    row([['   ', ''], ['e n e r g y', 'pl-g'], ['  ', ''], ['☼', 'pl-y']]),
    row([['  ', ''], ['─'.repeat(16), 'pl-s']]),
    row([['   ', ''], ['LD60', 'pl-y'], [' ', ''], ['ALLY', 'pl-g']]),
    `<span class="pl-b">╚${'═'.repeat(INNER)}╝</span>`,
  ].join('\n');

  const award = spriteImg('award', 0x2f6bff, 'spr post-award');
  const head1 = h('div', { class: 'post-line' }, h('span', { t: 'boot.bios1' }));
  const head2 = h('div', { class: 'post-line', t: 'boot.bios2' });
  const rev = L('post-bright');
  const cpu = L();
  const base = L();
  const ext = L();
  const pnp1 = L();
  const pnp2 = L();
  const ide = [L('post-ide'), L('post-ide'), L('post-ide'), L('post-ide')];
  const fdd = L();
  const press = L('post-press');
  const pressText = h('span');
  const cursor = h('span', { class: 'cursor' }, '_');
  press.append(pressText, cursor);
  const booting = L('post-bright');

  const bottom = h('div', { class: 'post-bottom' },
    h('div', { t: 'boot.setup' }),
    h('div', { t: 'boot.footer' }));

  const el = h('div', { class: 'scr scr-boot ui-hit is-hidden', role: 'button', 'aria-label': 'boot' },
    h('div', { class: 'post-top' }, h('div', { class: 'post-head' }, award, h('div', null, head1, head2)), logo),
    h('div', { class: 'post-body' }, rev, h('div', { class: 'post-gap' }), cpu, base, ext, h('div', { class: 'post-gap' }),
      pnp1, pnp2, ...ide, fdd, h('div', { class: 'post-gap' }), press, booting),
    bottom);

  const IDE_KEYS = [['boot.pm', 'boot.hdd'], ['boot.ps', 'boot.none'], ['boot.sm', 'boot.cd'], ['boot.ss', 'boot.none']];
  const IDE_AT = [1.95, 2.15, 2.32, 2.5];
  let time = 0;
  let t0 = 0;
  let active = false;
  let leaving = false;
  let leaveTimer = 0;

  function texts() {
    setText(rev, t('boot.rev'));
    setText(cpu, t('boot.cpu'));
    setText(pnp1, t('boot.pnp1'));
    setText(pnp2, t('boot.pnp2'));
    setText(fdd, t('boot.fdd'));
    setText(pressText, t(U.isTouch ? 'boot.pressTouch' : 'boot.press'));
    setText(booting, t('boot.booting'));
  }

  function memLine(elm, label, value, ok) {
    setText(elm, `${label} ${String(value).padStart(6, ' ')}K${ok ? ' ' + t('boot.ok') : ''}`);
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  function start() {
    time = 0;
    t0 = now();
    active = true;
    leaving = false;
    for (const l of [rev, cpu, base, ext, pnp1, pnp2, ...ide, fdd, press, booting]) show(l, false);
    texts();
    show(el, true);
    U.setKeyOwner(onKey);
  }

  function hide() {
    active = false;
    show(el, false);
    U.releaseKeyOwner(onKey);
  }

  function boot() {
    if (!active || leaving) return;
    leaving = true;
    leaveTimer = now() + 0.5;
    try { U.ctx.audio?.unlock?.(); } catch (e) { /* ignore */ }
    U.sfx('boot');
    setTimeout(() => U.sfx('diskLoad'), 160);
    t0 = Math.min(t0, now() - 3.2); // reveal everything
    update(0);
    show(press, false);
    show(booting, true);
  }

  function onKey(e) {
    if (e.repeat) return true;
    boot();
    return true;
  }

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { window.focus(); } catch (err) { /* ignore */ }
    boot();
  });
  // Mobile browsers only accept touchend/click as audio-unlocking gestures (pointerdown is too early).
  const unlockAudio = () => { try { U.ctx.audio?.unlock?.(); } catch (err) { /* ignore */ } };
  el.addEventListener('pointerup', unlockAudio);
  el.addEventListener('click', unlockAudio);

  function update(dt) {
    if (!active) return;
    time = now() - t0; // wall clock: the POST finishes on time even if frames hitch
    const on = (elm, at) => { if (time >= at && elm.classList.contains('is-hidden') && !(leaving && elm === press)) show(elm, true); };
    on(rev, 0.15);
    on(cpu, 0.35);
    on(base, 0.45);
    if (time >= 0.45) {
      const k = Math.min(1, (time - 0.45) / 0.35);
      memLine(base, t('boot.base'), Math.floor(k * 10) * 64, k >= 1);
    }
    on(ext, 0.85);
    if (time >= 0.85) {
      const k = Math.min(1, (time - 0.85) / 0.8);
      memLine(ext, t('boot.ext'), k >= 1 ? 16384 : Math.floor(k * 256) * 64, k >= 1);
    }
    on(pnp1, 1.75);
    on(pnp2, 1.8);
    for (let i = 0; i < 4; i++) {
      on(ide[i], IDE_AT[i]);
      if (time >= IDE_AT[i]) {
        const done = time >= IDE_AT[i] + 0.14;
        setText(ide[i], `   ${t(IDE_KEYS[i][0])} ${done ? t(IDE_KEYS[i][1]) : ''}`);
      }
    }
    on(fdd, 2.75);
    on(press, 2.95);
    if (leaving) {
      if (now() >= leaveTimer) {
        leaving = false;
        active = false;
        U.emit('cmd:menu');
      }
    }
  }

  function relang() {
    applyI18n(el);
    texts();
  }

  return { el, start, hide, update, relang, get active() { return active; } };
}
