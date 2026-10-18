// Viruses: spawning, path movement, slow, damage, splitting, boss behaviours, leaks (CONTRACTS §5.4).
// Rendering is delegated to enemyModels.js (instanced, a few draw calls for any crowd size).
import * as THREE from 'three';
import { ENEMIES } from '../data/enemies.js';
import { createEnemyModels, DIE_TIME, LEAK_TIME, FLASH_TIME } from './enemyModels.js';

const FLASH_LOCK = 0.15; // min seconds between hit flashes (focus fire must not strobe white)
const MAX_OFFSET = 0.32;

export function createEnemies(ctx) {
  const events = ctx.events;
  const list = [];   // alive enemies (dead ones are compacted out during update)
  const dying = [];  // visual-only: death pop / leak dive animations
  let aliveN = 0;
  let nextId = 1;
  let time = 0;
  let gen = 0;       // bumps on reset (guards loops against re-entrant resets from event listeners)

  let models = null;
  try { models = createEnemyModels(ctx); } catch (err) { console.error('[enemies] model setup failed', err); }

  const _pos = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _txt = new THREE.Vector3();
  const VS_TEXT = { size: 0.42, life: 1.0, rise: 1.0 };
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  const rand = () => (ctx.rng && ctx.rng.next ? ctx.rng.next() : Math.random());
  const pathCount = () => (ctx.map && ctx.map.paths && ctx.map.paths.length) || 0;
  const normPath = (i) => {
    const n = pathCount();
    if (!n) return 0;
    const k = Math.floor(Number(i) || 0);
    return ((k % n) + n) % n;
  };
  const pathLen = (i) => {
    const p = ctx.map && ctx.map.paths && ctx.map.paths[i];
    return (p && p.length) || 0;
  };

  // map.samplePath with a fallback tangent when the map does not fill outDir.
  function sample(pi, dist, outPos, outDir) {
    const map = ctx.map;
    outDir.set(0, 0, 0);
    if (!map || typeof map.samplePath !== 'function') {
      outPos.set(0, 0, 0);
      outDir.set(1, 0, 0);
      return;
    }
    map.samplePath(pi, dist, outPos, outDir);
    outDir.y = 0;
    if (outDir.lengthSq() < 1e-8) {
      const L = pathLen(pi);
      const d0 = Math.max(0, Math.min(dist, L - 0.06));
      map.samplePath(pi, d0, _a);
      map.samplePath(pi, d0 + 0.05, _b);
      outDir.set(_b.x - _a.x, 0, _b.z - _a.z);
      if (outDir.lengthSq() < 1e-8) outDir.set(1, 0, 0);
    }
    outDir.normalize();
  }

  function wrapAngle(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  }

  // Position on the path + smoothed lateral offset (crowds don't overlap, corners don't snap).
  function place(e, kLat, kYaw) {
    sample(e.pathIndex, e.dist, _pos, _dir);
    e.dir.copy(_dir);
    const v = e.vis;
    const tx = -_dir.z, tz = _dir.x;
    v.lx += (tx - v.lx) * kLat;
    v.lz += (tz - v.lz) * kLat;
    e.pos.set(_pos.x + v.lx * e.offset, e.def.y, _pos.z + v.lz * e.offset);
    const target = Math.atan2(_dir.x, _dir.z);
    v.yaw += wrapAngle(target - v.yaw) * kYaw;
  }

  function basicVisual(e) {
    e.vis = {
      yaw: Math.atan2(e.dir.x, e.dir.z), lx: -e.dir.z, lz: e.dir.x, flash: 0, flashCd: 0, punch: 0, spawnT: 1, hopT: 0, hopDur: 0.4,
      mode: 0, modeT: 0, seed: Math.random(), slowVis: 0, pulse: 0, barLag: 1, barA: 0, stage: 0, dx: e.pos.x, dz: e.pos.z,
    };
    return e.vis;
  }

  // -------------------------------------------------------------------------------------------
  function spawn(type, pathIndex = 0, opts = {}) {
    const def = ENEMIES[type];
    if (!def) {
      console.warn('[enemies] unknown virus type', type);
      return null;
    }
    const o = opts || {};
    const hpMul = o.hpMul > 0 ? o.hpMul : 1;
    const speedMul = o.speedMul > 0 ? o.speedMul : 1;
    const rewardMul = o.rewardMul >= 0 ? o.rewardMul : 1;
    const pi = normPath(pathIndex);
    const L = pathLen(pi);
    const hp = Math.max(1, Math.round(def.hp * hpMul));
    let offset = Number.isFinite(o.offset) ? o.offset : (def.boss ? 0 : (rand() * 2 - 1) * 0.22);
    offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset));
    const e = {
      id: nextId++,
      type,
      def,
      name: def.name,
      hp,
      maxHp: hp,
      speed: def.speed * speedMul,
      baseSpeed: def.speed * speedMul,
      pathIndex: pi,
      dist: Math.max(0, Math.min(Number(o.dist) || 0, Math.max(0, L - 0.05))),
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(1, 0, 0),
      radius: def.radius,
      alive: true,
      slowMul: 1,
      slowTime: 0,
      reward: Math.max(0, Math.round(def.reward * rewardMul)),
      cpuDamage: def.cpuDamage,
      isBoss: !!def.boss,
      mesh: new THREE.Object3D(),
      color: def.dormant && def.dormant.color != null ? def.dormant.color : def.color,
      dormant: !!def.dormant, // MICHELANGELO: asleep (slow, grey) until hit or past def.dormant.wakeAt of its path
      // extras
      offset,
      hpMul,
      speedMul,
      rewardMul,
      splitStage: 0,
      summonT: def.bossSpawn ? def.bossSpawn.every * 0.75 : 0,
      bornAt: time,
    };
    e.mesh.userData.enemy = e;
    sample(pi, e.dist, _pos, _dir);
    e.dir.copy(_dir);
    e.pos.set(_pos.x, def.y, _pos.z);
    let vis = null;
    if (models) {
      try { vis = models.initVisual(e, { hopFrom: o.hopFrom || null, noSpawnFx: !!o.noSpawnFx }); } catch (err) { console.error('[enemies] initVisual', err); }
    }
    if (!vis) basicVisual(e);
    place(e, 1, 1);
    e.vis.dx = o.hopFrom ? o.hopFrom.x : e.pos.x;
    e.vis.dz = o.hopFrom ? o.hopFrom.z : e.pos.z;
    e.mesh.position.copy(e.pos);
    list.push(e);
    aliveN++;
    events.emit('enemy:spawn', { enemy: e });
    if (e.isBoss) events.emit('boss:spawn', { enemy: e });
    return e;
  }

  function beginDeath(e, mode) {
    const v = e.vis;
    v.mode = mode;
    v.modeT = 0;
    v.flash = 0;
    v.flashCd = 0;
    dying.push(e);
  }

  // Children inherit the parent's multipliers; `baseReward` (split.reward / splitAt.reward) overrides the child's KB.
  function splitOff(parent, type, count, spread = 0.3, baseReward = null) {
    const cdef = ENEMIES[type];
    const rewardMul = baseReward != null && cdef && cdef.reward > 0 ? (baseReward / cdef.reward) * parent.rewardMul : parent.rewardMul;
    const children = [];
    const v = parent.vis;
    const from = { x: v ? v.dx : parent.pos.x, z: v ? v.dz : parent.pos.z };
    for (let k = 0; k < count; k++) {
      const f = count === 1 ? 0 : (k / (count - 1)) * 2 - 1;
      const c = spawn(type, parent.pathIndex, {
        dist: Math.max(0, parent.dist + f * spread),
        offset: parent.offset + f * 0.2 + (rand() - 0.5) * 0.08,
        hpMul: parent.hpMul,
        speedMul: parent.speedMul,
        rewardMul,
        hopFrom: from,
      });
      if (c) children.push(c);
    }
    events.emit('enemy:split', { parent, children });
    return children;
  }

  function kill(e, by) {
    e.alive = false;
    e.hp = 0;
    aliveN = Math.max(0, aliveN - 1);
    beginDeath(e, 1);
    events.emit('enemy:killed', { enemy: e, reward: e.reward, by });
    if (e.isBoss) events.emit('boss:killed', { enemy: e });
    const sp = e.def.split;
    if (sp && ENEMIES[sp.into]) splitOff(e, sp.into, sp.count, sp.spread, sp.reward);
  }

  // CPU damage on leak. Bosses with def.leakMin scale it by their remaining hp (every hit on a boss still counts
  // when it gets through): cpuDamage × (leakMin + (1 - leakMin) × hp/maxHp).
  function leakDamage(e) {
    const lm = e.def.leakMin;
    if (!(lm >= 0 && lm < 1)) return e.cpuDamage;
    const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
    return Math.max(1, Math.round(e.cpuDamage * (lm + (1 - lm) * frac)));
  }

  function leak(e) {
    e.alive = false;
    aliveN = Math.max(0, aliveN - 1);
    e.dist = pathLen(e.pathIndex);
    beginDeath(e, 2);
    events.emit('enemy:leak', { enemy: e, damage: leakDamage(e) });
  }

  function damage(e, amount, sourceTower = null) {
    if (!e || !e.alive) return false;
    let amt = Number(amount);
    if (!(amt > 0)) return false;
    // flat armour (CIH): removed from every hit before the matchup multiplier, never below 1 per hit
    const armor = e.def.armor;
    if (armor > 0 && amt > 1) {
      amt = Math.max(1, amt - armor);
      if (!((e.vsShown | 0) & 4)) {
        e.vsShown = (e.vsShown | 0) | 4;
        _txt.set(e.pos.x, e.pos.y + 1.05, e.pos.z);
        try { ctx.fx?.text?.(_txt, 'ARMOR', '#c8ff2a', VS_TEXT); } catch (err) { /* optional */ }
      }
    }
    // type matchups (e.g. the wooden TROJAN shrugs off scans but burns well): def.vs[towerType] multiplier
    const vs = e.def.vs;
    if (vs && sourceTower && vs[sourceTower.type] > 0) {
      const mul = vs[sourceTower.type];
      amt *= mul;
      // teach the matchup once per virus and floppy type: "RESIST" (grey) / "BURNS!" (orange)
      const flag = mul < 1 ? 1 : 2;
      if (mul !== 1 && !((e.vsShown | 0) & flag)) {
        e.vsShown = (e.vsShown | 0) | flag;
        _txt.set(e.pos.x, e.pos.y + 0.7, e.pos.z);
        try { ctx.fx?.text?.(_txt, mul < 1 ? 'RESIST' : 'BURNS!', mul < 1 ? '#9aa4ad' : '#ff8a1f', VS_TEXT); } catch (err) { /* optional */ }
      }
    }
    const dealt = Math.min(e.hp, amt);
    e.hp -= amt;
    const stats = ctx.game && ctx.game.stats;
    if (stats) stats.damageDealt = (stats.damageDealt || 0) + dealt;
    if (e.vis) {
      if (!(e.vis.flashCd > 0)) { e.vis.flash = FLASH_TIME; e.vis.flashCd = FLASH_LOCK; }
      e.vis.punch = 1;
    }
    events.emit('enemy:hit', { enemy: e, damage: amt, by: sourceTower });
    if (!e.alive) return false; // a listener already finished it
    if (e.hp <= 0) {
      kill(e, sourceTower);
      return true;
    }
    if (e.dormant) wake(e);
    if (e.def.splitAt) checkSplitAt(e);
    return false;
  }

  // MICHELANGELO: March 6th. Speed jumps ×dormant.speedMul, real colour, a flash ring and a "WAKE UP!" tag.
  function wake(e) {
    const dm = e.def.dormant;
    if (!e.dormant || !dm) return;
    e.dormant = false;
    e.baseSpeed *= dm.speedMul > 0 ? dm.speedMul : 1;
    e.speed = e.baseSpeed * e.slowMul;
    e.color = e.def.color;
    if (e.vis) { e.vis.pulse = 1.6; e.vis.punch = 1; e.vis.stage = 1; }
    _txt.set(e.pos.x, e.pos.y + 0.9, e.pos.z);
    try {
      ctx.fx?.ring?.(e.pos, 1.3, e.def.color, { life: 0.45, width: 0.14 });
      ctx.fx?.text?.(_txt, 'MAR 6!', '#d9a6ff', VS_TEXT);
    } catch (err) { /* optional */ }
    events.emit('enemy:wake', { enemy: e });
  }

  // MELISSA: sheds macros when crossing hp thresholds.
  function checkSplitAt(e) {
    const sa = e.def.splitAt;
    while (e.alive && e.splitStage < sa.thresholds.length && e.hp / e.maxHp <= sa.thresholds[e.splitStage]) {
      e.splitStage++;
      if (e.vis) { e.vis.stage = e.splitStage; e.vis.pulse = 1.5; }
      splitOff(e, sa.type, sa.count, sa.spread, sa.reward);
      try { ctx.view?.glitch?.(0.45, 0.25); } catch (err) { /* optional */ }
    }
  }

  // ILOVEYOU: swells, then pops worms out of the love letter every few seconds.
  function bossSummon(e, dt) {
    const bs = e.def.bossSpawn;
    const v = e.vis;
    e.summonT -= dt;
    const warn = bs.warn || 0.6;
    if (e.summonT < warn) v.pulse = 1 - Math.max(0, e.summonT) / warn;
    if (e.summonT > 0) return;
    e.summonT += bs.every;
    v.pulse = 0;
    v.punch = 1;
    const cdef = ENEMIES[bs.type];
    if (!cdef) return;
    // mass-mailer (bs.allPorts): every other batch of mail arrives through the other COM port
    e.summonN = (e.summonN | 0) + 1;
    const np = pathCount() || 1;
    const other = !!bs.allPorts && np > 1 && e.summonN % 2 === 0;
    const pi = other ? (e.pathIndex + 1) % np : e.pathIndex;
    const children = [];
    const from = other ? null : { x: e.pos.x + e.dir.x * 0.9, z: e.pos.z + e.dir.z * 0.9 };
    const rewardMul = ((bs.reward ?? cdef.reward) / cdef.reward) * e.rewardMul;
    for (let k = 0; k < bs.count; k++) {
      const f = bs.count === 1 ? 0 : (k / (bs.count - 1)) * 2 - 1;
      const c = spawn(bs.type, pi, {
        dist: other ? 0 : e.dist + 0.6 + k * 0.12,
        offset: f * 0.26,
        hpMul: e.hpMul,
        speedMul: 1,
        rewardMul,
        hopFrom: from,
      });
      if (c) children.push(c);
    }
    try {
      ctx.fx?.ring?.(e.pos, 1.5, e.color, { life: 0.5, width: 0.12 });
      // the "sent" mail lands at the far port: a matching pink ring there links it to the boss
      if (other) {
        const port = ctx.map?.ports?.[pi];
        const pp = port && port.pos ? port.pos : (children[0] && children[0].pos);
        if (pp) ctx.fx?.ring?.(pp, 1.1, e.color, { life: 0.55, width: 0.1 });
      }
    } catch (err) { /* optional */ }
    events.emit('boss:summon', { enemy: e, children });
  }

  function slow(e, mul, duration) {
    if (!e || !e.alive) return;
    let m = Number(mul);
    const d = Number(duration);
    if (!(m >= 0) || !(d > 0)) return;
    const res = e.def.slowResist || 0;
    if (res) m = 1 - (1 - m) * (1 - res);
    m = Math.max(0.1, Math.min(1, m));
    if (m < e.slowMul - 1e-6 || e.slowTime <= 0) {
      e.slowMul = m;
      e.slowTime = d;
    } else if (Math.abs(m - e.slowMul) <= 1e-6) {
      e.slowTime = Math.max(e.slowTime, d);
    }
    e.speed = e.baseSpeed * e.slowMul;
  }

  function remaining(e) {
    if (!e) return 0;
    return Math.max(0, pathLen(e.pathIndex) - e.dist);
  }

  function queryRadius(pos, radius, out = []) {
    out.length = 0;
    if (!pos) return out;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const r = radius + e.radius;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz <= r * r) out.push(e);
    }
    return out;
  }

  function pickTarget(pos, radius, mode = 'first') {
    if (!pos) return null;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const r = radius + e.radius;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      let score;
      switch (mode) {
        case 'last': score = remaining(e); break;
        case 'strong': score = e.hp * 1000 - remaining(e); break;
        case 'close': score = -d2; break;
        default: score = -remaining(e);
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function aliveCount() {
    return aliveN;
  }

  function tickVis(e, dt) {
    const v = e.vis;
    v.spawnT += dt;
    if (v.flash > 0) v.flash -= dt;
    if (v.flashCd > 0) v.flashCd -= dt;
    if (v.punch > 0) v.punch = Math.max(0, v.punch - dt * 7);
    if (v.hopT > 0) v.hopT = Math.max(0, v.hopT - dt);
    const slowTarget = e.slowMul < 1 ? Math.min(1, (1 - e.slowMul) * 2) : 0;
    v.slowVis += (slowTarget - v.slowVis) * Math.min(1, dt * 10);
    const frac = e.hp / e.maxHp;
    if (v.barLag > frac) v.barLag = Math.max(frac, v.barLag - dt * (0.5 + (v.barLag - frac) * 2));
    else v.barLag = frac;
    if (e.hp < e.maxHp || e.isBoss) v.barA = Math.min(1, v.barA + dt * 8);
    if (!e.def.bossSpawn && v.pulse > 0) v.pulse = Math.max(0, v.pulse - dt * 2.5);
  }

  function sync() {
    if (!models) return;
    try {
      models.begin();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        models.draw(e, time);
        const v = e.vis;
        e.mesh.position.set(v.dx, e.pos.y, v.dz);
        e.mesh.rotation.y = v.yaw;
      }
      for (let i = 0; i < dying.length; i++) models.draw(dying[i], time);
      models.end();
    } catch (err) {
      console.error('[enemies] render sync failed', err);
    }
  }

  function update(dt) {
    if (!(dt > 0)) return;
    time += dt;
    const g0 = gen;
    const kLat = 1 - Math.exp(-dt * 9);
    const kYaw = 1 - Math.exp(-dt * 12);
    const kYawBoss = 1 - Math.exp(-dt * 4);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.slowTime > 0) {
        e.slowTime -= dt;
        if (e.slowTime <= 0) { e.slowTime = 0; e.slowMul = 1; }
      }
      const L = pathLen(e.pathIndex);
      if (e.dormant && L > 0 && e.dist >= L * (e.def.dormant.wakeAt ?? 0.45)) wake(e);
      e.speed = e.baseSpeed * e.slowMul;
      const mv = e.vis.hopT > 0 ? 0.35 : 1; // split children land before running
      e.dist += e.speed * mv * dt;
      if (L > 0 && e.dist >= L) {
        leak(e);
        if (gen !== g0) return;
        continue;
      }
      place(e, kLat, e.isBoss ? kYawBoss : kYaw);
      tickVis(e, dt);
      if (e.def.bossSpawn) {
        bossSummon(e, dt);
        if (gen !== g0) return;
      }
    }
    // compact out the dead
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive) list[j++] = e;
    }
    list.length = j;
    // dying animations
    j = 0;
    for (let i = 0; i < dying.length; i++) {
      const e = dying[i];
      const v = e.vis;
      v.modeT += dt;
      if (v.punch > 0) v.punch = Math.max(0, v.punch - dt * 7);
      if (v.modeT < (v.mode === 2 ? LEAK_TIME : DIE_TIME)) dying[j++] = e;
    }
    dying.length = j;
    sync();
  }

  function reset() {
    gen++;
    for (const e of list) e.alive = false;
    list.length = 0;
    dying.length = 0;
    aliveN = 0;
    time = 0;
    try { models?.reset(); } catch (err) { console.error('[enemies] reset', err); }
  }

  return {
    list,
    spawn,
    damage,
    slow,
    queryRadius,
    pickTarget,
    remaining,
    aliveCount,
    update,
    reset,
    // extras (debug / UI)
    defs: ENEMIES,
    dying,
    models,
    get time() { return time; },
    sync,
  };
}
