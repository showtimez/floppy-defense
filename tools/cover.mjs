// Cover art: renders the photo-mode board (?debug=1&photo=1) on the real GPU and lays the menu's title (logo +
// floppies) over the top rim and its subtitle on the dark band below the case. The page renders taller than the
// cover and is cropped at the bottom, so the board sits lower and leaves room for the title.
// Writes the full-size PNG plus a half-size copy (itch.io cover is 630x500).
// Usage: node tools/cover.mjs [baseUrl] [--size 1260x1000] [--wait 7000] [--out docs/media] [--angle d3d11]
// The server must serve the game (npm run dev -> http://localhost:5180, or vite preview of a build).
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const base = (args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5180').replace(/\/+$/, '');
const [W, H] = get('--size', '1260x1000').split('x').map(Number);
const wait = Number(get('--wait', 7000));
const outDir = resolve(import.meta.dirname, '..', get('--out', 'docs/media'));
const angle = get('--angle', process.platform === 'win32' ? 'd3d11' : 'default');

const exe = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const HV = Math.round(H * 1.14); // rendered height; the bottom HV - H px are cropped away
const page = await (await browser.newContext({ viewport: { width: W, height: HV }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/?debug=1&photo=1&mute=1&quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__FD?.view?.ready, null, { timeout: 30000 });
await page.waitForTimeout(wait);

// Title overlay: a copy of the menu's title block (its canvas pixels copied by hand), sized for the cover.
await page.evaluate(({ W, H }) => {
  const em = Math.round(W / 46);
  const src = document.querySelector('.menu-title');
  const root = window.__FD.ui?.root || document.querySelector('.fd-ui');
  if (!src || !root) throw new Error('menu title not found');
  const title = src.cloneNode(true);
  const from = src.querySelector('canvas');
  const to = title.querySelector('canvas');
  to.width = from.width;
  to.height = from.height;
  to.getContext('2d').drawImage(from, 0, 0);
  to.style.width = `${Math.round(W * 0.84)}px`;
  to.style.animation = 'none';
  title.querySelector('.menu-tagline')?.remove();
  const sub = title.querySelector('.menu-sub');
  sub?.remove();
  const band = (css) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:0;right:0;visibility:visible;font-size:${em}px;pointer-events:none;z-index:50;${css}`;
    root.append(d);
    return d;
  };
  band(`top:0;padding:${Math.round(em * 0.9)}px 0 ${Math.round(em * 1.2)}px;`
    + 'background:linear-gradient(rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 65%, rgba(0,0,0,0) 100%);').append(title);
  if (sub) {
    sub.style.cssText = 'margin:0;font-size:0.95em;letter-spacing:0.26em;';
    band(`top:${H - Math.round(em * 1.85)}px;text-align:center;`).append(sub);
  }
}, { W, H });
await page.waitForTimeout(400);

mkdirSync(outDir, { recursive: true });
const full = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
writeFileSync(join(outDir, 'cover.png'), full);

// Half-size copy, resampled by the browser.
const halfW = Math.round(W / 2);
const halfH = Math.round(H / 2);
const half = await page.evaluate(async ({ b64, w, h }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}, { b64: full.toString('base64'), w: halfW, h: halfH });
writeFileSync(join(outDir, `cover-${halfW}x${halfH}.png`), Buffer.from(half, 'base64'));

console.log(`cover: ${join(outDir, 'cover.png')} (${W}x${H}) + cover-${halfW}x${halfH}.png`);
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console: clean');
await browser.close();
