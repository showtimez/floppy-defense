// Floppy turrets: placement, upgrades (v1.0 -> v3.0), selling, targeting, aiming and firing (CONTRACTS §5.6).
// Visuals live in towerModels.js, projectiles / area effects in projectiles.js, stats in src/data/towers.js.
import * as THREE from 'three';
import { GAME } from '../config.js';
import { TOWERS, TOWER_TYPES, MAX_LEVEL, TARGET_MODES } from '../data/towers.js';
import { createTowerModels } from './towerModels.js';

const OK = Object.freeze({ ok: true, reason: null });
const NO_INVALID = Object.freeze({ ok: false, reason: 'invalid' });
const NO_OCCUPIED = Object.freeze({ ok: false, reason: 'occupied' });
const NO_KB = Object.freeze({ ok: false, reason: 'kb' });
const NO_LOCKED = Object.freeze({ ok: false, reason: 'locked' });

const RETARGET_EVERY = 0.12;
const AIM_TOLERANCE = 0.45;   // radians: ANTIVIRUS fires once roughly facing its target
const TURN_RATE = 11;         // max turret yaw speed (rad/s)

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// merged base + level stats, computed once (getDef never allocates)
function buildDefs() {
  const defs = {};
  for (const type of TOWER_TYPES) {
    const base = TOWERS[type];
    let total = 0;
    defs[type] = base.levels.map((lv, i) => {
      total += lv.cost;
      const d = { ...base, ...lv };
      delete d.levels;
      d.type = type;
      d.level = i + 1;
      d.maxLevel = base.levels.length;
      d.label = lv.version;                         // 'v1.0' | 'v2.0' | 'v3.0'
      d.cost = lv.cost;                             // price of THIS level (buy or upgrade into it)
      d.totalCost = total;                          // cumulative KB to reach this level
      d.nextCost = base.levels[i + 1]?.cost ?? null;
      d.dps = (d.damage || 0) * (d.rate || 0);      // per target for area floppies
      d.cooldown = d.rate > 0 ? 1 / d.rate : 1;
      d.descKey = `${base.key}.desc`;
      return Object.freeze(d);
    });
  }
  return defs;
}

export function createTowers(ctx) {
  const events = ctx.events;
  const scene = ctx.view && ctx.view.scene && ctx.view.scene.isScene ? ctx.view.scene : null;
  const models = createTowerModels(ctx);
  const root = new THREE.Group();
  root.name = 'towers';
  root.add(models.group);
  if (scene) scene.add(root);

  const DEFS = buildDefs();
  const list = [];
  const dying = [];
  let nextId = 1;
  let selected = null;
  let time = 0;

  // reused objects (no per-shot allocations)
  const SHOT = {
    kind: 'bolt', from: new THREE.Vector3(), target: null, targetPos: null, speed: 14, damage: 0, splash: 0,
    color: 0xffffff, source: null, onHit: null, pierce: 0, slow: 0, slowTime: 0, burnDps: 0, burnTime: 0,
    fxColor: null, ringMode: 0,
  };
  const FIRE_EVT = { tower: null, target: null };
  const SMOKE_OPTS = { color: 0xd9d9d9, count: 2 };
  const TEXT_OPTS = { size: 0.5, life: 1.0, rise: 1.1 };
  const RING_OPTS = { life: 0.5, width: 0.1 };
  const SPARKLE_OPTS = { speed: 2.4, size: 0.06, life: 0.6, gravity: -3, cubes: true };
  const DUST_OPTS = { speed: 1.4, size: 0.05, life: 0.45, gravity: -4, cubes: true };
  const _v = new THREE.Vector3();

  function getDef(type, level = 1) {
    const arr = DEFS[type];
    if (!arr) return null;
    const l = Math.max(1, Math.min(arr.length, (level | 0) || 1));
    return arr[l - 1];
  }

  const kb = () => (ctx.economy && typeof ctx.economy.kb === 'number' ? ctx.economy.kb : ctx.game?.kb ?? 0);
  function canAfford(n) {
    const eco = ctx.economy;
    try { if (eco && typeof eco.canAfford === 'function') return !!eco.canAfford(n); } catch (err) { /* stub */ }
    return kb() >= n;
  }
  function spend(n, reason) {
    try { return !!ctx.economy?.spend?.(n, reason); } catch (err) { console.error('[towers] spend', err); return false; }
  }

  // yaw that makes the floppy face the closest point of any virus path (idle orientation)
  function facePath(pos) {
    let best = Infinity, bx = pos.x, bz = pos.z + 1;
    const paths = ctx.map?.paths;
    if (Array.isArray(paths)) {
      for (const p of paths) {
        const pts = p && p.points;
        if (!pts) continue;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const dx = b.x - a.x, dz = b.z - a.z;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = a.x + dx * t, cz = a.z + dz * t;
          const d2 = (cx - pos.x) ** 2 + (cz - pos.z) ** 2;
          if (d2 < best) { best = d2; bx = cx; bz = cz; }
        }
      }
    }
    if (bx === pos.x && bz === pos.z) return 0;
    return Math.atan2(bx - pos.x, bz - pos.z);
  }

  // ---------------------------------------------------------------- build / upgrade / sell
  // Late floppies (def.unlockWave) open up once the previous wave has been reached (prep phase of unlockWave).
  function isLocked(type) {
    const w = TOWERS[type]?.unlockWave | 0;
    return w > 1 && (ctx.game?.wave | 0) < w - 1;
  }

  function canPlace(type, slot) {
    const def = getDef(type, 1);
    if (!def || !slot || !slot.pos) return NO_INVALID;
    if (isLocked(type)) return NO_LOCKED;
    if (slot.tower) return NO_OCCUPIED;
    if (!canAfford(def.cost)) return NO_KB;
    return OK;
  }

  function place(type, slot) {
    if (!canPlace(type, slot).ok) return null;
    const def = getDef(type, 1);
    if (!spend(def.cost, 'build')) return null;
    const vis = models.build(type, 1);
    const tower = {
      id: nextId++, type, level: 1, slot, pos: new THREE.Vector3(slot.pos.x, 0, slot.pos.z),
      def, range: def.range, color: def.color, name: def.name, version: def.version,
      cooldown: 0.2, target: null, targeting: 'first', kills: 0, damageDealt: 0, invested: def.cost, shots: 0,
      mesh: vis.root, fireRateMul: 1, idleYaw: 0, retarget: 0, alive: true, vis,
    };
    tower.idleYaw = facePath(tower.pos);
    vis.yaw = tower.idleYaw;
    vis.turret.rotation.y = vis.yaw;
    vis.root.position.set(tower.pos.x, slot.pos.y || 0, tower.pos.z);
    vis.root.userData.towerId = tower.id;
    models.startAnim(vis, 'insert');
    models.animate(vis, 0, time);
    slot.tower = tower;
    list.push(tower);
    events.emit('tower:placed', { tower });
    return tower;
  }

  function upgradeCost(tower) {
    if (!tower || !DEFS[tower.type] || tower.level >= MAX_LEVEL) return null;
    return getDef(tower.type, tower.level + 1).cost;
  }

  function upgrade(tower) {
    if (!tower || !tower.alive) return false;
    const cost = upgradeCost(tower);
    if (cost == null || !canAfford(cost)) return false;
    if (!spend(cost, 'upgrade')) return false;
    tower.level += 1;
    tower.def = getDef(tower.type, tower.level);
    tower.range = tower.def.range;
    tower.version = tower.def.version;
    tower.invested += cost;
    models.startAnim(tower.vis, 'upgrade');
    events.emit('tower:upgraded', { tower });
    return true;
  }

  function sellValue(tower) {
    if (!tower) return 0;
    return Math.floor((tower.invested || 0) * GAME.SELL_REFUND);
  }

  function sell(tower) {
    if (!tower || !tower.alive) return;
    const refund = sellValue(tower);
    try { ctx.economy?.earn?.(refund, 'sell'); } catch (err) { console.error('[towers] earn', err); }
    tower.alive = false;
    tower.target = null;
    if (tower.slot && tower.slot.tower === tower) tower.slot.tower = null;
    const i = list.indexOf(tower);
    if (i !== -1) list.splice(i, 1);
    if (selected === tower) select(null);
    models.top(tower.vis, _v);
    ctx.fx?.text?.(_v, `+${refund}KB`, '#ffb000', TEXT_OPTS);
    models.startAnim(tower.vis, 'eject');
    dying.push(tower);
    events.emit('tower:sold', { tower, refund });
  }

  function select(tower) {
    selected = tower && tower.alive ? tower : null;
    for (let i = 0; i < list.length; i++) list[i].vis.selected = list[i] === selected;
    models.setSelected(selected ? selected.vis : null);
  }

  // ---------------------------------------------------------------- firing
  function fireTower(t) {
    const def = t.def;
    const vis = t.vis;
    vis.recoil = 1;
    vis.shutterK = 1;
    vis.ledT = Math.max(vis.ledT, 0.16);
    t.shots++;
    SHOT.target = t.target;
    SHOT.targetPos = null;
    SHOT.source = t;
    SHOT.onHit = null;
    SHOT.damage = def.damage || 0;
    SHOT.pierce = 0;
    SHOT.slow = 0;
    SHOT.slowTime = 0;
    SHOT.burnDps = 0;
    SHOT.burnTime = 0;
    SHOT.splash = 0;
    SHOT.fxColor = null;
    SHOT.ringMode = 0;
    if (def.attack === 'bolt') {
      SHOT.kind = 'bolt';
      models.muzzle(vis, SHOT.from);
      SHOT.speed = def.speed || 14;
      SHOT.pierce = def.pierce | 0;
      SHOT.color = def.boltColor ?? def.color;
      ctx.projectiles?.fire?.(SHOT);
      ctx.fx?.spark?.(SHOT.from, SHOT.color);
    } else if (def.attack === 'burst') {
      SHOT.kind = 'burst';
      SHOT.from.copy(t.pos);
      SHOT.splash = def.range;
      SHOT.burnDps = def.burnDps || 0;
      SHOT.burnTime = def.burnTime || 0;
      SHOT.color = t.level >= 3 ? 0xfff0c8 : 0xffffff;
      if (def.burstColor != null) {          // FORMAT: purple wipe instead of fire
        SHOT.color = 0xffffff;
        SHOT.fxColor = def.burstColor;
        SHOT.ringMode = 0.25;
      }
      ctx.projectiles?.fire?.(SHOT);
    } else {
      SHOT.kind = 'pulse';
      SHOT.from.copy(t.pos);
      SHOT.splash = def.range;
      SHOT.slow = def.slow || 0.5;
      SHOT.slowTime = def.slowTime || 1;
      SHOT.color = def.color;
      vis.pulseT = 0;
      ctx.projectiles?.fire?.(SHOT);
    }
    SHOT.target = null;
    SHOT.source = null;
    FIRE_EVT.tower = t;
    FIRE_EVT.target = t.target;
    events.emit('tower:fire', FIRE_EVT);
    FIRE_EVT.tower = null;
    FIRE_EVT.target = null;
  }

  function inRange(t, e) {
    const dx = e.pos.x - t.pos.x, dz = e.pos.z - t.pos.z;
    const r = t.range + (e.radius || 0);
    return dx * dx + dz * dz <= r * r;
  }

  function onSwap(t) {
    const vis = t.vis;
    models.setLevel(vis, t.level);
    models.top(vis, _v);
    _v.y += 0.25;
    ctx.fx?.text?.(_v, t.def.version, '#ffe066', TEXT_OPTS);
    ctx.fx?.burst?.(_v, 0xffd75a, 16, SPARKLE_OPTS);
    RING_OPTS.life = 0.5; RING_OPTS.width = 0.1;
    ctx.fx?.ring?.(t.pos, 0.95, t.color, RING_OPTS);
  }

  function onClick(t) {
    _v.copy(t.pos);
    _v.y = 0.35;
    ctx.fx?.burst?.(_v, 0xd8cfb4, 8, DUST_OPTS);
    ctx.fx?.spark?.(_v, 0x39ff6a);
  }

  function updateTower(t, dt) {
    const vis = t.vis;
    const def = t.def;

    // heat penalty (+ red tint and steam wisps)
    let mul = 1;
    try {
      const m = ctx.heat?.fireRateMul?.(t.pos);
      if (typeof m === 'number' && m > 0) mul = m;
    } catch (err) { /* stub */ }
    t.fireRateMul = mul;
    const hot = mul < 1 ? 1 : 0;
    vis.heatK += (hot - vis.heatK) * Math.min(1, dt * 4);
    if (vis.heatK < 0.01 && !hot) vis.heatK = 0;
    if (hot) {
      vis.smokeT -= dt;
      if (vis.smokeT <= 0) {
        vis.smokeT = 0.85 + Math.random() * 0.6;
        models.top(vis, _v);
        ctx.fx?.smoke?.(_v, SMOKE_OPTS);
      }
    }

    const evt = models.animate(vis, dt, time);
    if (evt === 'click') onClick(t);
    else if (evt === 'swap') onSwap(t);
    vis.pulseT += dt;

    // targeting
    t.retarget -= dt;
    const cur = t.target;
    if (!cur || cur.alive === false || t.retarget <= 0 || !inRange(t, cur)) {
      let next = null;
      try { next = ctx.enemies?.pickTarget?.(t.pos, t.range, t.targeting || 'first') || null; } catch (err) { next = null; }
      t.target = next && next.alive !== false ? next : null;
      t.retarget = RETARGET_EVERY;
    }

    // aiming
    let diff = 0;
    if (def.attack === 'pulse') {
      const boost = vis.pulseT < 0.3 ? 1 - vis.pulseT / 0.3 : 0;
      vis.yaw = wrapAngle(vis.yaw + dt * (t.target ? 1.6 + 9 * boost : 0.6) * (hot ? 0.5 : 1));
    } else {
      const desired = t.target
        ? Math.atan2(t.target.pos.x - t.pos.x, t.target.pos.z - t.pos.z)
        : t.idleYaw + 0.6 * Math.sin(time * 0.45 + t.id * 1.7);
      diff = wrapAngle(desired - vis.yaw);
      const rate = t.target ? TURN_RATE : 2.2;
      const k = 1 - Math.exp(-(t.target ? 18 : 3) * dt);
      let step = diff * k;
      const max = rate * dt;
      if (step > max) step = max; else if (step < -max) step = -max;
      vis.yaw = wrapAngle(vis.yaw + step);
      diff = wrapAngle(desired - vis.yaw);
    }
    vis.turret.rotation.y = vis.yaw;

    // cooldown (scaled by the heat penalty) and firing
    t.cooldown -= dt * mul;
    if (t.cooldown <= 0) {
      if (vis.ready && t.target && (!def.aims || Math.abs(diff) < AIM_TOLERANCE)) {
        fireTower(t);
        t.cooldown += def.cooldown;
        if (t.cooldown < def.cooldown * 0.5) t.cooldown = def.cooldown * 0.5;
      } else {
        t.cooldown = 0;
      }
    }
  }

  function update(dt) {
    time += dt;
    models.updateShared(time);
    for (let i = 0; i < list.length; i++) {
      try { updateTower(list[i], dt); } catch (err) { console.error('[towers] update', err); }
    }
    for (let i = dying.length - 1; i >= 0; i--) {
      const t = dying[i];
      if (models.animate(t.vis, dt, time) === 'done') {
        models.disposeVis(t.vis);
        dying.splice(i, 1);
      }
    }
    models.sync(list, dying, time);
  }

  function reset() {
    for (const t of list) {
      t.alive = false;
      t.target = null;
      if (t.slot && t.slot.tower === t) t.slot.tower = null;
      models.disposeVis(t.vis);
    }
    for (const t of dying) models.disposeVis(t.vis);
    list.length = 0;
    dying.length = 0;
    const slots = ctx.map?.slots;
    if (Array.isArray(slots)) for (const s of slots) if (s && s.tower) s.tower = null;
    selected = null;
    models.clear();
    nextId = 1;
    time = 0;
  }

  // Shader warm-up: towerModels keeps every part (all levels' materials) visible with zero instances until the scene
  // has been rendered once, so the global warm-up / first real frame compiles them before the first build.

  return {
    list,
    types: TOWER_TYPES,
    targetModes: TARGET_MODES,
    maxLevel: MAX_LEVEL,
    getDef,
    isLocked,
    canPlace,
    place,
    upgradeCost,
    upgrade,
    sellValue,
    sell,
    select,
    update,
    reset,
    byId: (id) => list.find((t) => t.id === id) || null,
    get selected() { return selected; },
    nextTargeting(mode) {
      const i = TARGET_MODES.indexOf(mode);
      return TARGET_MODES[(i + 1) % TARGET_MODES.length];
    },
    models,
    root,
  };
}
