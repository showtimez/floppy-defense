// Balance run: plays the full campaign with the autoplay bot at max turbo and prints a per-wave table.
// Needs the dev server (npm run dev) or BASE_URL. Reproducible with a fixed seed (bot acts on simulation time).
// Usage: node tests/balance.mjs [--seed 1 | --seeds 1,2,3] [--mode normal|greedy|idle] [--turbo 20]
//                              [--timeout 900] [--endless] [--headed] [--json]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, OUT_DIR, ensureOut, launch, serverUp, openPage, READINESS, SNAPSHOT, summarizeErrors, sleep, pad } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (flag, def) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const seeds = String(arg('--seeds', arg('--seed', '1'))).split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
const MODE = arg('--mode', 'normal');
const TURBO = Math.max(1, Math.min(20, Number(arg('--turbo', 20))));
const TIMEOUT = Number(arg('--timeout', 900)) * 1000;
const ENDLESS = argv.includes('--endless');
const HEADED = argv.includes('--headed');
const JSON_OUT = argv.includes('--json');

function table(log) {
  const head = `  ${pad('wave', 5)}${pad('cpu%', 6, true)}${pad('kb', 7, true)}  ${pad('towers', 7)}${pad('mix', 13)}${pad('lv', 4, true)}${pad('leaks', 7, true)}${pad('kills', 7, true)}${pad('t(s)', 7, true)}  note`;
  const rows = log.map((r) => `  ${pad(String(r.wave).padStart(2, '0'), 5)}${pad(r.cpu, 6, true)}${pad(r.kb, 7, true)}  ${pad(r.towers, 7)}${pad(r.mix || '', 13)}${pad(r.levels ?? '', 4, true)}${pad(r.leaks, 7, true)}${pad(r.kills ?? '', 7, true)}${pad(r.time, 7, true)}  ${r.result || (r.perfect ? 'perfect' : '')}`);
  return [head, ...rows].join('\n');
}

async function runSeed(browser, seed) {
  const env = await openPage(browser, { width: 640, height: 400 });
  const q = `?autostart=1&autoplay=${MODE}&turbo=${TURBO}&mute=1&seed=${seed}&quality=low&quiet=1${ENDLESS ? '&mode=endless' : ''}`;
  const t0 = Date.now();
  await env.page.goto(`${BASE_URL}/${q}`, { waitUntil: 'load' });
  await env.page.waitForFunction(() => !!(window.__FD && window.__FD.game), null, { timeout: 20000 });
  const ready = await env.page.evaluate(READINESS);
  let printed = 0;
  let result = null;
  let snap = null;
  console.log(`\n=== seed ${seed} · ${MODE} · turbo x${TURBO}${ENDLESS ? ' · endless' : ''}`);
  if (!ready.towers || !ready.waves || !ready.mapSlots) {
    console.log(`  ! modules not ready: towers ${ready.towers ? 'ok' : 'stub'}, waves ${ready.waves ? 'ok' : 'stub'}, map slots ${ready.mapSlots}`);
  }
  let reloads = 0;
  while (Date.now() - t0 < TIMEOUT) {
    await sleep(1000);
    if (env.reloads !== reloads) {
      // Vite full reload (a source file changed): the URL restarts the same seeded run from scratch.
      reloads = env.reloads;
      printed = 0;
      console.log('  ! the dev server reloaded the page (source edited) - run restarted from wave 1');
    }
    const st = await env.page.evaluate(() => (window.__FD ? { log: window.__FD.autoplayLog || [], result: window.__FD.autoplayResult } : null)).catch(() => null);
    if (!st) continue;
    for (; printed < st.log.length; printed++) {
      const r = st.log[printed];
      console.log(`  .. wave ${String(r.wave).padStart(2, '0')}  cpu ${r.cpu}%  kb ${r.kb}  towers ${r.towers} (${r.mix})  leaks ${r.leaks}${r.result ? `  ${r.result}` : ''}`);
    }
    if (st.result) { result = st.result; break; }
  }
  snap = await env.page.evaluate(SNAPSHOT).catch(() => snap);
  const log = await env.page.evaluate(() => window.__FD.autoplayLog || []).catch(() => []);
  await env.page.screenshot({ path: join(OUT_DIR, `balance-seed${seed}.png`) }).catch(() => {});
  const realS = Math.round((Date.now() - t0) / 1000);
  await env.context.close().catch(() => {});

  console.log('');
  console.log(table(log));
  const outcome = result ? result.result.toUpperCase() : 'TIMEOUT';
  console.log(`\n  result: ${outcome}  wave ${snap ? snap.wave : '?'}  cpu ${snap ? snap.cpu : '?'}%  score ${result ? result.score : '-'}  sim ${snap ? snap.time : '?'}s  real ${realS}s`);
  if (result && result.stats) {
    const s = result.stats;
    console.log(`  stats: kills ${s.kills}  leaks ${s.leaks}  earned ${s.kbEarned}KB  spent ${s.kbSpent}KB  built ${s.towersBuilt}  upgrades ${s.upgrades}  fan ${s.fanClicks}  overheats ${s.overheats}  perfect ${s.perfectWaves}  cache-hits ${s.combos || 0} (best x${s.bestCombo || 0})`);
  }
  if (env.errors.length) console.log(`  ! ${env.errors.length} console error(s):\n    ${summarizeErrors(env.errors, 4).join('\n    ')}`);
  return { seed, mode: MODE, outcome, result, log, errors: env.errors, realS, final: snap };
}

async function main() {
  ensureOut();
  if (!(await serverUp())) {
    console.error(`\n  Dev server not reachable at ${BASE_URL}\n  Start it with "npm run dev" or set BASE_URL.\n`);
    process.exit(1);
  }
  const { browser } = await launch({ headed: HEADED });
  const runs = [];
  for (const seed of seeds) runs.push(await runSeed(browser, seed));
  await browser.close();

  if (runs.length > 1) {
    const wins = runs.filter((r) => r.outcome === 'VICTORY').length;
    const avgCpu = runs.reduce((s, r) => s + (r.final ? r.final.cpu : 0), 0) / runs.length;
    const avgWave = runs.reduce((s, r) => s + (r.final ? r.final.wave : 0), 0) / runs.length;
    console.log(`\n=== summary (${MODE}): ${wins}/${runs.length} victories, avg final wave ${avgWave.toFixed(1)}, avg final cpu ${avgCpu.toFixed(0)}%`);
    // Per-wave average leaks across seeds: where the difficulty spikes are.
    const byWave = new Map();
    for (const r of runs) for (const row of r.log) {
      const e = byWave.get(row.wave) || { leaks: 0, n: 0, cpu: 0 };
      e.leaks += row.leaks; e.cpu += row.cpu; e.n++;
      byWave.set(row.wave, e);
    }
    console.log(`  wave  avg leaks  avg cpu`);
    for (const [w, e] of [...byWave.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  ${pad(String(w).padStart(2, '0'), 6)}${pad((e.leaks / e.n).toFixed(1), 9, true)}${pad((e.cpu / e.n).toFixed(0), 9, true)}`);
    }
  }
  const file = join(OUT_DIR, `balance-${MODE}.json`);
  writeFileSync(file, JSON.stringify(runs.map(({ errors, ...r }) => ({ ...r, errors: errors.length })), null, 2));
  if (JSON_OUT) console.log(JSON.stringify(runs.map((r) => ({ seed: r.seed, outcome: r.outcome, log: r.log }))));
  const bad = runs.some((r) => r.errors.length || r.outcome === 'TIMEOUT');
  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error('balance: fatal', err);
  process.exit(1);
});
