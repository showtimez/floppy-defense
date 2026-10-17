// Shared helpers for the Playwright test scripts (smoke.mjs, balance.mjs).
// Pattern adapted from Giocomobile/tempesta-fixart/tools/uitest.mjs (local Chrome, console capture, debug global).
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = join(TESTS_DIR, 'out');
export const BASE_URL = (process.env.BASE_URL || 'http://localhost:5180').replace(/\/+$/, '');

export function ensureOut() {
  mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

export function findBrowser() {
  const list = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return list.find((p) => existsSync(p)) || null;
}

export async function launch({ headed = false } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('No Chrome/Edge found (set CHROME_PATH)');
  const browser = await chromium.launch({
    executablePath,
    headless: !headed,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  return { browser, executablePath };
}

export async function serverUp(url = BASE_URL, timeoutMs = 4000) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url + '/', { signal: ctl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch (err) {
    return false;
  }
}

// Console noise that is not a game bug.
const IGNORE = [
  /Failed to load resource/i,
  /favicon/i,
  /GPU stall due to ReadPixels/i,
  /AudioContext was not allowed to start/i,
  /The AudioContext was not allowed/i,
  /WebGL.*(performance|warning)/i,
  /\[\.WebGL-/i,
  /Automatic fallback to software WebGL/i,
  /\[vite\]/i,
];

// Runs in the page before any game script: hooks window.__FD as soon as main.js assigns it and records events.
const INIT = `(() => {
  try { localStorage.clear(); } catch (e) {}
  const T = window.__T = { phases: [], events: {}, selections: [], kbReasons: {}, installed: false };
  const WATCH = ['phase:change','wave:prep','wave:start','wave:cleared','gameover','victory','selection:change',
    'fan:click','fan:cool','tower:placed','tower:upgraded','build:failed','enemy:spawn','enemy:killed','enemy:leak',
    'kb:change','heat:start','heat:warning','heat:overheat','heat:cooled','cmd:nextWave','select:slot','select:none',
    'boss:spawn','boss:killed','cpu:damage','pause','resume','speed:change','hover:change'];
  let fd;
  function install(ctx) {
    if (!ctx || !ctx.events || T.installed) return;
    T.installed = true;
    T.phases.push(ctx.game && ctx.game.phase);
    for (const n of WATCH) ctx.events.on(n, (p) => {
      T.events[n] = (T.events[n] || 0) + 1;
      if (n === 'phase:change') T.phases.push(p && p.to);
      if (n === 'selection:change') T.selections.push(p && p.selected ? p.selected.kind : null);
      if (n === 'kb:change' && p) T.kbReasons[p.reason] = (T.kbReasons[p.reason] || 0) + 1;
    });
  }
  Object.defineProperty(window, '__FD', {
    configurable: true, enumerable: true,
    get() { return fd; },
    set(v) { fd = v; try { install(v); } catch (e) { T.installError = String(e); } },
  });
})();`;

export async function openPage(browser, { width = 960, height = 600, mobile = false, scale = 1 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  const infos = [];
  const vite = [];
  page.on('console', (m) => {
    const text = m.text();
    if (/^\[vite\]/.test(text)) { if (!/connect/i.test(text)) vite.push(text); return; }
    if (IGNORE.some((r) => r.test(text))) return;
    if (m.type() === 'error') errors.push(`[console.error] ${text}`);
    else if (m.type() === 'warning') warnings.push(text);
    else if (m.type() === 'info' || m.type() === 'log') infos.push(text);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}${e.stack ? `\n    ${e.stack.split('\n').slice(1, 4).join('\n    ')}` : ''}`));
  page.on('crash', () => errors.push('[crash] page crashed'));
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/i.test(r.url())) errors.push(`[http ${r.status()}] ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
  });
  page.on('requestfailed', (r) => {
    const f = r.failure();
    if (!/favicon/i.test(r.url()) && !(f && /ERR_ABORTED/.test(f.errorText))) errors.push(`[request failed] ${r.url()} ${f ? f.errorText : ''}`);
  });
  const env = { context, page, errors, warnings, infos, vite, reloads: 0 };
  // Vite full reloads (another file changed while testing) navigate the main frame again.
  let navs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && ++navs > 1) env.reloads++; });
  return env;
}

// Module readiness (which modules are still stubs). Runs in the page.
export const READINESS = () => {
  const fd = window.__FD;
  if (!fd) return { fd: false };
  const safe = (fn) => { try { return fn(); } catch (e) { return false; } };
  return {
    renderer: safe(() => !!(fd.view && fd.view.scene && fd.view.camera && fd.view.renderer)),
    mapSlots: safe(() => fd.map.slots.length),
    mapPaths: safe(() => fd.map.paths.length),
    heatSpots: safe(() => fd.map.heatSpots.length),
    towers: safe(() => !!fd.towers.getDef('antivirus')),
    waves: safe(() => fd.waves.info(1).groups.length > 0),
    ui: safe(() => document.querySelector('#ui').children.length > 0),
    input: safe(() => typeof fd.input.pickAt === 'function'),
    economy: safe(() => typeof fd.economy.onStep === 'function'),
    bootErrors: fd.bootErrors || [],
  };
};

// Compact game state snapshot. Runs in the page.
export const SNAPSHOT = () => {
  const fd = window.__FD;
  if (!fd) return null;
  const g = fd.game;
  const safe = (fn, d = null) => { try { return fn(); } catch (e) { return d; } };
  return {
    phase: g.phase, wave: g.wave, kb: Math.round(g.kb), cpu: Math.round(g.cpu), time: Math.round(g.time),
    speed: g.speed, selected: g.selected ? g.selected.kind : null,
    towers: safe(() => fd.towers.list.length, 0), enemies: safe(() => fd.enemies.list.length, 0),
    heat: safe(() => (fd.heat.active ? { id: fd.heat.active.spot.id, level: +fd.heat.active.level.toFixed(2), over: fd.heat.active.overheated } : null)),
    stats: g.stats,
  };
};

// Mean / std-dev luminance of the WebGL canvas, read right after the game's own render in the same frame.
export const CANVAS_STATS = () => new Promise((resolve) => {
  requestAnimationFrame(() => {
    try {
      const src = window.__FD && window.__FD.view && window.__FD.view.renderer && window.__FD.view.renderer.domElement;
      if (!src) return resolve({ error: 'no canvas' });
      const c = document.createElement('canvas');
      c.width = 64; c.height = 40;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data;
      let sum = 0; let sum2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        sum += l; sum2 += l * l;
      }
      const n = d.length / 4;
      const mean = sum / n;
      resolve({ w: src.width, h: src.height, mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) });
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
});

// Vite dev error overlay text (compile errors in a module), or null.
export const VITE_OVERLAY = () => {
  const el = document.querySelector('vite-error-overlay');
  if (!el) return null;
  const root = el.shadowRoot;
  const msg = root && root.querySelector('.message-body');
  const file = root && root.querySelector('.file');
  return `${file ? file.textContent.trim() + ': ' : ''}${msg ? msg.textContent.trim().slice(0, 400) : 'vite error overlay shown'}`;
};

// Unique errors (cache-busting ?t= stripped), with repeat counts and at most 2 stack lines each.
export function summarizeErrors(errors, max = 5) {
  const counts = new Map();
  for (const e of errors) {
    const lines = e.replace(/\?t=\d+/g, '').split('\n');
    const key = lines.slice(0, 3).join('\n');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [...counts.entries()].slice(0, max).map(([k, n]) => (n > 1 ? `(x${n}) ` : '') + k.split('\n').map((l) => l.trim()).join('\n        '));
  if (counts.size > max) out.push(`... ${counts.size - max} more unique error(s)`);
  return out;
}

// itch.io-like host for the iframe scenario: a tall parent page on its own port (so the game is cross-origin) that
// embeds the game in a 960x600 iframe with allow="fullscreen". The game is BASE_URL (the dev server) or, when
// distDir is given (SMOKE_DIST=dist after "npm run build"), a static copy of that build served on a second port.
// Returns { parentUrl, gameUrl, close }.
export async function startIframeHost({ query = '', distDir = null } = {}) {
  const http = await import('node:http');
  const { readFileSync, statSync } = await import('node:fs');
  const { extname, resolve, sep } = await import('node:path');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const servers = [];
  const listen = (handler) => new Promise((ok, fail) => {
    const srv = http.createServer(handler);
    srv.on('error', fail);
    srv.listen(0, '127.0.0.1', () => { servers.push(srv); ok(srv.address().port); });
  });
  let gameUrl = `${BASE_URL}/${query}`;
  if (distDir) {
    const root = resolve(distDir);
    const port = await listen((req, res) => {
      const u = new URL(req.url, 'http://x');
      let p = resolve(root, '.' + decodeURIComponent(u.pathname));
      try {
        if (p !== root && !p.startsWith(root + sep)) throw new Error('outside');
        if (statSync(p).isDirectory()) p = resolve(p, 'index.html');
        const body = readFileSync(p);
        res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(body);
      } catch (err) {
        res.writeHead(404); res.end('not found');
      }
    });
    gameUrl = `http://127.0.0.1:${port}/${query}`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>itch-like host</title>
<style>body{margin:0;background:#222;height:3000px}#wrap{margin:40px auto;width:960px;height:600px}</style></head>
<body><div id="wrap"><iframe id="gf" src="${gameUrl}" width="960" height="600" frameborder="0" scrolling="no"
 allow="autoplay; fullscreen *; gamepad"></iframe></div></body></html>`;
  const parentPort = await listen((req, res) => {
    if (!/^\/(\?.*)?$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  return {
    parentUrl: `http://127.0.0.1:${parentPort}/`,
    gameUrl,
    close: () => Promise.all(servers.map((s) => new Promise((r) => { s.close(() => r()); s.closeAllConnections?.(); }))),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padStart(n) : s.padEnd(n);
}
