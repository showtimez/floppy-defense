// First-game tutorial: 3 short README.TXT tips. Stored via cmd:setting { key: 'tutorialDone' }.
import { t } from '../core/i18n.js';
import { h, setText, show } from './dom.js';

export function createTutorial(U, { notify, hud }) {
  const { settings, game } = U;
  let step = 0;          // 0 = idle, 1..3 = visible tip, 2.5 = waiting for heat
  let timer = 0;
  let tmp = null;

  const head = h('span', { class: 'tut-head' });
  const text = h('div', { class: 'tut-text' });
  const ok = h('button', { class: 'ui-hit btn btn-small tut-ok', tabindex: '-1' });
  const skip = h('button', { class: 'ui-hit btn btn-small btn-ghost tut-skip', tabindex: '-1' });
  const el = h('div', { class: 'tut ui-hit is-hidden' },
    h('div', { class: 'tut-title' }, h('span', { class: 'tut-file' }), head),
    text, h('div', { class: 'tut-btns' }, skip, ok));

  ok.addEventListener('click', (e) => {
    e.stopPropagation();
    U.sfx('click');
    if (step === 1) setStep(2);
    else if (step === 2) setStep(2.5);
    else if (step === 3) finish();
  });
  skip.addEventListener('click', (e) => { e.stopPropagation(); U.sfx('click'); finish(); });

  function pickSlot() {
    const map = U.ctx.map;
    const slots = (map && map.slots) || [];
    if (!slots.length) return null;
    let target = null;
    try {
      if (!tmp && U.ctx.THREE) tmp = new U.ctx.THREE.Vector3();
      const path = map.paths && map.paths[0];
      if (tmp && path && map.samplePath) target = map.samplePath(0, (path.length || 40) * 0.22, tmp);
    } catch (e) { target = null; }
    let best = null, bestD = Infinity;
    for (const s of slots) {
      if (!s || s.tower || !s.pos) continue;
      const d = target ? (s.pos.x - target.x) ** 2 + (s.pos.z - target.z) ** 2 : s.pos.x;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  function render() {
    if (step < 1 || step === 2.5) return;
    const n = Math.floor(step);
    setText(el.querySelector('.tut-file'), t('tut.file'));
    setText(head, ` — ${t('tut.step', { n })}`);
    setText(text, t(`tut.${n}${U.isTouch ? '.touch' : ''}`));
    setText(ok, t('tut.ok'));
    setText(skip, t('tut.skip'));
  }

  function setStep(s) {
    step = s;
    timer = 0;
    hud.runButton?.classList.toggle('tut-glow', s === 2);
    notify.pointSlot(s === 1 ? pickSlot() : null);
    notify.fanForced = s === 3;
    const visible = s === 1 || s === 2 || s === 3;
    U.root.classList.toggle('tut-on', visible); // CSS hides the hint line while a tip is up
    if (visible) {
      render();
      show(el, true);
      el.classList.remove('pop-in');
      void el.offsetWidth;
      el.classList.add('pop-in');
      el.dataset.step = String(s);
    } else show(el, false);
  }

  function finish() {
    const was = step;
    setStep(0);
    if (was && !settings.tutorialDone) U.emit('cmd:setting', { key: 'tutorialDone', value: true });
  }

  function onGameNew({ restored = false } = {}) {
    setStep(0);
    // a restored run (LKG after a BSOD) resumes mid-campaign: no "first floppy" tips there
    if (!restored && !settings.tutorialDone && game.mode === 'campaign') setStep(1);
  }

  const off = [];
  const on = (name, fn) => off.push(U.events.on(name, fn));
  on('tower:placed', () => { if (step === 1) setStep(2); });
  on('wave:start', () => { if (step === 1 || step === 2) setStep(2.5); });
  on('heat:start', () => { if (step === 2.5) setStep(3); });
  on('heat:cooled', () => { if (step === 3) finish(); });
  on('wave:cleared', ({ wave }) => { if (step === 2.5 && wave >= 2) finish(); });
  on('gameover', () => setStep(0));
  on('victory', () => setStep(0));

  function update(dt) {
    if (!step) return;
    timer += dt;
    if (step === 1 && timer > 0.5 && timer < 0.6) notify.pointSlot(pickSlot()); // map may finish building late
    if (step === 3 && timer > 12) finish();
  }

  function onPhase(to) {
    if (to === 'menu' || to === 'boot') setStep(0);
    el.classList.toggle('is-paused', to === 'paused');
  }

  return { el, update, onGameNew, onPhase, relang: render, finish, get step() { return step; } };
}
