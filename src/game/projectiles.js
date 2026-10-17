// Projectiles & weapon effects for the floppy turrets.
//   kind 'bolt'  : ANTIVIRUS homing scan bolt (pooled, instanced core + additive trail, swept collision, pierce)
//   kind 'burst' : FIREWALL ring of fire around the tower (instant area damage, optional burn DoT)
//   kind 'pulse' : DEFRAG pulse (area slow + optional damage) with a "data blocks" ring
// Rings are one instanced ShaderMaterial mesh animated on the GPU from a spawn time (idea adapted from
// ZelariFPS/src/render/fxParts.js createRings). Zero allocations per frame in steady state.
import * as THREE from 'three';
import { segmentHitsSphere } from '../core/collision.js';

const MAX_BOLTS = 256;
const MAX_RINGS = 48;
const MAX_BURNS = 160;
const TURN = 15;            // homing steering (1/s)
const RETARGET_R = 2.2;     // search radius when the original target died
const PIERCE_RANGE = 3.2;   // how far a piercing bolt keeps flying after its first hit
const TRAIL_LEN = 1.0;
const BURN_TICK = 0.5;      // DoT is applied in chunks (fewer hit events)
const SCAN_CYAN = 0x5ff3ff; // default scan-bolt colour (data/towers.js boltColor overrides)

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Damage helper shared with towers: applies damage through the enemies API and credits the source floppy.
export function dealDamage(ctx, enemy, amount, source = null) {
  if (!enemy || enemy.alive === false || !(amount > 0)) return false;
  const before = typeof enemy.hp === 'number' ? Math.max(0, enemy.hp) : amount;
  let killed = false;
  try { killed = !!ctx.enemies?.damage?.(enemy, amount, source); } catch (err) { console.error('[projectiles] damage', err); }
  if (source) {
    const vs = enemy.def && enemy.def.vs;
    const mul = vs && vs[source.type] > 0 ? vs[source.type] : 1;
    source.damageDealt = (source.damageDealt || 0) + Math.min(amount * mul, before);
    if (killed) source.kills = (source.kills || 0) + 1;
  }
  return killed;
}

const aimY = (e) => (e && e.pos && e.pos.y > 0.05 ? e.pos.y : 0.35);

// ---------------------------------------------------------------- ring shaders (fire wall / data blocks)
// One vertex/fragment pair, compiled twice: WALL (open cylinder band) and FLOOR (flat disc inside the ring).
const RING_VERT = /* glsl */`
attribute vec4 aData;   // x spawn time, y life, z radius, w seed
attribute vec4 aStyle;  // rgb tint, a mode (0 fire, 1 data blocks)
uniform float uTime;
varying vec2 vUv;
varying vec2 vLocal;
varying float vT;
varying float vSeed;
varying float vR;
varying vec4 vStyle;
void main() {
  float t = (uTime - aData.x) / aData.y;
  vT = t;
  vUv = uv;
  vSeed = aData.w;
  vStyle = aStyle;
  vLocal = position.xz;
  if (t < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float e = 1.0 - pow(1.0 - t, 2.4);
  float fire = 1.0 - step(0.5, aStyle.a);
  float r = mix(mix(0.4, 0.42, fire), aData.z, e);
  vR = r;
  vec3 p = position;
  p.xz *= r;
#ifdef FLOOR
  p.y = 0.0;
#else
  float hf = 0.9 * (0.3 + 0.7 * sin(min(t * 2.4, 1.0) * 1.5708)) * (1.0 - t * t);
  float hb = 0.34 * (1.0 - t * 0.6);
  p.y *= mix(hb, hf, fire);
#endif
  vec4 wp = vec4(p, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec2 vLocal;
varying float vT;
varying float vSeed;
varying float vR;
varying vec4 vStyle;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float t = clamp(vT, 0.0, 1.0);
  float fade = 1.0 - t;
  vec3 col;
  float a;
#ifdef FLOOR
  float d = length(vLocal);
  if (vStyle.a < 0.5) {
    // scorching heat on the floor, brightest right behind the wall of fire
    float n = noise(vLocal * vR * 3.0 + vec2(vSeed * 9.0, -uTime * 3.0));
    a = (0.05 + 0.8 * smoothstep(0.6, 0.97, d)) * pow(fade, 1.2) * (0.75 + 0.45 * n) * smoothstep(1.0, 0.95, d);
    col = mix(vec3(0.95, 0.16, 0.02), vec3(1.0, 0.5, 0.06), smoothstep(0.7, 1.0, d)) * vStyle.rgb;
  } else {
    // disk-map grid of blocks lighting up inside the pulse (Win9x defrag look)
    vec2 g = vLocal * vR / 0.2;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float sq = step(0.14, f.x) * step(f.x, 0.86) * step(0.14, f.y) * step(f.y, 0.86);
    float lit = step(0.5, hash(cell + vec2(vSeed * 31.0, floor(uTime * 9.0))));
    float edge = smoothstep(1.0, 0.82, d) * smoothstep(0.08, 0.3, d);
    a = sq * (0.03 + 0.2 * lit) * fade * fade * edge;
    // Win9x defrag map palette: mostly blue (contiguous), some cyan, rare red (bad) and green (moving) blocks
    float h2 = hash(cell * 1.3 + vSeed);
    col = h2 < 0.7 ? vec3(0.16, 0.36, 1.0) : h2 < 0.9 ? vec3(0.25, 0.88, 1.0) : h2 < 0.95 ? vec3(1.0, 0.23, 0.19) : vec3(0.22, 1.0, 0.42);
  }
#else
  if (vStyle.a < 0.5) {
    // tongues of fire: noisy flame height around the ring, white-hot only at the very base
    float x = vUv.x * 26.0 + vSeed * 13.0;
    float n = noise(vec2(x, vUv.y * 2.2 - uTime * 7.5)) * 0.62 + noise(vec2(x * 2.6, vUv.y * 4.5 - uTime * 12.0)) * 0.38;
    float top = 0.28 + 0.72 * n;
    float y = vUv.y;
    a = smoothstep(top, top - 0.28, y);
    float heat = clamp(1.0 - y / max(top, 0.05), 0.0, 1.0);
    col = mix(vec3(0.9, 0.06, 0.01), vec3(1.0, 0.36, 0.02), smoothstep(0.1, 0.7, heat));
    col = mix(col, vec3(1.0, 0.8, 0.3), smoothstep(0.8, 1.0, heat) * 0.7);
    col *= vStyle.rgb * 1.15;
    a *= fade * (0.6 + 0.4 * fade);
  } else {
    // defragmented blocks: quantised columns that flicker like a disk map
    float seg = floor(vUv.x * 44.0);
    float cell = fract(vUv.x * 44.0);
    float lvl = 0.35 + 0.65 * hash(vec2(seg, vSeed * 17.0 + floor(uTime * 10.0)));
    float row = fract(vUv.y * 3.0);
    a = step(0.2, cell) * step(0.2, row) * step(vUv.y, lvl);
    a *= step(0.1, hash(vec2(seg * 1.7, vSeed)));
    col = mix(vStyle.rgb, vec3(0.25, 0.55, 1.0), step(0.8, hash(vec2(seg, vSeed)))) * 1.2;
    a *= fade * 0.9;
  }
#endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createProjectiles(ctx) {
  const THREEScene = ctx.view && ctx.view.scene && ctx.view.scene.isScene ? ctx.view.scene : null;
  const root = new THREE.Group();
  root.name = 'projectiles';
  if (THREEScene) THREEScene.add(root);

  let time = 0;

  // ---------------------------------------------------------------- bolts
  const coreGeo = new THREE.OctahedronGeometry(1, 0);
  coreGeo.scale(0.09, 0.09, 0.3);
  const trailGeo = (() => {
    const g = new THREE.ConeGeometry(1, 1, 6, 1, true);
    g.rotateX(-Math.PI / 2);   // apex toward -Z
    g.translate(0, 0, -0.5);    // base (head) at z = 0, apex (tail) at z = -1
    // rgba vertex colours: full colour, alpha fading from the head (z = 0) to the tail (z = -1)
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.max(0, 1 + pos.getZ(i));
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = k * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return g;
  })();
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, MAX_BOLTS);
  const trails = new THREE.InstancedMesh(trailGeo, trailMat, MAX_BOLTS);
  for (const m of [cores, trails]) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOLTS * 3), 3);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    root.add(m);
  }
  trails.renderOrder = 2;

  const bolts = [];
  for (let i = 0; i < MAX_BOLTS; i++) {
    bolts.push({
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), dir: new THREE.Vector3(), targetPos: new THREE.Vector3(),
      target: null, speed: 14, damage: 0, splash: 0, source: null, onHit: null, pierce: 0, mode: 0,
      hits: [null, null, null, null], hitCount: 0, age: 0, life: 1.6, travel: 0, pierceStart: 0, fizzle: 0,
      cr: 1, cg: 1, cb: 1, tr: 0.3, tg: 0.5, tb: 1, hex: 0x5ff3ff,
    });
  }
  let nBolts = 0;

  // ---------------------------------------------------------------- rings (fire wall / data blocks)
  const aData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4);
  const aStyle = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4);
  aData.setUsage(THREE.DynamicDrawUsage);
  aStyle.setUsage(THREE.DynamicDrawUsage);
  const ringUniforms = { uTime: { value: 0 } };
  function ringMaterial(floor) {
    return new THREE.ShaderMaterial({
      uniforms: ringUniforms,
      defines: floor ? { FLOOR: 1 } : {},
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,   // keep the flames saturated (filmic tone mapping turns orange into olive over the PCB)
      side: floor ? THREE.FrontSide : THREE.DoubleSide,
    });
  }
  const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true);
  wallGeo.translate(0, 0.5, 0);
  const floorGeo = new THREE.CircleGeometry(1, 48);
  floorGeo.rotateX(-Math.PI / 2);
  for (const g of [wallGeo, floorGeo]) { g.setAttribute('aData', aData); g.setAttribute('aStyle', aStyle); }
  const rings = new THREE.InstancedMesh(wallGeo, ringMaterial(false), MAX_RINGS);
  const floors = new THREE.InstancedMesh(floorGeo, ringMaterial(true), MAX_RINGS);
  rings.renderOrder = 4;
  floors.renderOrder = 3;
  rings.name = 'weaponRings';
  floors.name = 'weaponFloors';
  for (const m of [rings, floors]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  let ringHead = 0;
  function clearRings() {
    for (let i = 0; i < MAX_RINGS; i++) aData.setXYZW(i, -1e6, 1, 1, 0);
    aData.needsUpdate = true;
  }
  clearRings();

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _aim = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _col = new THREE.Color();
  const _hitList = [];
  const RING_OPTS = { life: 0.4, width: 0.1 };
  const IMPACT_OPTS = { life: 0.12, width: 0.05 };
  const BURST_OPTS = { speed: 2.6, size: 0.07, life: 0.55, gravity: 2.5, cubes: true };
  const PULSE_OPTS = { speed: 1.4, size: 0.06, life: 0.45, gravity: 0, cubes: true };

  function spawnRing(pos, radius, life, mode, color) {
    const i = ringHead;
    ringHead = (ringHead + 1) % MAX_RINGS;
    _m.makeTranslation(pos.x, 0.03, pos.z);
    rings.setMatrixAt(i, _m);
    rings.instanceMatrix.needsUpdate = true;
    _m.makeTranslation(pos.x, 0.022, pos.z);
    floors.setMatrixAt(i, _m);
    floors.instanceMatrix.needsUpdate = true;
    _col.set(color);
    aData.setXYZW(i, time, life, radius, Math.random());
    aStyle.setXYZW(i, _col.r, _col.g, _col.b, mode);
    aData.needsUpdate = true;
    aStyle.needsUpdate = true;
  }

  // ---------------------------------------------------------------- burns (FIREWALL v3)
  const burns = [];
  for (let i = 0; i < MAX_BURNS; i++) burns.push({ enemy: null, dps: 0, time: 0, acc: 0, tick: 0, source: null, fx: 0 });
  let nBurns = 0;

  function addBurn(enemy, dps, duration, source = null) {
    if (!enemy || enemy.alive === false || !(dps > 0) || !(duration > 0)) return;
    for (let i = 0; i < nBurns; i++) {
      const b = burns[i];
      if (b.enemy === enemy) {
        b.time = Math.max(b.time, duration);
        b.dps = Math.max(b.dps, dps);
        b.source = source || b.source;
        return;
      }
    }
    if (nBurns >= MAX_BURNS) return;
    const b = burns[nBurns++];
    b.enemy = enemy; b.dps = dps; b.time = duration; b.acc = 0; b.tick = BURN_TICK; b.source = source; b.fx = 0;
  }

  function updateBurns(dt) {
    for (let i = 0; i < nBurns;) {
      const b = burns[i];
      const e = b.enemy;
      let keep = !!e && e.alive !== false;
      if (keep) {
        const step = Math.min(dt, b.time);
        b.acc += b.dps * step;
        b.time -= dt;
        b.tick -= dt;
        b.fx -= dt;
        if (b.fx <= 0) {
          b.fx = 0.24 + Math.random() * 0.12 + nBurns * 0.004;   // fewer sparks when many viruses burn
          _v.copy(e.pos);
          _v.y = aimY(e) + 0.1;
          ctx.fx?.spark?.(_v, Math.random() < 0.5 ? 0xff6a1a : 0xffc23a);
        }
        if (b.tick <= 0 || b.time <= 0) {
          b.tick = BURN_TICK;
          if (b.acc > 0) {
            const amount = b.acc;
            b.acc = 0;
            if (dealDamage(ctx, e, amount, b.source)) keep = false;
          }
        }
        if (b.time <= 0) keep = false;
      }
      if (keep) i++;
      else {
        nBurns--;
        burns[i] = burns[nBurns];
        burns[nBurns] = b;
        b.enemy = null; b.source = null;
      }
    }
  }

  // ---------------------------------------------------------------- fire
  function fire(opts) {
    if (!opts) return null;
    const kind = opts.kind || 'bolt';
    if (kind === 'burst') return burst(opts);
    if (kind === 'pulse') return pulse(opts);
    if (nBolts >= MAX_BOLTS || !opts.from) return null;
    const b = bolts[nBolts++];
    b.pos.copy(opts.from);
    b.prev.copy(b.pos);
    b.target = opts.target || null;
    if (opts.targetPos) b.targetPos.copy(opts.targetPos);
    else if (b.target) b.targetPos.copy(b.target.pos);
    else b.targetPos.copy(b.pos);
    // initial direction: toward the target with a little upward kick so bolts arc out of the floppy
    _aim.copy(b.target ? b.target.pos : b.targetPos);
    _aim.y = b.target ? aimY(b.target) : Math.max(0.3, _aim.y);
    b.dir.subVectors(_aim, b.pos);
    const d = b.dir.length();
    if (d < 1e-4) b.dir.set(0, 0, 1);
    else b.dir.multiplyScalar(1 / d);
    b.dir.y += 0.35;
    b.dir.normalize();
    b.speed = opts.speed || 14;
    b.damage = opts.damage || 0;
    b.splash = opts.splash || 0;
    b.source = opts.source || null;
    b.onHit = opts.onHit || null;
    b.pierce = opts.pierce | 0;
    b.mode = 0;
    b.hitCount = 0;
    b.hits[0] = b.hits[1] = b.hits[2] = b.hits[3] = null;
    b.age = 0;
    b.life = opts.life || 1.8;
    b.travel = 0;
    b.pierceStart = 0;
    b.fizzle = 0;
    b.hex = opts.color ?? SCAN_CYAN;
    // trail in the (cyan) scan-beam colour, head lerped to a white-hot core that blooms
    _col.set(b.hex);
    b.tr = _col.r * 1.35; b.tg = _col.g * 1.35; b.tb = _col.b * 1.35;
    _col.lerp(WHITE, 0.65);
    b.cr = _col.r * 2.5; b.cg = _col.g * 2.5; b.cb = _col.b * 2.5;
    return b;
  }
  const WHITE = new THREE.Color(0xffffff);

  function burst(opts) {
    const pos = opts.from;
    if (!pos) return null;
    const radius = opts.splash || 2;
    spawnRing(pos, radius, 0.46, 0, opts.color ?? 0xffffff);
    RING_OPTS.life = 0.38; RING_OPTS.width = 0.12;
    ctx.fx?.ring?.(pos, radius, 0xff5a1f, RING_OPTS);
    _v.copy(pos); _v.y = 0.45;
    ctx.fx?.burst?.(_v, 0xff7a1a, 12, BURST_OPTS);
    _hitList.length = 0;
    ctx.enemies?.queryRadius?.(pos, radius, _hitList);
    const n = _hitList.length;
    for (let i = 0; i < n; i++) {
      const e = _hitList[i];
      if (!e || e.alive === false) continue;
      const killed = dealDamage(ctx, e, opts.damage || 0, opts.source);
      if (!killed && opts.burnDps > 0) addBurn(e, opts.burnDps, opts.burnTime || 2, opts.source);
    }
    _hitList.length = 0;
    opts.onHit?.(null, pos);
    return n;
  }

  function pulse(opts) {
    const pos = opts.from;
    if (!pos) return null;
    const radius = opts.splash || 2.4;
    // the instanced ring already draws the thin yellow block edge + the blue disk-map floor: no extra fx ring
    spawnRing(pos, radius, 0.5, 1, opts.color ?? 0xffd21f);
    _hitList.length = 0;
    ctx.enemies?.queryRadius?.(pos, radius, _hitList);
    const n = _hitList.length;
    for (let i = 0; i < n; i++) {
      const e = _hitList[i];
      if (!e || e.alive === false) continue;
      if (opts.slow) ctx.enemies?.slow?.(e, opts.slow, opts.slowTime || 1);
      if (opts.damage > 0) dealDamage(ctx, e, opts.damage, opts.source);
    }
    if (n > 0 && opts.damage > 0) {
      _v.copy(pos); _v.y = 0.5;
      ctx.fx?.burst?.(_v, opts.color ?? 0xffd21f, 6, PULSE_OPTS);
    }
    _hitList.length = 0;
    opts.onHit?.(null, pos);
    return n;
  }

  // ---------------------------------------------------------------- bolt simulation
  function alreadyHit(b, e) {
    for (let i = 0; i < b.hitCount; i++) if (b.hits[i] === e) return true;
    return false;
  }

  // returns true if the bolt keeps flying
  function hit(b, e) {
    dealDamage(ctx, e, b.damage, b.source);
    if (b.splash > 0) {
      _hitList.length = 0;
      ctx.enemies?.queryRadius?.(e.pos, b.splash, _hitList);
      for (let i = 0; i < _hitList.length; i++) if (_hitList[i] !== e) dealDamage(ctx, _hitList[i], b.damage * 0.5, b.source);
      _hitList.length = 0;
    }
    b.onHit?.(e, b.pos);
    ctx.fx?.ring?.(e.pos, 0.35, b.hex, IMPACT_OPTS);
    if (b.hitCount < b.hits.length) b.hits[b.hitCount++] = e;
    if (b.pierce > 0) {
      b.pierce--;
      if (b.mode !== 1) {
        b.mode = 1;
        b.pierceStart = b.travel;
        b.dir.y = 0;
        if (b.dir.lengthSq() < 0.01) {
          b.dir.set(e.pos.x - (b.source?.pos?.x ?? e.pos.x - 1), 0, e.pos.z - (b.source?.pos?.z ?? e.pos.z));
          if (b.dir.lengthSq() < 1e-6) b.dir.set(1, 0, 0);
        }
        b.dir.normalize();
        b.pos.y = aimY(e);
      }
      b.target = null;
      ctx.fx?.spark?.(b.pos, 0x8fe6ff);
      return true;
    }
    return false;
  }

  function stepBolt(b, dt) {
    b.age += dt;
    if (b.age > b.life) return false;
    b.prev.copy(b.pos);
    if (b.mode === 0) {
      let t = b.target;
      if (!t || t.alive === false) {
        const nt = ctx.enemies?.pickTarget?.(b.pos, RETARGET_R, 'close');
        if (nt && nt.alive !== false && !alreadyHit(b, nt)) b.target = t = nt;
        else { b.target = t = null; b.mode = 2; b.fizzle = 0.16; }
      }
      if (t) {
        _aim.copy(t.pos);
        _aim.y = aimY(t);
        _desired.subVectors(_aim, b.pos);
        const d = _desired.length();
        if (d > 1e-4) {
          _desired.multiplyScalar(1 / d);
          // steer harder when close so bolts never orbit their target
          const k = Math.min(1, (TURN + 30 / Math.max(0.25, d)) * dt);
          b.dir.lerp(_desired, k).normalize();
        }
      }
    } else if (b.mode === 2) {
      b.fizzle -= dt;
      if (b.fizzle <= 0) {
        ctx.fx?.spark?.(b.pos, b.hex);
        b.onHit?.(null, b.pos);
        return false;
      }
    }
    const step = b.speed * dt;
    b.pos.addScaledVector(b.dir, step);
    b.travel += step;
    if (b.pos.y < 0.06) {
      if (b.mode === 2) { ctx.fx?.spark?.(b.pos, b.hex); return false; }
      b.pos.y = 0.06;
    }
    if (b.mode === 0 && b.target) {
      const r = (b.target.radius || 0.3) + 0.08;
      if (segmentHitsSphere(b.prev, b.pos, _aim, r)) return hit(b, b.target);
    } else if (b.mode === 1) {
      const list = ctx.enemies?.list;
      if (list) {
        for (let j = 0; j < list.length; j++) {
          const e = list[j];
          if (!e || e.alive === false || alreadyHit(b, e)) continue;
          _aim.copy(e.pos);
          _aim.y = aimY(e);
          if (segmentHitsSphere(b.prev, b.pos, _aim, (e.radius || 0.3) + 0.08)) {
            if (!hit(b, e)) return false;
          }
        }
      }
      if (b.travel - b.pierceStart > PIERCE_RANGE) return false;
    }
    return true;
  }

  function writeBolts() {
    const ca = cores.instanceColor.array;
    const ta = trails.instanceColor.array;
    for (let i = 0; i < nBolts; i++) {
      const b = bolts[i];
      _q.setFromUnitVectors(Z_AXIS, b.dir);
      const fz = b.mode === 2 ? Math.max(0.05, b.fizzle / 0.16) : 1;
      _s.set(fz, fz, fz);
      _m.compose(b.pos, _q, _s);
      cores.setMatrixAt(i, _m);
      const len = Math.min(TRAIL_LEN * (b.mode === 1 ? 1.4 : 1), b.travel) * fz + 0.001;
      const w = 0.13 * fz;
      _s.set(w, w, len);
      _m.compose(b.pos, _q, _s);
      trails.setMatrixAt(i, _m);
      const j = i * 3;
      ca[j] = b.cr; ca[j + 1] = b.cg; ca[j + 2] = b.cb;
      ta[j] = b.tr; ta[j + 1] = b.tg; ta[j + 2] = b.tb;
    }
    cores.count = nBolts;
    trails.count = nBolts;
    if (nBolts) {
      cores.instanceMatrix.needsUpdate = true;
      trails.instanceMatrix.needsUpdate = true;
      cores.instanceColor.needsUpdate = true;
      trails.instanceColor.needsUpdate = true;
    }
  }

  function update(dt) {
    time += dt;
    ringUniforms.uTime.value = time;
    for (let i = 0; i < nBolts;) {
      const b = bolts[i];
      let alive = false;
      try { alive = stepBolt(b, dt); } catch (err) { console.error('[projectiles] bolt', err); }
      if (alive) i++;
      else {
        nBolts--;
        bolts[i] = bolts[nBolts];
        bolts[nBolts] = b;
        b.target = null; b.source = null; b.onHit = null;
        b.hits[0] = b.hits[1] = b.hits[2] = b.hits[3] = null;
      }
    }
    writeBolts();
    updateBurns(dt);
  }

  function reset() {
    for (let i = 0; i < nBolts; i++) { bolts[i].target = null; bolts[i].source = null; bolts[i].onHit = null; }
    nBolts = 0;
    cores.count = 0;
    trails.count = 0;
    for (let i = 0; i < nBurns; i++) { burns[i].enemy = null; burns[i].source = null; }
    nBurns = 0;
    time = 0;
    ringUniforms.uTime.value = 0;
    clearRings();
  }

  return {
    fire,
    update,
    reset,
    addBurn,
    dealDamage: (enemy, amount, source) => dealDamage(ctx, enemy, amount, source),
    get active() { return nBolts; },
    get burning() { return nBurns; },
    root,
  };
}
