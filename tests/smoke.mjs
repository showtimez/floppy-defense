// FLOPPY DEFENSE smoke tests (npm test).
// Needs the dev server (npm run dev -> http://localhost:5180) or BASE_URL=<url>. Uses the local Chrome (fallback Edge).
// Usage: node tests/smoke.mjs [unit boot autoplay idle mobile desktop iframe] [--strict] [--headed]
//   --strict  treat SKIP (prerequisite module still a stub) as failure
//   SMOKE_DIST=dist  the iframe scenario embeds that static build instead of BASE_URL (run "npm run build" first)
// Screenshots + JSON report in tests/out/. Exit code 1 on any failure.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE_URL, OUT_DIR, ensureOut, launch, serverUp, openPage, READINESS, SNAPSHOT, CANVAS_STATS, VITE_OVERLAY, summarizeErrors, sleep, pad,
  startIframeHost,
} from './lib.mjs';
import { runUnit } from './unit.mjs';

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const HEADED = argv.includes('--headed');
const ONLY = argv.filter((a) => !a.startsWith('--'));
const T_SCALE = Number(process.env.SMOKE_TIMEOUT_SCALE) || 1;

class Skip extends Error {}
const skip = (msg) => { throw new Skip(msg); };
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const url = (q) => `${BASE_URL}/${q}`;
const shot = (page, name) => page.screenshot({ path: join(OUT_DIR, `${name}.png`) }).catch(() => {});

async function waitFd(page, timeout = 20000) {
  try {
    await page.waitForFunction(() => !!(window.__FD && window.__FD.game && window.__FD.loop), null, { timeout });
  } catch (err) {
    const overlay = await page.evaluate(VITE_OVERLAY).catch(() => null);
    const partial = await page.evaluate(() => (window.__FD ? 'window.__FD exists but main.js did not finish (no ctx.loop)' : 'window.__FD never set: main.js failed to load/evaluate')).catch(() => '');
    throw new Error(`game did not boot within ${timeout / 1000}s: ${partial}${overlay ? `\nvite: ${overlay}` : ''}`);
  }
}

// Poll until predicate(snapshot) is true; returns the last snapshot. onTick gets every snapshot.
async function pollUntil(page, predicate, { timeout, every = 500, onTick } = {}) {
  const t0 = Date.now();
  let snap = null;
  while (Date.now() - t0 < timeout) {
    snap = await page.evaluate(SNAPSHOT).catch(() => null);
    if (snap && onTick) await onTick(snap);
    if (snap && predicate(snap)) return { ok: true, snap, ms: Date.now() - t0 };
    await sleep(every);
  }
  return { ok: false, snap, ms: Date.now() - t0 };
}

function noErrors(env, label = '') {
  assert(!env.errors.length, `${env.errors.length} console/page error(s)${label}:\n  ${summarizeErrors(env.errors).join('\n  ')}`);
}

// Find on-screen, unobstructed slot positions (page coords), most central first.
const FIND_SLOTS = (wantFree) => {
  const fd = window.__FD;
  const canvas = fd.view.renderer.domElement;
  const rect = fd.container.getBoundingClientRect();
  const out = [];
  for (const s of fd.map.slots) {
    if (wantFree && s.tower) continue;
    const p = fd.view.worldToScreen(s.pos);
    if (!p || p.visible === false) continue;
    const x = rect.left + p.x;
    const y = rect.top + p.y;
    if (x < 24 || y < 24 || x > innerWidth - 24 || y > innerHeight - 24) continue;
    if (document.elementFromPoint(x, y) !== canvas) continue;
    const pick = fd.input.pickAt ? fd.input.pickAt(x, y, 'mouse') : null;
    if (pick && pick.kind === 'slot' && pick.slot !== s) continue;
    out.push({ id: s.id, x, y, d: Math.hypot(x - innerWidth / 2, y - innerHeight / 2) });
  }
  return out.sort((a, b) => a.d - b.d);
};

// A canvas point where nothing is pickable (for select:none).
const FIND_EMPTY = () => {
  const fd = window.__FD;
  const canvas = fd.view.renderer.domElement;
  for (let gy = 0.25; gy <= 0.9; gy += 0.05) {
    for (let gx = 0.05; gx <= 0.95; gx += 0.05) {
      const x = innerWidth * gx;
      const y = innerHeight * gy;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      if (!fd.input.pickAt(x, y, 'touch')) return { x, y };
    }
  }
  return null;
};

const FAN_POINT = () => {
  const fd = window.__FD;
  const f = fd.map.fan;
  if (!f || !f.pos) return null;
  const p = fd.view.worldToScreen(f.pos);
  if (!p || p.visible === false) return null;
  const rect = fd.container.getBoundingClientRect();
  const x = rect.left + p.x;
  const y = rect.top + p.y;
  if (document.elementFromPoint(x, y) !== fd.view.renderer.domElement) return null;
  return { x, y };
};

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------
const scenarios = {
  // (0) Node-only unit tests of economy / heat / autoplay strategy (no browser needed).
  async unit(_browser, ctx) {
    const res = await runUnit({ print: false });
    const bad = res.filter((r) => !r.ok);
    ctx.details.push(`${res.length - bad.length}/${res.length} unit tests passed`);
    assert(!bad.length, bad.map((r) => `${r.name}: ${r.error}`).join('\n'));
  },

  // (a) boot screen renders, no console errors, modules created.
  async boot(browser, ctx) {
    const env = await openPage(browser);
    ctx.env = env;
    await env.page.goto(url('?mute=1'), { waitUntil: 'load' });
    await waitFd(env.page);
    await sleep(2500);
    const ready = await env.page.evaluate(READINESS);
    const T = await env.page.evaluate(() => window.__T);
    const canvas = await env.page.evaluate(CANVAS_STATS);
    await shot(env.page, 'a-boot');
    ctx.readiness = ready;
    ctx.details.push(`canvas ${canvas.w}x${canvas.h} lum ${canvas.mean}±${canvas.std}`, `phases ${T.phases.join('>')}`);
    assert(T.installed, 'test hook could not attach to window.__FD');
    assert(T.phases[0] === 'boot', `expected initial phase 'boot', got '${T.phases[0]}'`);
    assert(!ready.bootErrors.length, `module(s) failed to initialise: ${ready.bootErrors.join('; ')}`);
    assert(ready.renderer, 'renderer missing (view.scene/camera/renderer)');
    assert(!canvas.error && canvas.w > 0 && canvas.h > 0, `canvas not rendering: ${canvas.error || 'zero size'}`);
    if (canvas.std < 1.5) ctx.warn.push('canvas looks almost uniform (blank board?)');
    if (!ready.ui) ctx.warn.push('#ui is empty (UI module still a stub?)');
    noErrors(env);
  },

  // (b) bot plays until wave >= 3; phase transitions sane; no errors.
  async autoplay(browser, ctx) {
    const env = await openPage(browser);
    ctx.env = env;
    await env.page.goto(url('?autostart=1&autoplay=1&turbo=8&mute=1&debug=1&seed=7&quality=low'), { waitUntil: 'load' });
    await waitFd(env.page);
    const ready = await env.page.evaluate(READINESS);
    let shotWave = false;
    const res = await pollUntil(env.page, (s) => s.wave >= 3 || s.phase === 'gameover' || s.phase === 'victory', {
      timeout: 150000 * T_SCALE,
      onTick: async (s) => {
        if (!shotWave && s.phase === 'wave' && s.enemies >= 3) { shotWave = true; await shot(env.page, 'b-autoplay-wave'); }
      },
    });
    await sleep(600);
    const T = await env.page.evaluate(() => window.__T);
    const log = await env.page.evaluate(() => window.__FD.autoplayLog || []);
    const snap = await env.page.evaluate(SNAPSHOT);
    await shot(env.page, 'b-autoplay-end');
    ctx.details.push(
      `reached wave ${snap.wave} (${snap.phase}) in ${(res.ms / 1000).toFixed(0)}s real, sim ${snap.time}s`,
      `kb ${snap.kb} cpu ${snap.cpu}% towers ${snap.towers} kills ${snap.stats.kills} leaks ${snap.stats.leaks}`,
      `events wave:start ${T.events['wave:start'] || 0}, wave:cleared ${T.events['wave:cleared'] || 0}, tower:placed ${T.events['tower:placed'] || 0}, kb reasons ${JSON.stringify(T.kbReasons)}`,
      ...log.map((r) => `  log w${r.wave} cpu ${r.cpu} kb ${r.kb} towers ${r.towers} (${r.mix}) leaks ${r.leaks}`),
    );
    assert(T.phases.includes('prep') && T.phases.includes('wave'), `phase transitions missing prep/wave: ${T.phases.join('>')}`);
    if (!res.ok) {
      throw new Error(`timeout: stuck at wave ${snap.wave} phase '${snap.phase}', enemies alive ${snap.enemies}` +
        (ready.waves ? '' : ' (waves module looks like a stub)'));
    }
    assert(snap.phase !== 'gameover' || snap.wave >= 3, `bot lost (BSOD) at wave ${snap.wave} - balance or bot problem`);
    assert((T.events['wave:start'] || 0) >= 2, 'fewer than 2 wave:start events');
    for (let i = 1; i < T.phases.length; i++) {
      const [a, b] = [T.phases[i - 1], T.phases[i]];
      const okEdge = (a === 'prep' && ['wave', 'paused'].includes(b)) || (a === 'wave' && ['prep', 'paused', 'gameover', 'victory'].includes(b)) ||
        (a === 'paused') || (a === 'menu' && b === 'prep') || (a === 'boot');
      assert(okEdge, `unexpected phase transition ${a} -> ${b}`);
    }
    if (ready.towers && ready.mapSlots) assert((T.events['tower:placed'] || 0) > 0, 'bot placed no towers although towers + map slots exist');
    else ctx.warn.push(`bot could not build (${ready.towers ? '' : 'towers stub '}${ready.mapSlots ? '' : 'no map slots'})`);
    if (ready.waves) assert((T.events['enemy:spawn'] || 0) > 0 || snap.stats.kills > 0, 'no enemy spawned although waves.info has groups');
    noErrors(env);
  },

  // (c) a bot that builds nothing must lose: BSOD.
  async idle(browser, ctx) {
    const env = await openPage(browser);
    ctx.env = env;
    await env.page.goto(url('?autostart=1&autoplay=idle&turbo=10&mute=1&seed=3&quality=low'), { waitUntil: 'load' });
    await waitFd(env.page);
    const ready = await env.page.evaluate(READINESS);
    if (!ready.waves) skip('waves/enemies module still a stub (waves.info(1).groups empty): nothing can reach the CPU');
    const res = await pollUntil(env.page, (s) => s.phase === 'gameover' || s.phase === 'victory', { timeout: 240000 * T_SCALE });
    await sleep(2000);
    const snap = await env.page.evaluate(SNAPSHOT);
    const T = await env.page.evaluate(() => window.__T);
    await shot(env.page, 'c-bsod');
    ctx.details.push(`ended '${snap.phase}' at wave ${snap.wave} after ${(res.ms / 1000).toFixed(0)}s real, cpu ${snap.cpu}%, leaks ${snap.stats.leaks}, cpu:damage events ${T.events['cpu:damage'] || 0}`);
    assert(res.ok, `timeout: phase '${snap.phase}' wave ${snap.wave} cpu ${snap.cpu}% (leaks ${snap.stats.leaks})`);
    assert(snap.phase === 'gameover', `idle bot did not lose: phase '${snap.phase}' (campaign far too easy?)`);
    assert(snap.cpu <= 0, `gameover with cpu ${snap.cpu}%`);
    assert((T.events.gameover || 0) === 1, `gameover emitted ${T.events.gameover || 0} times`);
    noErrors(env);
  },

  // (d) phone landscape with touch: tap a slot -> selection:change; tap empty -> deselect; tap fan -> fan:click.
  async mobile(browser, ctx) {
    const env = await openPage(browser, { width: 844, height: 390, mobile: true });
    ctx.env = env;
    await env.page.goto(url('?autostart=1&mute=1&seed=1&quality=low'), { waitUntil: 'load' });
    await waitFd(env.page);
    await sleep(1500);
    const ready = await env.page.evaluate(READINESS);
    if (!ready.mapSlots) skip('map has no slots (world module still a stub)');
    const slots = await env.page.evaluate(FIND_SLOTS, true);
    assert(slots.length, 'no visible, unobstructed free slot on screen at 844x390');
    const target = slots[0];
    const before = (await env.page.evaluate(() => window.__T.events['selection:change'])) || 0;
    await env.page.touchscreen.tap(target.x, target.y);
    await sleep(400);
    let st = await env.page.evaluate(() => ({
      n: window.__T.events['selection:change'] || 0,
      sel: window.__FD.game.selected ? { kind: window.__FD.game.selected.kind, id: window.__FD.game.selected.slot && window.__FD.game.selected.slot.id } : null,
      hover: window.__FD.input.hoveredSlot ? window.__FD.input.hoveredSlot.id : null,
    }));
    await shot(env.page, 'd-mobile-select');
    ctx.details.push(`tapped slot #${target.id} at (${target.x.toFixed(0)},${target.y.toFixed(0)}) of ${slots.length} visible -> ${JSON.stringify(st.sel)}`);
    assert(st.n > before, 'tap on a slot produced no selection:change');
    assert(st.sel && st.sel.kind === 'slot' && st.sel.id === target.id, `wrong selection after tap: ${JSON.stringify(st.sel)}`);
    assert(st.hover == null, 'touch must not set hover');

    const empty = await env.page.evaluate(FIND_EMPTY);
    if (empty) {
      await env.page.touchscreen.tap(empty.x, empty.y);
      await sleep(300);
      st = await env.page.evaluate(() => window.__FD.game.selected);
      assert(st == null, 'tap on empty board did not clear the selection');
    } else ctx.warn.push('no empty canvas point found for the deselect check');

    const fan = await env.page.evaluate(FAN_POINT);
    if (fan) {
      const n0 = (await env.page.evaluate(() => window.__T.events['fan:click'])) || 0;
      await env.page.touchscreen.tap(fan.x, fan.y);
      await sleep(300);
      const n1 = (await env.page.evaluate(() => window.__T.events['fan:click'])) || 0;
      assert(n1 > n0, 'tap on the fan did not emit fan:click');
    } else ctx.warn.push('fan not visible/unobstructed on mobile');

    // Swipe (drag > 10 px) must NOT select.
    const s2 = slots[1] || slots[0];
    const sel0 = (await env.page.evaluate(() => window.__T.events['select:slot'])) || 0;
    const cdp = await env.context.newCDPSession(env.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s2.x, y: s2.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s2.x + 40, y: s2.y + 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    const sel1 = (await env.page.evaluate(() => window.__T.events['select:slot'])) || 0;
    assert(sel1 === sel0, 'a drag gesture was treated as a tap');
    noErrors(env);
  },

  // (e) desktop mouse + keyboard: hover, click select, Esc, quickbuild via hover, Space, P/Esc pause, F speed, fan click.
  async desktop(browser, ctx) {
    const env = await openPage(browser);
    ctx.env = env;
    const { page } = env;
    await page.goto(url('?autostart=1&mute=1&seed=2&quality=low&debug=1'), { waitUntil: 'load' });
    await waitFd(page);
    await sleep(1500);
    const ready = await page.evaluate(READINESS);
    if (!ready.mapSlots) skip('map has no slots (world module still a stub)');
    const slots = await page.evaluate(FIND_SLOTS, true);
    assert(slots.length >= 2, 'need 2 visible free slots at 960x600');
    const [a, b] = slots;
    const q = (fn) => page.evaluate(fn);

    await page.mouse.move(a.x - 30, a.y - 30);
    await page.mouse.move(a.x, a.y, { steps: 4 });
    await sleep(250);
    const hov = await q(() => (window.__FD.input.hoveredSlot ? window.__FD.input.hoveredSlot.id : null));
    const cursor = await q(() => window.__FD.view.renderer.domElement.style.cursor);
    assert(hov === a.id, `hover: expected slot #${a.id}, got ${hov}`);
    assert(cursor === 'pointer', `cursor over slot should be 'pointer', got '${cursor}'`);

    await page.mouse.click(a.x, a.y);
    await sleep(250);
    let sel = await q(() => (window.__FD.game.selected ? window.__FD.game.selected.kind : null));
    assert(sel === 'slot', `click on slot: selection ${sel}`);
    await shot(page, 'e-desktop-select');
    await page.keyboard.press('Escape');
    await sleep(150);
    sel = await q(() => window.__FD.game.selected);
    let phase = await q(() => window.__FD.game.phase);
    assert(sel == null && phase === 'prep', `Esc with selection should deselect without pausing (sel ${JSON.stringify(sel)}, phase ${phase})`);

    // Quickbuild on the hovered slot.
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await sleep(250);
    const pre = await q(() => ({ placed: window.__T.events['tower:placed'] || 0, failed: window.__T.events['build:failed'] || 0, kb: window.__FD.game.kb }));
    await page.keyboard.press('1');
    await sleep(500);
    const post = await q(() => ({ placed: window.__T.events['tower:placed'] || 0, failed: window.__T.events['build:failed'] || 0, kb: window.__FD.game.kb }));
    ctx.details.push(`quickbuild '1' on hovered slot #${b.id}: placed ${post.placed - pre.placed}, failed ${post.failed - pre.failed}, kb ${pre.kb} -> ${post.kb}`);
    if (ready.towers) {
      assert(post.placed > pre.placed, 'key 1 over a free slot did not place an antivirus');
      assert(post.kb < pre.kb, 'placing a tower did not spend KB');
      await sleep(600);
      await shot(page, 'e-desktop-built');
    } else ctx.warn.push('towers module is a stub: quickbuild not verified');

    // Fan click.
    const fan = await page.evaluate(FAN_POINT);
    if (fan) {
      const n0 = (await q(() => window.__T.events['fan:click'])) || 0;
      await page.mouse.click(fan.x, fan.y);
      await sleep(200);
      const n1 = (await q(() => window.__T.events['fan:click'])) || 0;
      assert(n1 > n0, 'click on the fan did not emit fan:click');
    } else ctx.warn.push('fan not visible/unobstructed at 960x600');

    await page.mouse.move(5, 300);
    await page.keyboard.press('Space');
    await sleep(300);
    phase = await q(() => window.__FD.game.phase);
    assert(phase === 'wave', `Space in prep should start the wave (phase ${phase})`);
    await page.keyboard.press('f');
    await sleep(100);
    const speed = await q(() => window.__FD.game.speed);
    assert(speed === 2, `F should toggle speed to 2 (got ${speed})`);
    await page.keyboard.press('p');
    await sleep(150);
    phase = await q(() => window.__FD.game.phase);
    assert(phase === 'paused', `P should pause (phase ${phase})`);
    await shot(page, 'e-desktop-paused');
    await page.keyboard.press('Escape');
    await sleep(150);
    phase = await q(() => window.__FD.game.phase);
    assert(phase === 'wave', `Esc while paused should resume (phase ${phase})`);
    noErrors(env);
  },

  // (f) itch.io embed: the game inside a cross-origin 960x600 iframe must take the keyboard after a click, and its
  // keys must not scroll the host page. Game = BASE_URL, or a static build with SMOKE_DIST=<dir> (e.g. dist).
  async iframe(browser, ctx) {
    const host = await startIframeHost({ query: '?mute=1&quality=low&seed=4', distDir: process.env.SMOKE_DIST || null });
    ctx.cleanup = host.close;
    const env = await openPage(browser, { width: 1280, height: 800 });
    ctx.env = env;
    const { page } = env;
    ctx.details.push(`host ${host.parentUrl} embeds ${host.gameUrl}`);
    await page.goto(host.parentUrl, { waitUntil: 'load' });
    const gameOrigin = new URL(host.gameUrl).origin;
    let frame = null;
    for (let i = 0; i < 100 && !frame; i++) {
      frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(gameOrigin)) || null;
      if (!frame) await sleep(100);
    }
    assert(frame, 'game iframe not found in the host page');
    try {
      await frame.waitForFunction(() => !!(window.__FD && window.__FD.game && window.__FD.loop), null, { timeout: 20000 });
    } catch (err) {
      throw new Error(`game did not boot inside the iframe within 20s${err && err.message ? `: ${err.message.split('\n')[0]}` : ''}`);
    }
    await frame.evaluate(() => {
      window.__keys = [];
      window.addEventListener('keydown', (e) => window.__keys.push(e.key), true);
    });
    const fq = (fn, arg) => frame.evaluate(fn, arg);
    const scrollY = () => page.evaluate(() => window.scrollY);
    const waitPhase = async (want, ms) => {
      const t0 = Date.now();
      let ph = null;
      while (Date.now() - t0 < ms) {
        ph = await fq(() => window.__FD.game.phase).catch(() => null);
        if (ph === want) return ph;
        await sleep(150);
      }
      return ph;
    };
    const box = await page.locator('#gf').boundingBox();
    assert(box && box.width > 0, 'iframe has no layout box');
    await sleep(1200); // let the POST text start

    // 1) click the boot screen -> menu
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    let phase = await waitPhase('menu', 8000);
    assert(phase === 'menu', `click on the boot screen did not reach the menu (phase '${phase}')`);
    await sleep(500);

    // 2) ArrowDown: the frame gets the key, the host page does not scroll
    await page.keyboard.press('ArrowDown');
    await sleep(250);
    let keys = await fq(() => window.__keys.slice());
    const syArrow = await scrollY();
    ctx.details.push(`after boot click + ArrowDown: host scrollY ${syArrow}, frame keys [${keys.join(',')}]`);
    assert(keys.includes('ArrowDown'), 'the game iframe did not receive ArrowDown after a click (no keyboard focus)');
    assert(syArrow === 0, `ArrowDown scrolled the host page (scrollY ${syArrow})`);

    // 3) click START
    const start = await fq(() => {
      const els = [...document.querySelectorAll('.mi-label')].filter((e) => e.offsetParent);
      const e = els[0];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.trim().slice(0, 24) };
    });
    assert(start, 'no menu item (.mi-label) visible in the iframe');
    await page.mouse.click(box.x + start.x, box.y + start.y);
    phase = await waitPhase('prep', 8000);
    await shot(page, 'f-iframe-prep');
    assert(phase === 'prep', `click on '${start.text}' did not start a game (phase '${phase}')`);
    await sleep(400);

    // 4) Space runs the wave without scrolling the host
    await page.keyboard.press('Space');
    phase = await waitPhase('wave', 2000);
    const sySpace = await scrollY();
    keys = await fq(() => window.__keys.slice());
    await shot(page, 'f-iframe-space');
    ctx.details.push(`after START click + Space: phase '${phase}', host scrollY ${sySpace}, frame keys [${keys.join(',')}]`);
    assert(sySpace === 0, `Space scrolled the host page (scrollY ${sySpace}) - the iframe lost keyboard focus`);
    assert(phase === 'wave', `Space in prep did not start the wave inside the iframe (phase '${phase}')`);
    noErrors(env);
  },
};

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------
async function main() {
  ensureOut();
  if (!(await serverUp())) {
    console.error(`\n  Dev server not reachable at ${BASE_URL}\n  Start it with "npm run dev" or set BASE_URL.\n`);
    process.exit(1);
  }
  const { browser, executablePath } = await launch({ headed: HEADED });
  console.log(`FLOPPY DEFENSE smoke tests -> ${BASE_URL}  (${executablePath.split(/[\\/]/).pop()})\n`);
  const names = Object.keys(scenarios).filter((n) => !ONLY.length || ONLY.includes(n));
  const results = [];
  let readiness = null;
  let bootBroken = false;

  async function attempt(name) {
    const ctx = { details: [], warn: [], env: null, readiness: null };
    const t0 = Date.now();
    let status = 'PASS';
    let message = '';
    try {
      if (bootBroken && name !== 'unit') throw new Error('not run: the game does not boot (see above)');
      await scenarios[name](browser, ctx);
    } catch (err) {
      if (/game did not boot/.test(err.message)) bootBroken = true;
      if (err instanceof Skip) { status = 'SKIP'; message = err.message; }
      else { status = 'FAIL'; message = err.message; }
      if (ctx.env) await shot(ctx.env.page, `${name}-${status.toLowerCase()}`);
    }
    if (status === 'FAIL' && ctx.env && ctx.env.reloads) message += `\n(page reloaded ${ctx.env.reloads}x by the dev server during the test${ctx.env.vite.length ? `: ${[...new Set(ctx.env.vite)].slice(-3).join(' | ')}` : ''})`;
    return { ctx, status, message, ms: Date.now() - t0 };
  }

  for (const name of names) {
    process.stdout.write(`  ${pad(name, 9)} ... `);
    let run = await attempt(name);
    if (run.status === 'FAIL' && run.ctx.env && run.ctx.env.reloads > 0) {
      // The dev server reloaded the page mid-test (files edited concurrently): retry once.
      await run.ctx.env.context.close().catch(() => {});
      if (run.ctx.cleanup) await run.ctx.cleanup().catch(() => {});
      run = await attempt(name);
      run.ctx.warn.push('retried: the page was reloaded by Vite HMR during the first attempt');
    }
    let { status, message } = run;
    const { ctx, ms } = run;
    if (ctx.readiness) readiness = ctx.readiness;
    const env = ctx.env;
    if (status !== 'FAIL' && env && env.errors.length) { status = 'FAIL'; message = `${env.errors.length} console error(s)`; }
    console.log(`${status}  (${(ms / 1000).toFixed(1)}s)${message ? `\n      ${message.split('\n').join('\n      ')}` : ''}`);
    for (const d of ctx.details) console.log(`      · ${d}`);
    for (const w of ctx.warn) console.log(`      ! ${w}`);
    if (env && env.errors.length && !message.includes('console/page error')) {
      for (const e of summarizeErrors(env.errors)) console.log(`      x ${e}`);
    }
    if (env && env.warnings.length) console.log(`      (${env.warnings.length} console warning(s), first: ${env.warnings[0].slice(0, 160)})`);
    results.push({ name, status, message, ms, details: ctx.details, warnings: ctx.warn, errors: env ? env.errors : [] });
    if (env) await env.context.close().catch(() => {});
    if (ctx.cleanup) await ctx.cleanup().catch(() => {});
  }
  await browser.close();

  if (readiness) {
    console.log('\n  Module readiness:');
    const r = readiness;
    const mark = (v) => (v ? 'ok ' : '-- ');
    console.log(`    ${mark(r.renderer)}renderer  ${mark(r.mapSlots)}map (${r.mapSlots} slots, ${r.mapPaths} paths, ${r.heatSpots} heat spots)  ${mark(r.towers)}towers  ${mark(r.waves)}waves/enemies  ${mark(r.ui)}ui  ${mark(r.input)}input  ${mark(r.economy)}economy`);
    if (r.bootErrors.length) console.log(`    boot errors: ${r.bootErrors.join('; ')}`);
  }
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n  ${pass} passed, ${fail} failed, ${skipped} skipped${STRICT && skipped ? ' (strict: skips count as failures)' : ''}  ->  screenshots in tests/out/\n`);
  writeFileSync(join(OUT_DIR, 'smoke-report.json'), JSON.stringify({ base: BASE_URL, date: new Date().toISOString(), readiness, results }, null, 2));
  process.exit(fail || (STRICT && skipped) ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke: fatal', err);
  process.exit(1);
});
