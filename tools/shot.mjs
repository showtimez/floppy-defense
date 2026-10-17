// Dev helper: open the game in headless Chrome, run optional JS, save a screenshot and print console errors.
// Usage: node tools/shot.mjs "<url or ?query>" out.png [--wait 3000] [--size 960x600] [--eval "js expr"] [--mobile]
// The dev server must be running (npm run dev -> http://localhost:5180/). A query like "?autostart=1&debug=1" is
// resolved against that server. --eval runs after --wait; its JSON result is printed.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};
let url = args[0] || '/';
if (!/^https?:/.test(url)) url = `http://localhost:5180/${url.replace(/^\//, '')}`;
const out = args[1] && !args[1].startsWith('--') ? args[1] : 'shot.png';
const wait = Number(get('--wait', 3000));
const [w, h] = get('--size', '960x600').split('x').map(Number);
const evalJs = get('--eval', null);
const mobile = args.includes('--mobile');

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 1,
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (evalJs) {
  try {
    const r = await page.evaluate(evalJs);
    if (r && typeof r.then === 'function') await r;
    console.log('eval:', JSON.stringify(r)?.slice(0, 4000));
  } catch (e) {
    console.log('eval error:', e.message);
  }
  await page.waitForTimeout(Number(get('--after', 800)));
}
await page.screenshot({ path: out });
const fd = await page.evaluate(() => (window.__FD ? { phase: window.__FD.game.phase, wave: window.__FD.game.wave, kb: window.__FD.game.kb, cpu: window.__FD.game.cpu, bootErrors: window.__FD.bootErrors } : null)).catch(() => null);
console.log('state:', JSON.stringify(fd));
console.log(errors.length ? `console (${errors.length}):\n${errors.slice(0, 30).join('\n')}` : 'console: clean');
await browser.close();
