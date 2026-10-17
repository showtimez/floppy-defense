// Transient effects (CONTRACTS section 5.2): voxel de-rez bursts, floating DOS labels, ground rings, beams,
// sparks, smoke. All GPU-evaluated instanced systems (see fxSystems.js): one draw call each, zero per-frame
// allocations. The module also subscribes itself to gameplay events for the standard juice.
import * as THREE from 'three';
import { PALETTE } from '../config.js';
import {
  SHAPE, createSystem, cubeMaterial, glowMaterial, smokeMaterial, ringMaterial, beamMaterial, textMaterial,
} from './fxSystems.js';
import { createGlyphAtlas } from './glyphs.js';

const GREEN = '#39ff6a';
const RED = '#ff3b30';
const RING_Y = 0.035;

export function createFx(ctx) {
  const view = ctx.view;
  const scene = view && view.scene && view.scene.isScene ? view.scene : null;
  const mobile = !!(view && view.isMobile === true);
  const rnd = Math.random; // visual only: never consume the seeded gameplay rng

  const uTime = { value: 0 };
  const uKill = { value: -1 };
  let time = 0;

  // ---------------------------------------------------------------------------------------------
  // Systems
  // ---------------------------------------------------------------------------------------------
  const cap = (d, m) => (mobile ? m : d);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const quadGeo = new THREE.PlaneGeometry(1, 1);
  const beamGeo = new THREE.PlaneGeometry(1, 1, 10, 1);

  const cubes = createSystem({
    name: 'fx:cubes', base: boxGeo, capacity: cap(1600, 800), renderOrder: 2,
    layout: { aP: 4, aV: 4, aC: 4, aR: 4, aX: 4 }, material: cubeMaterial({ uTime, uKill }),
  });
  const rings = createSystem({
    name: 'fx:rings', base: quadGeo, capacity: cap(128, 80), renderOrder: 3,
    layout: { aP: 4, aC: 4, aR: 4 }, material: ringMaterial({ uTime, uKill }),
  });
  const smokes = createSystem({
    name: 'fx:smoke', base: quadGeo, capacity: cap(240, 140), renderOrder: 4,
    layout: { aP: 4, aV: 4, aC: 4, aX: 4 }, material: smokeMaterial({ uTime, uKill }),
  });
  const glows = createSystem({
    name: 'fx:glow', base: quadGeo, capacity: cap(1200, 600), renderOrder: 5,
    layout: { aP: 4, aV: 4, aC: 4, aX: 4 }, material: glowMaterial({ uTime, uKill }),
  });
  const beams = createSystem({
    name: 'fx:beams', base: beamGeo, capacity: cap(96, 64), renderOrder: 6,
    layout: { aA: 4, aB: 4, aC: 4 }, material: beamMaterial({ uTime, uKill }),
  });
  let atlas = null;
  try { atlas = createGlyphAtlas(); } catch (err) { console.warn('[fx] glyph atlas failed', err); }
  const texts = atlas ? createSystem({
    name: 'fx:text', base: quadGeo, capacity: cap(640, 420), renderOrder: 50,
    layout: { aP: 4, aG: 4, aC: 4, aD: 1, aO: 3 },
    material: textMaterial({
      uTime, uKill,
      uAtlas: { value: atlas.texture },
      uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uAspect: { value: atlas.aspect },
    }),
  }) : null;
  const all = [cubes, rings, smokes, glows, beams, texts].filter(Boolean);
  const group = new THREE.Group();
  group.name = 'fx';
  for (const s of all) group.add(s.mesh);
  scene?.add(group);

  // ---------------------------------------------------------------------------------------------
  // Colour helpers (no allocations after warm-up)
  // ---------------------------------------------------------------------------------------------
  const col = new THREE.Color();
  const col2 = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  const tmpPos = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const strCache = new Map();
  function setColor(out, c, fallback = 0xffffff) {
    if (c == null) return out.set(fallback);
    if (c.isColor) return out.copy(c);
    if (typeof c === 'number') return out.setHex(c);
    if (typeof c === 'string') {
      let cached = strCache.get(c);
      if (!cached) {
        cached = new THREE.Color();
        try { cached.setStyle(c); } catch { cached.set(fallback); }
        strCache.set(c, cached);
      }
      return out.copy(cached);
    }
    if (typeof c.r === 'number') return out.setRGB(c.r, c.g, c.b);
    return out.set(fallback);
  }
  const quality = () => (view && view.quality === 'low' ? 0.55 : mobile ? 0.8 : 1);
  const scaleCount = (n) => Math.max(1, Math.round(n * quality()));

  // ---------------------------------------------------------------------------------------------
  // Low-level spawners
  // ---------------------------------------------------------------------------------------------
  function cube(x, y, z, vx, vy, vz, life, c, size, spin, gravity, glow, delay = 0) {
    const i = cubes.alloc();
    const A = cubes.arrays;
    let o = i * 4;
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = time + delay;
    A.aV[o] = vx; A.aV[o + 1] = vy; A.aV[o + 2] = vz; A.aV[o + 3] = life;
    A.aC[o] = c.r; A.aC[o + 1] = c.g; A.aC[o + 2] = c.b; A.aC[o + 3] = size;
    let ax = rnd() - 0.5, ay = rnd() - 0.5, az = rnd() - 0.5;
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l; ay /= l; az /= l;
    A.aR[o] = ax; A.aR[o + 1] = ay; A.aR[o + 2] = az; A.aR[o + 3] = spin;
    o = i * 4;
    A.aX[o] = gravity; A.aX[o + 1] = 0.02; A.aX[o + 2] = glow; A.aX[o + 3] = 1;
  }

  function glowP(x, y, z, vx, vy, vz, life, c, k, s0, s1, gravity, drag, shape, delay = 0) {
    const i = glows.alloc();
    const A = glows.arrays;
    const o = i * 4;
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = time + delay;
    A.aV[o] = vx; A.aV[o + 1] = vy; A.aV[o + 2] = vz; A.aV[o + 3] = life;
    A.aC[o] = c.r * k; A.aC[o + 1] = c.g * k; A.aC[o + 2] = c.b * k; A.aC[o + 3] = s0;
    A.aX[o] = s1; A.aX[o + 1] = gravity; A.aX[o + 2] = drag; A.aX[o + 3] = shape;
  }

  function ringP(x, z, r0, r1, life, c, k, width, dashes = 0, delay = 0, y = RING_Y) {
    const i = rings.alloc();
    const A = rings.arrays;
    const o = i * 4;
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = time + delay;
    A.aC[o] = c.r * k; A.aC[o + 1] = c.g * k; A.aC[o + 2] = c.b * k; A.aC[o + 3] = life;
    A.aR[o] = r0; A.aR[o + 1] = r1; A.aR[o + 2] = width; A.aR[o + 3] = dashes;
  }

  function smokeP(x, y, z, vx, vy, vz, life, c, s0, s1, buoy, drag, delay = 0) {
    const i = smokes.alloc();
    const A = smokes.arrays;
    const o = i * 4;
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = time + delay;
    A.aV[o] = vx; A.aV[o + 1] = vy; A.aV[o + 2] = vz; A.aV[o + 3] = life;
    A.aC[o] = c.r; A.aC[o + 1] = c.g; A.aC[o + 2] = c.b; A.aC[o + 3] = s0;
    A.aX[o] = s1; A.aX[o + 1] = buoy; A.aX[o + 2] = drag; A.aX[o + 3] = rnd();
  }

  function beamP(ax, ay, az, bx, by, bz, life, c, k, width, delay = 0) {
    const i = beams.alloc();
    const A = beams.arrays;
    const o = i * 4;
    A.aA[o] = ax; A.aA[o + 1] = ay; A.aA[o + 2] = az; A.aA[o + 3] = time + delay;
    A.aB[o] = bx; A.aB[o + 1] = by; A.aB[o + 2] = bz; A.aB[o + 3] = life;
    A.aC[o] = c.r * k; A.aC[o + 1] = c.g * k; A.aC[o + 2] = c.b * k; A.aC[o + 3] = width;
  }

  // Recent labels (fixed ring, no allocation): a label spawned within STACK_T of a neighbour it would overlap
  // on screen is pushed above it (and nudged right), so 'RESIST' + 'BURNS!', a burst of '+4KB' or the boss
  // reward + name stay legible. Overlap is tested in camera space (labels are screen-aligned billboards, and
  // a world-Y offset shrinks to ~1/3 on screen under the steep play camera); the push accounts for how far
  // the earlier label has already risen and where both end up.
  const RING = 16;
  const STACK_T = 0.35, NEAR = 0.7, DUP_T = 0.6, MAX_STACK = 4;
  const GLYPH_W = atlas ? atlas.aspect : 0.625;
  const rX = new Float32Array(RING), rZ = new Float32Array(RING); // original anchor (ground), for duplicates
  const rU = new Float32Array(RING), rV = new Float32Array(RING); // final anchor in camera right/up units
  const rT = new Float32Array(RING).fill(-1e9), rS = new Float32Array(RING), rW = new Float32Array(RING);
  const rR = new Float32Array(RING), rL = new Float32Array(RING).fill(1); // rise (camera units), life
  const rStr = new Array(RING).fill(null);
  let rHead = 0;
  const camRight = new THREE.Vector3(1, 0, 0), camUp = new THREE.Vector3(0, 1, 0);
  const riseCurve = (age, life) => {
    const k = Math.min(1, Math.max(0, age / Math.max(0.01, life)) * 1.25);
    return 1 - (1 - k) * (1 - k) * (1 - k); // same ease as the text shader
  };

  // identical status label at the same spot within DUP_T (e.g. 'RESIST' on a packed trojan column): skip it
  function isDuplicate(x, z, str, delay) {
    const t = time + delay;
    for (let i = 0; i < RING; i++) {
      if (rStr[i] === str && t - rT[i] < DUP_T && t >= rT[i] - 0.05 && Math.abs(rX[i] - x) < NEAR && Math.abs(rZ[i] - z) < NEAR) return true;
    }
    return false;
  }

  function textP(x, y, z, str, c, k, size, life, rise, delay = 0, outline = null, outlineK = 1) {
    if (!texts || !str) return;
    const n = Math.min(str.length, 40);
    const w = n * size * GLYPH_W;
    const t = time + delay;
    const cam = view?.camera;
    if (cam?.isCamera) {
      camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
      camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    }
    const u0 = x * camRight.x + y * camRight.y + z * camRight.z;
    const v0 = x * camUp.x + y * camUp.y + z * camUp.z;
    const riseV = rise * camUp.y; // the shader rises along world Y
    let u = u0, v = v0;
    for (let pass = 0; pass < MAX_STACK; pass++) {
      let bumped = false;
      for (let i = 0; i < RING; i++) {
        const dt = t - rT[i];
        if (dt >= STACK_T || dt <= -STACK_T) continue;
        if (Math.abs(rU[i] - u) >= (rW[i] + w) * 0.5) continue;
        const step = 0.55 * (rS[i] + size);
        const vNow = rV[i] + rR[i] * riseCurve(dt, rL[i]);
        const need = Math.max(vNow + step, rV[i] + rR[i] - riseV + step); // clear now and at the end
        if (v < need - 0.005 && v > vNow - step) {
          v = need;
          u = rU[i] + 0.2;
          bumped = true;
        }
      }
      if (!bumped) break;
    }
    // move the anchor by the camera-space push
    const du = u - u0, dv = v - v0;
    const sx = x + camRight.x * du + camUp.x * dv;
    const sy = y + camRight.y * du + camUp.y * dv;
    const sz = z + camRight.z * du + camUp.z * dv;
    rX[rHead] = x; rZ[rHead] = z; rU[rHead] = u; rV[rHead] = v;
    rT[rHead] = t; rS[rHead] = size; rW[rHead] = w; rR[rHead] = riseV; rL[rHead] = life; rStr[rHead] = str;
    rHead = (rHead + 1) % RING;

    const A = texts.arrays;
    const oR = outline ? outline.r * outlineK : 0, oG = outline ? outline.g * outlineK : 0, oB = outline ? outline.b * outlineK : 0;
    for (let j = 0; j < n; j++) {
      const code = str.charCodeAt(j);
      if (code === 32) continue;
      const i = texts.alloc();
      const o = i * 4;
      A.aP[o] = sx; A.aP[o + 1] = sy; A.aP[o + 2] = sz; A.aP[o + 3] = t;
      A.aG[o] = atlas.index(code); A.aG[o + 1] = j - (n - 1) / 2; A.aG[o + 2] = life; A.aG[o + 3] = size;
      A.aC[o] = c.r * k; A.aC[o + 1] = c.g * k; A.aC[o + 2] = c.b * k; A.aC[o + 3] = rise;
      A.aD[i] = j * 0.022;
      const q = i * 3;
      A.aO[q] = oR; A.aO[q + 1] = oG; A.aO[q + 2] = oB;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------
  function burst(pos, color, count = 16, opts) {
    if (!pos) return;
    const speed = opts?.speed ?? 3;
    const size = opts?.size ?? 0.08;
    const life = opts?.life ?? 0.6;
    const gravity = opts?.gravity ?? -6;
    const asCubes = opts?.cubes ?? true;
    const n = scaleCount(count);
    setColor(col, color, PALETTE.phosphor);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const up = 0.35 + rnd() * 0.75;
      const sp = speed * (0.35 + rnd() * 0.75);
      const hz = Math.sqrt(Math.max(0, 1 - up * up * 0.5));
      const vx = Math.cos(a) * hz * sp, vz = Math.sin(a) * hz * sp, vy = up * sp;
      const lf = life * (0.7 + rnd() * 0.6);
      // a few debris pieces burn white-hot, the rest keep the virus colour
      col2.copy(col);
      if (rnd() < 0.18) col2.lerp(WHITE, 0.6);
      if (asCubes) {
        cube(pos.x, pos.y, pos.z, vx, vy, vz, lf, col2, size * (0.55 + rnd() * 0.9), 6 + rnd() * 14, gravity, 0.6);
      } else {
        const s = size * 2.6 * (0.6 + rnd() * 0.8);
        glowP(pos.x, pos.y, pos.z, vx, vy, vz, lf, col2, 2.2, s, s * 0.3, gravity, 1.5, SHAPE.PIXEL);
      }
    }
    glowP(pos.x, pos.y, pos.z, 0, 0, 0, 0.16, col, 2.4, size * 14, size * 3, 0, 0, SHAPE.GLOW);
  }

  // opts: { size = 0.5, life = 0.9, rise = 1.2, delay = 0, outline (colour, glowing rim) }
  function text(pos, string, color = GREEN, opts) {
    if (!pos || string == null) return;
    const str = typeof string === 'string' ? string : String(string);
    const delay = opts?.delay ?? 0;
    if (isDuplicate(pos.x, pos.z, str, delay)) return;
    setColor(col, color, PALETTE.phosphor);
    let outline = null;
    if (opts?.outline != null) outline = setColor(col2, opts.outline, 0x000000);
    textP(pos.x, pos.y, pos.z, str, col, 1.35, opts?.size ?? 0.5, opts?.life ?? 0.9, opts?.rise ?? 1.2, delay, outline, 2.2);
  }

  function ring(pos, radius = 1, color = PALETTE.phosphor, opts) {
    if (!pos) return;
    setColor(col, color, PALETTE.phosphor);
    const r = Math.max(0.05, radius);
    ringP(pos.x, pos.z, r * 0.15, r, opts?.life ?? 0.4, col, 1.8, opts?.width ?? 0.08, opts?.dashes ?? 0, opts?.delay ?? 0);
  }

  function beam(from, to, color = PALETTE.phosphor, opts) {
    if (!from || !to) return;
    setColor(col, color, PALETTE.phosphor);
    beamP(from.x, from.y, from.z, to.x, to.y, to.z, opts?.life ?? 0.12, col, 2.2, opts?.width ?? 0.05);
  }

  function spark(pos, color = 0xffffff) {
    if (!pos) return;
    setColor(col, color, 0xffffff);
    col2.copy(col).lerp(WHITE, 0.35);
    glowP(pos.x, pos.y, pos.z, 0, 0, 0, 0.11, col2, 2.6, 0.75, 0.15, 0, 0, SHAPE.FLARE);
    glowP(pos.x, pos.y, pos.z, 0, 0, 0, 0.09, col, 2.0, 0.5, 0.1, 0, 0, SHAPE.GLOW);
    const n = scaleCount(3);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const sp = 2 + rnd() * 2.5;
      glowP(pos.x, pos.y, pos.z, Math.cos(a) * sp, 0.8 + rnd() * 1.5, Math.sin(a) * sp, 0.16 + rnd() * 0.08, col2, 2.4,
        0.07, 0.03, -9, 3, SHAPE.PIXEL);
    }
  }

  function smoke(pos, opts) {
    if (!pos) return;
    setColor(col, opts?.color ?? 0x555555, 0x555555);
    const n = scaleCount(opts?.count ?? 4);
    for (let j = 0; j < n; j++) {
      smokeP(pos.x + (rnd() - 0.5) * 0.5, pos.y + 0.2 + rnd() * 0.2, pos.z + (rnd() - 0.5) * 0.5,
        (rnd() - 0.5) * 0.35, 0.55 + rnd() * 0.45, (rnd() - 0.5) * 0.35,
        1.6 + rnd() * 0.9, col, 0.28 + rnd() * 0.12, 0.9 + rnd() * 0.5, 0.25, 0.9, rnd() * 0.15);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Event-driven juice
  // ---------------------------------------------------------------------------------------------
  const kbStrings = new Map();
  const kbText = (n) => {
    let s = kbStrings.get(n);
    if (!s) { s = `+${n}KB`; kbStrings.set(n, s); }
    return s;
  };
  const cpuStrings = new Map();
  const cpuText = (amount) => {
    const n = Math.round(amount);
    let s = cpuStrings.get(n);
    if (!s) { s = `-${n}%`; cpuStrings.set(n, s); }
    return s;
  };
  function enemyColor(enemy) {
    return enemy?.color ?? PALETTE[enemy?.type] ?? (enemy?.isBoss ? PALETTE.boss : PALETTE.worm);
  }
  function towerColor(tower) {
    return tower?.color ?? tower?.def?.color ?? PALETTE[tower?.type] ?? PALETTE.phosphor;
  }

  function virusDeath(enemy, reward) {
    const p = enemy.pos;
    if (!p) return;
    const r = enemy.radius ?? 0.3;
    const c = enemyColor(enemy);
    burst(p, c, Math.round(Math.min(34, Math.max(10, 8 + r * 48))), {
      speed: 2.6 + r * 3, size: 0.08 + r * 0.14, life: 0.9, gravity: -11,
    });
    setColor(col, c);
    glowP(p.x, p.y, p.z, 0, 0, 0, 0.18, col, 3.0, 0.8 + r * 2.4, 0.2, 0, 0, SHAPE.GLOW);
    col2.copy(col).lerp(WHITE, 0.5);
    glowP(p.x, p.y, p.z, 0, 0, 0, 0.13, col2, 2.5, 1.0 + r * 2, 0.2, 0, 0, SHAPE.FLARE);
    ringP(p.x, p.z, 0.1, 0.55 + r * 1.6, 0.32, col, 1.6, 0.06);
    if (reward > 0) {
      setColor(col, GREEN);
      textP(p.x, p.y + 0.55, p.z, kbText(reward), col, 1.35, 0.5, 1.0, 1.05);
    }
  }

  function bossDeath(enemy, reward) {
    const p = enemy.pos;
    if (!p) return;
    const c = enemyColor(enemy);
    setColor(col, c);
    const n = scaleCount(230);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const up = 0.3 + rnd() * 0.8;
      const sp = 3 + rnd() * 6.5;
      col2.copy(col);
      const roll = rnd();
      if (roll < 0.22) col2.lerp(WHITE, 0.7);
      else if (roll < 0.35) col2.setHex(PALETTE.phosphor);
      cube(p.x + (rnd() - 0.5), p.y + rnd() * 0.6, p.z + (rnd() - 0.5), Math.cos(a) * sp, up * sp, Math.sin(a) * sp,
        1.4 + rnd() * 1.0, col2, 0.1 + rnd() * 0.22, 4 + rnd() * 10, -12, 0.9, rnd() * 0.25);
    }
    setColor(col, c);
    glowP(p.x, p.y, p.z, 0, 0, 0, 0.45, col, 3.5, 7, 1.0, 0, 0, SHAPE.GLOW);
    for (let j = 0; j < 3; j++) {
      col2.copy(col).lerp(WHITE, 0.6);
      glowP(p.x + (rnd() - 0.5) * 1.5, p.y + rnd(), p.z + (rnd() - 0.5) * 1.5, 0, 0, 0, 0.22, col2, 3, 4.5, 0.5, 0, 0,
        SHAPE.FLARE, j * 0.12);
      ringP(p.x, p.z, 0.3, 3 + j * 2.2, 0.75 + j * 0.15, col, 2.2, 0.16, j === 1 ? 32 : 0, j * 0.12);
    }
    const np = scaleCount(50);
    setColor(col2, PALETTE.phosphor);
    for (let j = 0; j < np; j++) {
      const a = rnd() * Math.PI * 2;
      const sp = 1 + rnd() * 4;
      glowP(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, 3 + rnd() * 5, Math.sin(a) * sp, 1.2 + rnd() * 0.8, col2, 2.5,
        0.14, 0.06, -6, 0.8, SHAPE.PIXEL, rnd() * 0.3);
    }
    setColor(col, GREEN);
    textP(p.x, p.y + 1.1, p.z, kbText(reward || 0), col, 1.5, 0.8, 1.8, 1.4, 0.15);
    // the name types in after the reward pops, high enough that the two never cross while rising
    setColor(col, PALETTE.amber);
    const name = (enemy.name || enemy.def?.name || 'VIRUS').toString().toUpperCase();
    textP(p.x, p.y + 2.6, p.z, `${name} DELETED`, col, 1.4, 0.55, 2.4, 1.0, 0.35);
  }

  const hitBudget = { tokens: 30 };
  let heatSpot = null;
  let smokeTimer = 0;

  const ev = ctx.events;
  const on = (name, fn) => ev?.on?.(name, fn);

  on('enemy:killed', ({ enemy, reward } = {}) => {
    if (!enemy) return;
    if (enemy.isBoss) bossDeath(enemy, reward ?? enemy.reward);
    else virusDeath(enemy, reward ?? enemy.reward ?? 0);
  });

  on('enemy:hit', ({ enemy } = {}) => {
    if (!enemy || !enemy.pos || hitBudget.tokens < 1) return;
    const last = enemy.__fxHitT ?? -1;
    if (time - last < 0.06 && last <= time) return;
    enemy.__fxHitT = time;
    hitBudget.tokens -= 1;
    const p = enemy.pos;
    setColor(col, enemyColor(enemy)).lerp(WHITE, 0.55);
    glowP(p.x, p.y + 0.05, p.z, 0, 0, 0, 0.08, col, 2.2, 0.45, 0.1, 0, 0, SHAPE.GLOW);
    for (let j = 0; j < 2; j++) {
      const a = rnd() * Math.PI * 2;
      glowP(p.x, p.y + 0.05, p.z, Math.cos(a) * 2.2, 1 + rnd() * 1.5, Math.sin(a) * 2.2, 0.15, col, 2.2, 0.06, 0.03, -9, 2,
        SHAPE.PIXEL);
    }
  });

  on('cpu:damage', ({ amount = 5 } = {}) => {
    const cpu = ctx.map?.cpu;
    const p = cpu?.pos;
    if (!p) return;
    const k = Math.min(1, amount / 25);
    tmpPos.set(p.x, (p.y || 0) + 0.6, p.z);
    burst(tmpPos, PALETTE.danger, 18 + Math.round(k * 30), { speed: 3.5 + k * 3, size: 0.09, life: 0.9, gravity: -10 });
    setColor(col, PALETTE.danger);
    ringP(p.x, p.z, 0.3, (cpu.radius ?? 1.2) * (1.8 + k), 0.55, col, 2.2, 0.12, 24);
    glowP(p.x, (p.y || 0) + 0.5, p.z, 0, 0, 0, 0.25, col, 3, 3 + k * 3, 0.5, 0, 0, SHAPE.GLOW);
    // white digits with a glowing red rim, anchored at the far edge of the package (above its label, which
    // flashes red with the die) so the number rises over the dark board instead of the red CPU
    let gx = 0, gz = -1;
    const cam = view?.camera;
    if (cam?.isCamera) {
      cam.getWorldDirection(tmpDir);
      const l = Math.hypot(tmpDir.x, tmpDir.z);
      if (l > 1e-3) { gx = tmpDir.x / l; gz = tmpDir.z / l; }
    }
    const off = (cpu.radius ?? 2) * 0.95;
    textP(p.x + gx * off, (p.y || 0) + 1.0, p.z + gz * off, cpuText(amount), WHITE, 1.15, 0.86, 1.25, 1.1, 0, col, 2.4);
  });

  // towers.js already does the insertion click (dust + spark), the upgrade sparkle/version label and the
  // sell refund label: these handlers only add complementary layers (ground ring, "data upload" pixels).
  on('tower:placed', ({ tower } = {}) => {
    const p = tower?.pos || tower?.slot?.pos;
    if (!p) return;
    setColor(col, PALETTE.beige);
    ringP(p.x, p.z, 0.2, 1.15, 0.45, col, 0.9, 0.12);
    setColor(col, towerColor(tower));
    const np = scaleCount(8);
    for (let j = 0; j < np; j++) {
      glowP(p.x + (rnd() - 0.5) * 0.6, 0.2, p.z + (rnd() - 0.5) * 0.4, 0, 1.4 + rnd() * 1.8, 0, 0.5 + rnd() * 0.3, col, 2.2,
        0.09, 0.04, 0, 1.5, SHAPE.PIXEL, 0.1 + rnd() * 0.2);
    }
  });

  on('tower:upgraded', ({ tower } = {}) => {
    const p = tower?.pos || tower?.slot?.pos;
    if (!p) return;
    setColor(col, towerColor(tower));
    ringP(p.x, p.z, 0.2, 1.6, 0.7, col, 1.4, 0.06, 20, 0.1);
    const n = scaleCount(16);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.25 + rnd() * 0.4;
      glowP(p.x + Math.cos(a) * rr, 0.15 + rnd() * 0.4, p.z + Math.sin(a) * rr, 0, 2 + rnd() * 2, 0, 0.7 + rnd() * 0.4,
        col, 2.4, 0.1, 0.04, 0, 1.4, SHAPE.PIXEL, rnd() * 0.25);
    }
  });

  on('tower:sold', ({ tower } = {}) => {
    const p = tower?.pos || tower?.slot?.pos;
    if (!p) return;
    setColor(col, towerColor(tower));
    ringP(p.x, p.z, 0.2, 1.2, 0.4, col, 1.0, 0.08);
    const n = scaleCount(10);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      glowP(p.x, 0.4, p.z, Math.cos(a) * 1.6, 0.8 + rnd() * 1.6, Math.sin(a) * 1.6, 0.45, col, 2.2, 0.09, 0.03, -5, 2,
        SHAPE.PIXEL);
    }
  });

  on('enemy:split', ({ parent } = {}) => {
    const p = parent?.pos;
    if (!p) return;
    setColor(col, PALETTE.macro);
    ringP(p.x, p.z, 0.1, 0.95, 0.3, col, 2.2, 0.07);
    glowP(p.x, p.y, p.z, 0, 0, 0, 0.16, col, 3, 1.4, 0.2, 0, 0, SHAPE.GLOW);
    const n = scaleCount(10);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      glowP(p.x, p.y, p.z, Math.cos(a) * 3, 0.6, Math.sin(a) * 3, 0.3, col, 2.4, 0.1, 0.04, -3, 3, SHAPE.PIXEL);
    }
  });

  on('enemy:spawn', ({ enemy } = {}) => {
    const p = enemy?.pos;
    // split children / boss summons hop out of their parent: their spawn point is mid-path, so no port ring
    if (!p || enemy.isBoss || enemy.vis?.hopT > 0) return;
    setColor(col, enemyColor(enemy));
    ringP(p.x, p.z, 0.05, 0.7, 0.3, col, 1.2, 0.05);
  });

  on('boss:spawn', ({ enemy } = {}) => {
    const p = enemy?.pos;
    if (!p) return;
    setColor(col, PALETTE.boss);
    for (let j = 0; j < 3; j++) ringP(p.x, p.z, 0.3, 2.5 + j * 1.5, 0.8, col, 2.2, 0.14, 28, j * 0.18);
    glowP(p.x, (p.y || 0) + 0.6, p.z, 0, 0, 0, 0.4, col, 3, 5, 0.8, 0, 0, SHAPE.GLOW);
  });

  on('wave:start', ({ isBoss } = {}) => {
    const ports = ctx.map?.ports;
    if (!ports || !ports.length) return;
    setColor(col, isBoss ? PALETTE.boss : PALETTE.amber);
    // only the port(s) this wave spawns on (map.livePorts); all of them if the mask is missing or empty
    const live = ctx.map?.livePorts;
    const anyLive = !!live && live.some((v) => v);
    for (let i = 0; i < ports.length; i++) {
      const p = ports[i]?.pos;
      if (!p || (anyLive && !live[i])) continue;
      ringP(p.x, p.z, 0.2, 1.8, 0.7, col, 2.0, 0.1, 16);
      ringP(p.x, p.z, 0.2, 2.6, 0.8, col, 1.3, 0.07, 0, 0.2);
    }
  });

  on('fan:cool', () => {
    const fan = ctx.map?.fan;
    const p = fan?.pos;
    if (!p) return;
    setColor(col, 0x7fd8ff);
    ringP(p.x, p.z, (fan.radius ?? 0.8) * 0.6, (fan.radius ?? 0.8) * 2.6, 0.5, col, 1.8, 0.1, 12);
    const n = scaleCount(14);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const sp = 2.5 + rnd() * 2;
      glowP(p.x, (p.y || 0) + 0.5, p.z, Math.cos(a) * sp, 0.6 + rnd(), Math.sin(a) * sp, 0.45, col, 2.0, 0.1, 0.03, -2, 2.5,
        SHAPE.PIXEL);
    }
  });

  // heat.js puffs the smoke itself; here: a red warning ring and glowing embers while it stays overheated
  on('heat:overheat', ({ spot } = {}) => {
    if (!spot?.pos) return;
    heatSpot = spot;
    smokeTimer = 0;
    setColor(col, PALETTE.danger);
    ringP(spot.pos.x, spot.pos.z, 0.2, (spot.radius ?? 2) * 0.9, 0.6, col, 1.5, 0.1, 18);
  });
  on('heat:cooled', () => { heatSpot = null; });
  on('game:new', () => { heatSpot = null; });

  // ---------------------------------------------------------------------------------------------
  // Frame / sim
  // ---------------------------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    uTime.value = time;
    hitBudget.tokens = Math.min(30, hitBudget.tokens + dt * 60);
    if (heatSpot) {
      const act = ctx.heat?.active;
      if (act && act.overheated === false) heatSpot = null;
    }
    if (heatSpot) {
      smokeTimer -= dt;
      if (smokeTimer <= 0) {
        smokeTimer = 0.12 + rnd() * 0.12;
        const p = heatSpot.pos;
        const r = Math.min(heatSpot.radius ?? 1.5, 1.6) * 0.6;
        setColor(col, rnd() < 0.7 ? PALETTE.amber : PALETTE.danger);
        glowP(p.x + (rnd() - 0.5) * r * 2, 0.25, p.z + (rnd() - 0.5) * r * 2, (rnd() - 0.5) * 0.4, 1 + rnd(),
          (rnd() - 0.5) * 0.4, 0.8 + rnd() * 0.4, col, 2.6, 0.08, 0.02, 0.4, 1.2, SHAPE.PIXEL);
      }
    }
  }

  function flush() {
    for (let i = 0; i < all.length; i++) all[i].flush();
  }

  function reset() {
    // step the clock 1 ms so particles born this very instant (the sim freezes on the fatal leak) die too, while
    // ones spawned right after the reset (RESTORE re-inserting floppies) are born after the kill line and show
    time += 1e-3;
    uTime.value = time;
    uKill.value = time;
    rT.fill(-1e9);
    rStr.fill(null);
    heatSpot = null;
    smokeTimer = 0;
    hitBudget.tokens = 30;
  }

  return {
    burst, text, ring, beam, spark, smoke, update, reset, flush,
    group,
    get time() { return time; },
    stats() {
      return all.map((s) => ({ name: s.mesh.name, instances: s.mesh.geometry.instanceCount, capacity: s.capacity }));
    },
  };
}
