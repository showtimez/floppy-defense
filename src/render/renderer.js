// View: WebGL renderer, lights & mood, camera (fit + attract mode + trauma shake), post chain, quality,
// picking helpers. API in docs/CONTRACTS.md section 5.1.
// adapted from tempesta-fixart/src/game/render.js (quality table, trauma shake with smooth noise, resize)
import * as THREE from 'three';
import { BOARD } from '../config.js';
import { createPost, distortNDC, undistortNDC } from './post.js';
import { createLights, createEnvironmentMap, beginEnvironmentMap, createBackdrop, createDust, FOG_COLOR } from './environment.js';

const DEG = Math.PI / 180;
const PLAY_PITCH = 70 * DEG;  // play camera: steep enough that the board fills the frame with little keystone
const PHONE_PITCH = 58 * DEG; // very wide screens (phones ~2.1:1) are height-limited: a lower pitch fills the width
const PORTRAIT_PITCH = 66 * DEG;
const ATTRACT_REF_PITCH = 64 * DEG; // the menu drift is framed relative to the original (looser) play fit
const FOV = 34;
const TALL = 1.1; // floppy turret tops

// Board + case rim (1 unit by default) that must always be fully visible, plus floppy tops.
// The world module may publish map.viewBounds = { minX, maxX, minZ, maxZ } to frame its own rim; once the map
// exists, the floppy tops are fitted to the real drive-slot extents instead of the board corners.
const FIT_POINTS = [];   // play framing
const FIT_ATTRACT = [];  // reference framing for the menu attract drift (board corners, unchanged look)
function buildFitPoints(b, slots, extras) {
  const hw = BOARD.W / 2, hh = BOARD.H / 2;
  const minX = b?.minX ?? -hw - 1, maxX = b?.maxX ?? hw + 1;
  const minZ = b?.minZ ?? -hh - 1, maxZ = b?.maxZ ?? hh + 1;
  FIT_POINTS.length = 0;
  FIT_ATTRACT.length = 0;
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      FIT_POINTS.push(new THREE.Vector3(x, 0, z));
      FIT_ATTRACT.push(new THREE.Vector3(x, 0, z));
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) FIT_ATTRACT.push(new THREE.Vector3(sx * hw, TALL, sz * hh));
  FIT_ATTRACT.push(new THREE.Vector3(0, TALL, -hh));
  if (slots) {
    for (const x of [slots.minX, slots.maxX]) for (const z of [slots.minZ, slots.maxZ]) FIT_POINTS.push(new THREE.Vector3(x, TALL, z));
  } else {
    for (let i = 4; i < FIT_ATTRACT.length; i++) FIT_POINTS.push(FIT_ATTRACT[i].clone());
  }
  if (extras) for (const p of extras) FIT_POINTS.push(p);
}
buildFitPoints(null, null, null);

// Details on the case rim that the play framing must keep (the front-panel turbo MHz display sits just
// outside the tight board bounds): their near corners become fit points when the world provides them.
const FIT_EXTRAS = ['world:turbo'];
const extraBox = new THREE.Box3();
function extraFitPoints(scene) {
  const out = [];
  for (const name of FIT_EXTRAS) {
    const o = scene.getObjectByName(name);
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    extraBox.setFromObject(o);
    if (extraBox.isEmpty()) continue;
    out.push(new THREE.Vector3(extraBox.min.x, extraBox.max.y, extraBox.max.z));
    out.push(new THREE.Vector3(extraBox.max.x, extraBox.max.y, extraBox.max.z));
  }
  return out.length ? out : null;
}

// Drive-slot extents (+0.6 for the floppy body) or null when the map has no usable slots.
function slotExtents(slots) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < slots.length; i++) {
    const p = slots[i]?.pos;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  if (!(maxX >= minX)) return null;
  return { minX: minX - 0.6, maxX: maxX + 0.6, minZ: minZ - 0.6, maxZ: maxZ + 0.6 };
}

// play pitch by aspect: 70 deg up to ~16:10/16:9, easing to 58 deg on phone-wide screens (no jump on resize)
function playPitch(aspect) {
  if (aspect < 0.8) return PORTRAIT_PITCH;
  const k = Math.min(1, Math.max(0, (aspect - 1.8) / 0.2));
  return PLAY_PITCH + (PHONE_PITCH - PLAY_PITCH) * k * k * (3 - 2 * k);
}

const QUALITY = {
  high: { dpr: 2, dprMobile: 1.5, pixels: 2.6e6, samples: 4, samplesMobile: 0, shadows: true, shadowMap: 2048, shadowMapMobile: 1024, bloomScale: 0.5, bloomLevels: 5, bloomLevelsMobile: 4, hq: true, persist: true },
  low: { dpr: 1, dprMobile: 1, pixels: 1.3e6, samples: 0, samplesMobile: 0, shadows: false, shadowMap: 512, shadowMapMobile: 512, bloomScale: 0.25, bloomLevels: 3, bloomLevelsMobile: 3, hq: false, persist: false },
};

let calmK = 1;
try {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) calmK = 0.35;
} catch { /* ignore */ }
const wob = (t, s) => Math.sin(t * 31.7 + s) * 0.5 + Math.sin(t * 17.3 + s * 2.1) * 0.3 + Math.sin(t * 53.1 + s * 0.7) * 0.2;

function detectMobile() {
  try {
    if (globalThis.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch { /* ignore */ }
  const ua = (globalThis.navigator && navigator.userAgent) || '';
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua);
}

// critically damped spring toward a goal (Unity-style SmoothDamp), per scalar
function damp(cur, goal, vel, i, smooth, dt) {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - goal;
  const temp = (vel[i] + omega * change) * dt;
  vel[i] = (vel[i] - omega * temp) * exp;
  return goal + (change + temp) * exp;
}

export function createRenderer(ctx, container) {
  const params = ctx.params || new URLSearchParams(location.search);
  const settings = ctx.settings || {};
  const events = ctx.events;
  const isMobile = detectMobile();

  // ---------------------------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------------------------
  // MSAA lives on the HDR scene target (post chain), so the default framebuffer needs none.
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  // Shader status checks force a synchronous wait on every program (seconds on a cold D3D11 cache) and
  // print driver warnings: only in dev.
  renderer.debug.checkShaderErrors = import.meta.env?.DEV === true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const TONES = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
  renderer.toneMapping = TONES[params.get('tone')] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = Number(params.get('exposure')) || 1.0;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(FOG_COLOR, 1);
  const canvas = renderer.domElement;
  canvas.setAttribute('tabindex', '-1');
  canvas.style.touchAction = 'none';
  container.prepend(canvas);

  // ---------------------------------------------------------------------------------------------
  // Scene, lights, mood
  // ---------------------------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, 30, 90);
  const lights = createLights(scene);
  const backdrop = createBackdrop(scene);
  const dust = createDust(scene, isMobile ? 80 : 140);
  let envRT = null;
  function setEnv(rt) {
    envRT?.dispose();
    envRT = rt;
    scene.environment = rt ? rt.texture : null;
    scene.environmentIntensity = 0.55;
  }
  function buildEnv() {
    try {
      setEnv(createEnvironmentMap(renderer));
    } catch (err) {
      console.warn('[render] environment map failed', err);
    }
  }
  // built by the shader warm-up after the BIOS screen has painted (the PMREM pass compiles a heavy shader)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 260);
  camera.layers.set(0);
  scene.add(camera);

  // ---------------------------------------------------------------------------------------------
  // Post chain
  // ---------------------------------------------------------------------------------------------
  let post = null;
  try {
    post = createPost(renderer, { mobile: isMobile });
  } catch (err) {
    console.error('[render] post chain failed, rendering direct', err);
  }
  const forcedQuality = params.get('quality');
  let crt = settings.crt !== false;
  if (params.has('crt')) crt = params.get('crt') !== '0';
  post?.setCRT(crt);

  const view = {
    renderer,
    scene,
    camera,
    isMobile,
    quality: 'high',
    lights,
    post,
    fps: 60,
    insets: { top: 40, right: 8, bottom: 24, left: 8 },
    ready: false,   // true once every shader program is compiled (see warmShaders)
    warmupMs: 0,
  };

  // ---------------------------------------------------------------------------------------------
  // Size / quality
  // ---------------------------------------------------------------------------------------------
  let cssW = 1, cssH = 1, dprNow = 1;
  let autoQuality = false;
  let dprCap = Infinity; // auto quality step 1 lowers the pixel ratio before dropping features
  const dbSize = new THREE.Vector2();

  function applyQualityConfig() {
    const q = QUALITY[view.quality];
    dust.points.visible = q.hq;
    lights.key.castShadow = q.shadows;
    renderer.shadowMap.enabled = q.shadows;
    const n = isMobile ? q.shadowMapMobile : q.shadowMap;
    if (lights.key.shadow.mapSize.x !== n) {
      lights.key.shadow.mapSize.set(n, n);
      lights.key.shadow.map?.dispose();
      lights.key.shadow.map = null;
    }
    post?.configure({
      samples: isMobile ? q.samplesMobile : q.samples,
      bloomScale: q.bloomScale,
      bloomLevels: isMobile ? q.bloomLevelsMobile : q.bloomLevels,
      hq: q.hq,
      persist: q.persist,
    });
  }

  function resize() {
    const w = Math.max(1, container.clientWidth || innerWidth);
    const h = Math.max(1, container.clientHeight || innerHeight);
    const q = QUALITY[view.quality];
    // pixel budget: big fullscreen / retina windows must not render 4K internally on an iGPU
    const budget = Math.sqrt(q.pixels / (w * h));
    const dpr = Math.max(0.6, Math.min(globalThis.devicePixelRatio || 1, isMobile ? q.dprMobile : q.dpr, dprCap, budget));
    const changed = w !== cssW || h !== cssH || dpr !== dprNow;
    cssW = w; cssH = h; dprNow = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(dbSize);
    post?.setSize(dbSize.x, dbSize.y);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeFit();
    if (changed && camMode !== 'attract') snapCamera();
  }
  view.resize = resize;

  view.setQuality = (q) => {
    if (forcedQuality === 'low' || forcedQuality === 'high') q = forcedQuality;
    autoQuality = q !== 'low' && q !== 'high';
    const next = autoQuality ? 'high' : q;
    dprCap = Infinity;
    lowSeconds = 0;
    pendingLow = false;
    if (next === view.quality && view._qualityApplied) {
      resize();
      return;
    }
    view.quality = next;
    view._qualityApplied = true;
    applyQualityConfig();
    resize();
  };

  view.setCRT = (on) => {
    crt = !!on;
    post?.setCRT(crt);
    computeFit();
    if (camMode !== 'attract') snapCamera();
  };

  // auto quality: drop to low if the average fps stays under 40 for 3 consecutive seconds. Step 1 (pixel ratio)
  // applies at once (no recompiles). Step 2 (features: shadows, bloom, MSAA) never lands mid-wave: it waits for
  // the next calm phase, so even a cache miss can't freeze a fight.
  let fpsAcc = 0, fpsFrames = 0, lowSeconds = 0, fpsSeconds = 0;
  let pendingLow = false;
  function applyLow(reason) {
    pendingLow = false;
    if (view.quality === 'low') return;
    console.info(`[render] auto quality: ${reason} -> low`);
    view.quality = 'low';
    applyQualityConfig();
    resize();
  }
  let monLast = 0;
  function monitor() {
    // wall clock, not the frame dt (the loop clamps that to 0.1 s, which hides very slow frames)
    const now = performance.now();
    const rdt = monLast ? (now - monLast) / 1000 : 0;
    monLast = now;
    if (document.hidden || rdt <= 0 || rdt > 1) return; // tab switch / debugger pause: not a perf signal
    fpsAcc += rdt;
    fpsFrames++;
    if (fpsAcc < 1) return;
    view.fps = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
    fpsSeconds++;
    if (!autoQuality || view.quality === 'low' || pendingLow || fpsSeconds < 4) return;
    lowSeconds = view.fps < 40 ? lowSeconds + 1 : 0;
    if (lowSeconds < 3) return;
    lowSeconds = 0;
    if (dprNow > 1.01 && dprCap > 1) {
      console.info(`[render] auto quality: ${view.fps.toFixed(1)} fps -> pixel ratio 1`);
      dprCap = 1;
      resize();
      return;
    }
    if (ctx.game?.phase === 'wave') {
      pendingLow = true;
      console.info(`[render] auto quality: ${view.fps.toFixed(1)} fps -> low (deferred)`);
      return;
    }
    applyLow(`${view.fps.toFixed(1)} fps`);
  }

  // ---------------------------------------------------------------------------------------------
  // Camera: fit, attract drift, transitions, shake
  // ---------------------------------------------------------------------------------------------
  const fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 260);
  const tmpV = new THREE.Vector3();
  const tmp2 = { x: 0, y: 0 };
  const playPose = { tx: 0, tz: 0, yaw: 0, pitch: PLAY_PITCH, dist: 30 };
  const pose = { tx: 0, tz: 0, yaw: 0, pitch: PLAY_PITCH, dist: 30 };
  const goal = { tx: 0, tz: 0, yaw: 0, pitch: PLAY_PITCH, dist: 30 };
  const fitTmp = { tx: 0, tz: 0, yaw: 0, pitch: PLAY_PITCH, dist: 30 };
  let attractDist = 30; // base distance of the menu drift (the original, looser fit)
  const vel = new Float32Array(5);
  let camMode = 'attract';
  let smoothTime = 0.6;
  let attractT = 0;
  let firstFrame = true;

  function placeCamera(cam, p) {
    const cp = Math.cos(p.pitch);
    cam.position.set(
      p.tx + Math.sin(p.yaw) * cp * p.dist,
      Math.sin(p.pitch) * p.dist,
      p.tz + Math.cos(p.yaw) * cp * p.dist,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(p.tx, 0, p.tz);
    cam.updateMatrixWorld(true);
  }

  // display-space bounds (NDC, after CRT bending) of the fit points for a pose
  const bounds = { x0: 0, x1: 0, y0: 0, y1: 0, ok: true };
  function measure(p, aspect, points) {
    fitCam.aspect = aspect;
    fitCam.updateProjectionMatrix();
    placeCamera(fitCam, p);
    const curv = crt && post ? post.currentCurv() : null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ok = true;
    for (let i = 0; i < points.length; i++) {
      tmpV.copy(points[i]).project(fitCam);
      if (tmpV.z > 1 || tmpV.z < -1) ok = false;
      let x = tmpV.x, y = tmpV.y;
      if (curv) { undistortNDC(x, y, curv, tmp2); x = tmp2.x; y = tmp2.y; }
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    bounds.x0 = x0; bounds.x1 = x1; bounds.y0 = y0; bounds.y1 = y1; bounds.ok = ok;
    return bounds;
  }

  // smallest camera distance (and re-centred look-at) that puts every point inside the safe area
  const fitLo = { x: 0, y: 0 }, fitHi = { x: 0, y: 0 };
  function fitPose(p, points, aspect) {
    const lo = fitLo, hi = fitHi;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw); // ground forward (toward the far edge)
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);  // ground right
    for (let outer = 0; outer < 5; outer++) {
      // bisection on distance: smallest distance where every fit point lands inside the safe area
      let a = 6, b = 400;
      for (let i = 0; i < 30; i++) {
        p.dist = (a + b) / 2;
        const m = measure(p, aspect, points);
        const fits = m.ok && m.x0 >= lo.x && m.x1 <= hi.x && m.y0 >= lo.y && m.y1 <= hi.y;
        if (fits) b = p.dist; else a = p.dist;
      }
      p.dist = b;
      // re-centre inside the safe band (shift the look-at point on the ground)
      const m = measure(p, aspect, points);
      const offY = (m.y0 + m.y1) / 2 - (lo.y + hi.y) / 2;
      const offX = (m.x0 + m.x1) / 2 - (lo.x + hi.x) / 2;
      const halfH = p.dist * Math.tan((FOV * DEG) / 2);
      const kf = (offY * halfH) / Math.sin(p.pitch);
      const kr = offX * halfH * aspect;
      p.tx += fx * kf + rx * kr;
      p.tz += fz * kf + rz * kr;
    }
    return p;
  }

  function computeFit() {
    const aspect = cssW / cssH;
    const ins = view.insets;
    fitLo.x = -1 + (2 * ins.left) / cssW; fitLo.y = -1 + (2 * ins.bottom) / cssH;
    fitHi.x = 1 - (2 * ins.right) / cssW; fitHi.y = 1 - (2 * ins.top) / cssH;
    // tall portrait screens: turn the board 90 degrees (ports at the top, CPU toward the bottom)
    const yaw = aspect < 0.8 ? Math.PI / 2 : 0;
    Object.assign(playPose, { tx: 0, tz: 0.4, yaw, pitch: playPitch(aspect), dist: 30 });
    fitPose(playPose, FIT_POINTS, aspect);
    // the menu drift keeps its original framing (rim + floppy tops at the board corners, 64 deg)
    Object.assign(fitTmp, { tx: 0, tz: 0.4, yaw, pitch: aspect < 0.8 ? PORTRAIT_PITCH : ATTRACT_REF_PITCH, dist: 30 });
    attractDist = fitPose(fitTmp, FIT_ATTRACT, aspect).dist;
  }

  function snapCamera() {
    updateGoal(0);
    Object.assign(pose, goal);
    vel.fill(0);
  }

  function updateGoal(dt) {
    if (camMode === 'attract') {
      attractT += dt * calmK;
      const t = attractT;
      goal.yaw = playPose.yaw + 0.62 * Math.sin(t * 0.055) + 0.12 * Math.sin(t * 0.13 + 1.3);
      goal.pitch = (50 + 7 * Math.sin(t * 0.083 + 0.6)) * DEG;
      goal.dist = attractDist * (0.74 + 0.07 * Math.sin(t * 0.047 + 2.1));
      goal.tx = 3.2 * Math.sin(t * 0.041 + 0.4);
      goal.tz = 1.6 * Math.sin(t * 0.067 + 1.7) - 0.6;
    } else if (camMode === 'play') {
      Object.assign(goal, playPose);
    } // 'hold': keep the last goal
  }

  function setMode(mode) {
    if (mode === camMode) return;
    camMode = mode;
    smoothTime = mode === 'play' ? 0.55 : 1.4;
  }

  // shake (trauma), flash, glitch, degauss, power-on
  let trauma = 0, traumaDecay = 1, shakeTime = 0;
  let flashAmt = 0;
  const flashColor = new THREE.Color(1, 1, 1);
  let glitchAmt = 0, glitchTime = 0, glitchDur = 0.3, glitchHold = 0;
  let degauss = 0;
  let power = 1;
  let realTime = 0;
  let kick = 0;
  let pauseAmt = 0;
  const DANGER = new THREE.Color(0xff1a10);
  const GLITCH_WAVE_MAX = 0.45;

  view.shake = (intensity = 0.3, duration = 0.25) => {
    const i = Math.max(0, intensity);
    trauma = Math.min(1.3, Math.max(trauma, i) + i * 0.25);
    traumaDecay = trauma / Math.max(0.06, duration * 1.6);
  };
  view.flash = (color = 0xffffff, strength = 0.5) => {
    if (strength >= flashAmt * 0.6) flashColor.set(color);
    flashAmt = Math.min(1.2, Math.max(flashAmt, strength));
  };
  view.glitch = (strength = 1, duration = 0.3) => {
    glitchAmt = Math.max(glitchAmt * (glitchTime > 0 ? 1 : 0), strength);
    glitchTime = Math.max(glitchTime, duration);
    glitchDur = Math.max(0.05, glitchTime);
  };
  view.degauss = (strength = 1) => { degauss = Math.max(degauss, strength); };
  view.kick = (amount = 0.04) => { kick = Math.min(0.15, Math.max(kick, amount)); };
  view.powerOn = () => { power = 0; };
  view.setInsets = (ins = {}) => {
    Object.assign(view.insets, ins);
    computeFit();
    if (camMode !== 'attract') snapCamera();
  };

  function updateCamera(dt) {
    updateGoal(dt);
    if (firstFrame) {
      Object.assign(pose, goal);
      firstFrame = false;
    } else {
      const st = smoothTime;
      pose.tx = damp(pose.tx, goal.tx, vel, 0, st, dt);
      pose.tz = damp(pose.tz, goal.tz, vel, 1, st, dt);
      pose.yaw = damp(pose.yaw, goal.yaw, vel, 2, st, dt);
      pose.pitch = damp(pose.pitch, goal.pitch, vel, 3, st, dt);
      pose.dist = damp(pose.dist, goal.dist, vel, 4, st, dt);
    }
    kick *= Math.exp(-dt * 7);
    if (kick > 1e-4) {
      const d0 = pose.dist;
      pose.dist = d0 * (1 - kick);
      placeCamera(camera, pose);
      pose.dist = d0;
    } else {
      placeCamera(camera, pose);
    }
    if (trauma > 0) {
      shakeTime += dt;
      trauma = Math.max(0, trauma - traumaDecay * dt);
      const s = trauma * trauma * calmK;
      const t = shakeTime;
      camera.translateX(wob(t, 0) * s * 0.45);
      camera.translateY(wob(t, 3.3) * s * 0.45);
      camera.rotateZ(wob(t, 7.1) * s * 0.025);
      camera.updateMatrixWorld(true);
    }
    // fog / floor fade follow the current framing
    const d = pose.dist;
    scene.fog.near = d * 0.95;
    scene.fog.far = d * 2.6;
    backdrop.setFog(d * 0.9, d * 2.2);
  }

  function updateEffects(dt) {
    flashAmt *= Math.exp(-dt * 6.5);
    if (flashAmt < 0.002) flashAmt = 0;
    let g = 0;
    if (glitchTime > 0) {
      glitchTime = Math.max(0, glitchTime - dt);
      const env = Math.min(1, glitchTime / (glitchDur * 0.35));
      // stutter: the glitch flickers in and out like a bad signal
      const on = Math.sin(realTime * 61.3) + Math.sin(realTime * 23.9) > -0.6 ? 1 : 0.25;
      g = glitchAmt * env * on;
      if (glitchTime === 0) glitchAmt = 0;
    }
    g = Math.max(g, glitchHold);
    degauss = Math.max(0, degauss - dt * 1.1);
    power = Math.min(1, power + dt * 1.6);
    const phase = ctx.game?.phase;
    pauseAmt += ((phase === 'paused' ? 1 : 0) - pauseAmt) * (1 - Math.exp(-dt * 6));
    // critical CPU (< 30 %): red heartbeat at the screen edges + rare signal drop-outs
    let pulse = 0;
    const cpu = ctx.game?.cpu;
    if ((phase === 'prep' || phase === 'wave') && cpu != null && cpu < 30) {
      const danger = 1 - Math.max(0, cpu) / 30;
      const beat = Math.max(0, Math.sin(realTime * 5.2)) ** 6;
      pulse = (0.05 + 0.16 * beat) * (0.4 + 0.6 * danger);
      if (Math.random() < dt * (0.05 + danger * 0.15)) view.glitch(0.18 + danger * 0.25, 0.08);
    }
    // mid-fight the signal may stutter but the playfield must stay readable; game over / BSOD get the full tear
    if (phase === 'wave' && g > GLITCH_WAVE_MAX) g = GLITCH_WAVE_MAX;
    if (post) {
      const U = post.uniforms;
      const total = flashAmt + pulse;
      U.uFlash.value = total;
      if (total > 0) U.uFlashColor.value.copy(DANGER).lerp(flashColor, flashAmt / total);
      post.state.sat = 1.06 - 0.8 * pauseAmt;
      post.state.dim = 1 - 0.35 * pauseAmt;
      U.uGlitch.value = g;
      U.uDegauss.value = degauss * degauss;
      U.uPower.value = power;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Projection helpers (mirror the CRT curvature so UI anchors and clicks match the bent image)
  // ---------------------------------------------------------------------------------------------
  const projV = new THREE.Vector3();
  view.worldToScreen = (v, out) => {
    const o = out || { x: 0, y: 0, visible: false };
    projV.set(v.x, v.y, v.z).project(camera);
    let x = projV.x, y = projV.y;
    if (crt && post) {
      undistortNDC(x, y, post.currentCurv(), tmp2);
      x = tmp2.x; y = tmp2.y;
    }
    o.x = ((x + 1) / 2) * cssW;
    o.y = ((1 - y) / 2) * cssH;
    o.visible = projV.z > -1 && projV.z < 1 && x >= -1.02 && x <= 1.02 && y >= -1.02 && y <= 1.02;
    return o;
  };

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll();
  const ndc = new THREE.Vector2();
  view.raycasterFromClient = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    let x = ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    let y = -(((clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
    if (crt && post) {
      distortNDC(x, y, post.currentCurv(), tmp2);
      x = tmp2.x; y = tmp2.y;
    }
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  };

  // Opt-in helper for other modules: view.setShadow(object3d, cast, receive)
  view.setShadow = (obj, cast = true, receive = false) => {
    obj?.traverse?.((o) => {
      if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------
  let lost = false;
  let boundsSeen = null;
  let slotsSeen = null, slotsLen = -1, slotExt = null;
  // The map is created after the renderer: pick up its rim bounds and slot extents lazily (and again if
  // the world module ever replaces them).
  function refreshFit() {
    const vb = ctx.map?.viewBounds;
    const slots = ctx.map?.slots;
    const vbNew = !!vb && typeof vb === 'object' && vb !== boundsSeen;
    const slNew = Array.isArray(slots) && slots.length > 0 && (slots !== slotsSeen || slots.length !== slotsLen);
    if (!vbNew && !slNew) return;
    if (vbNew) boundsSeen = vb;
    if (slNew) { slotsSeen = slots; slotsLen = slots.length; slotExt = slotExtents(slots); }
    let extras = null;
    try { extras = extraFitPoints(scene); } catch { extras = null; }
    buildFitPoints(boundsSeen, slotExt, extras);
    computeFit();
    if (camMode !== 'attract') snapCamera();
  }

  // -------------------------------------------------------------------------------------------
  // Shader warm-up. The first render call only schedules it, so the BIOS DOM paints on the very first
  // frame instead of waiting behind ~50 synchronous program links. Then, behind the opaque POST screen:
  // environment map -> compile every scene program for BOTH quality variants (shadows on/off change the
  // defines of every material) against the HDR scene target the post chain really renders into -> every
  // post program (all CRT/HQ composites) -> one real frame (shadow-depth programs, texture uploads).
  // With KHR_parallel_shader_compile the compiles run off the main thread. Rendering is gated on view.ready.
  // -------------------------------------------------------------------------------------------
  let warmStarted = false;
  let warmGen = 0;
  const parallelCompile = !!renderer.extensions?.has?.('KHR_parallel_shader_compile');
  // resolves once the driver reports every program linked (KHR_parallel_shader_compile), polling off-frame
  function programsReady(maxMs) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const list = renderer.info.programs || [];
        let ok = true;
        for (let i = 0; i < list.length && ok; i++) if (list[i].isReady && !list[i].isReady()) ok = false;
        if (ok || lost || performance.now() - t0 > maxMs) resolve();
        else setTimeout(check, 16);
      };
      check();
    });
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // Wait until the first frame (the BIOS POST text) has actually reached the screen: GPU work queued
  // earlier would hold back its presentation (the GPU process compiles in order). FCP is reported after
  // presentation; fall back to a short timeout where paint timing is unavailable.
  function afterFirstPaint(maxMs = 500) {
    return new Promise((resolve) => {
      let done = false, obs = null;
      const go = () => {
        if (done) return;
        done = true;
        try { obs?.disconnect(); } catch { /* ignore */ }
        setTimeout(resolve, 0);
      };
      try {
        if (performance.getEntriesByName?.('first-contentful-paint')?.length) { go(); return; }
        obs = new PerformanceObserver((list) => {
          if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) go();
        });
        obs.observe({ type: 'paint', buffered: true });
      } catch { /* no paint timing */ }
      setTimeout(go, maxMs);
    });
  }
  function compileVariant(shadows) {
    const sm = renderer.shadowMap.enabled, cs = lights.key.castShadow;
    const prevRT = renderer.getRenderTarget();
    // three's compile only collects visible lights (and older versions only visible meshes): show hidden
    // meshes for the synchronous part (hidden lights stay hidden, they would compile the wrong light count)
    const shown = [];
    scene.traverse((o) => { if (!o.visible && !o.isLight) { o.visible = true; shown.push(o); } });
    try {
      renderer.shadowMap.enabled = shadows;
      lights.key.castShadow = shadows;
      // program keys depend on the target (tone mapping / output colour space): use the real one
      renderer.setRenderTarget(post?.sceneTarget ?? null);
      renderer.compile(scene, camera);
    } finally {
      for (let i = 0; i < shown.length; i++) shown[i].visible = false;
      renderer.setRenderTarget(prevRT);
      renderer.shadowMap.enabled = sm;
      lights.key.castShadow = cs;
    }
  }
  // Draw the whole scene offscreen once per quality variant with every hidden object shown and culling off,
  // so later first appearances (first floppy, first virus, range disc, a quality drop) don't stall on
  // per-program setup. Everything is restored before the next real frame.
  function warmFrames(bothVariants) {
    const shown = [], culled = [];
    scene.traverse((o) => {
      if (o.isLight) return;
      if (!o.visible) { o.visible = true; shown.push(o); }
      if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.frustumCulled = false; culled.push(o); }
    });
    const sm = renderer.shadowMap.enabled, cs = lights.key.castShadow;
    const prevRT = renderer.getRenderTarget();
    const hq = QUALITY[view.quality].shadows;
    try {
      for (const shadows of bothVariants ? [!hq, hq] : [hq]) {
        renderer.shadowMap.enabled = shadows;
        lights.key.castShadow = shadows;
        renderer.setRenderTarget(post?.sceneTarget ?? null);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
      }
    } finally {
      for (let i = 0; i < shown.length; i++) shown[i].visible = false;
      for (let i = 0; i < culled.length; i++) culled[i].frustumCulled = true;
      renderer.setRenderTarget(prevRT);
      renderer.shadowMap.enabled = sm;
      lights.key.castShadow = cs;
    }
  }

  async function warmShaders() {
    const gen = ++warmGen;
    const t0 = performance.now();
    const safety = setTimeout(() => {
      if (view.ready || gen !== warmGen) return;
      console.warn('[render] shader warm-up is taking too long, rendering anyway');
      view.ready = true;
    }, 8000);
    const st = view.warmupStages = {};
    const mark = (k, t) => { st[k] = Math.round(performance.now() - t); return performance.now(); };
    let env = null;
    try {
      let t = performance.now();
      // environment map: its programs compile with the rest; the scene compiles against a same-shaped
      // placeholder so the real map swaps in without a recompile (sync fallback if that is unavailable)
      if (!envRT) {
        try { env = beginEnvironmentMap(renderer); } catch (err) { env = null; }
        if (env?.placeholder) {
          scene.environment = env.placeholder;
          scene.environmentIntensity = 0.55;
        } else {
          env = null;
          buildEnv();
        }
      }
      refreshFit();
      updateCamera(0);
      // issue every compile up front (current quality first), then let the driver link them in parallel.
      // Without async compile (software GL, some mobiles) each extra program is paid synchronously at boot,
      // so only the current variant is prepared there (a later auto drop lands in a calm phase anyway).
      const hq = QUALITY[view.quality].shadows;
      compileVariant(hq);
      if (parallelCompile) compileVariant(!hq);
      post?.warm?.();
      t = mark('issue', t);
      if (parallelCompile) await programsReady(7000);
      else await nextFrame(); // no async status: the warm frame below waits for the links (still behind the BIOS)
      t = mark('link', t);
      if (env) {
        const e = env;
        env = null;
        try { setEnv(e.finish()); } catch (err) { console.warn('[render] environment map failed', err); scene.environment = null; }
      }
      t = mark('env', t);
      // real frames behind the BIOS screen: shadow-depth programs, each program's first-use uniform queries
      // (both variants, hidden/off-screen objects included) and texture uploads, then one normal frame
      if (!lost && gen === warmGen) {
        warmFrames(parallelCompile);
        renderer.info.reset();
        if (post) post.render(scene, camera, 1 / 60, realTime, FOG_COLOR);
        else { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); }
        post?.resetHistory();
      }
      mark('frame', t);
    } catch (err) {
      console.warn('[render] shader warm-up failed (shaders will compile on first use)', err);
    } finally {
      if (env) { try { setEnv(env.finish()); } catch (err) { scene.environment = null; } }
      clearTimeout(safety);
      if (gen === warmGen) {
        view.warmupMs = Math.round(performance.now() - t0);
        view.ready = true;
      }
    }
  }

  view.render = (dt = 1 / 60, t = 0) => {
    if (lost) return;
    if (!view.ready) {
      if (!warmStarted) {
        warmStarted = true;
        nextFrame().then(() => afterFirstPaint()).then(() => warmShaders());
      }
      return;
    }
    refreshFit();
    dt = Math.min(Math.max(dt, 0), 0.1);
    realTime += dt;
    monitor();
    updateCamera(dt);
    updateEffects(dt);
    if (dust.points.visible) dust.update(realTime, 70 * dprNow * (cssH / 600));
    try { ctx.fx?.flush?.(); } catch { /* fx optional */ }
    renderer.info.reset();
    if (post) {
      post.render(scene, camera, dt, realTime, FOG_COLOR);
    } else {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
    }
  };

  view.stats = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    quality: view.quality,
    dpr: dprNow,
    size: [cssW, cssH],
    fps: Math.round(view.fps),
    crt,
    halfFloat: post?.halfFloat ?? false,
    ready: view.ready,
    warmupMs: view.warmupMs,
    pendingLow,
  });
  view.getCameraMode = () => camMode;

  // ---------------------------------------------------------------------------------------------
  // Context loss
  // ---------------------------------------------------------------------------------------------
  const lostEl = document.createElement('div');
  lostEl.className = 'gl-lost';
  lostEl.textContent = 'VGA ADAPTER NOT RESPONDING - RESTORING DISPLAY...';
  Object.assign(lostEl.style, {
    position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
    background: '#000', color: '#39ff6a', font: '16px var(--font-dos, monospace)', zIndex: '60', textAlign: 'center',
    padding: '24px',
  });
  container.appendChild(lostEl);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    lostEl.style.display = 'flex';
    setTimeout(() => {
      if (!lost) return;
      try { renderer.forceContextRestore(); } catch { /* browser will restore on its own, or not */ }
    }, 2000);
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    lostEl.style.display = 'none';
    envRT = null; // its GPU objects died with the old context: rebuild without deleting stale handles
    buildEnv();
    post?.resetHistory();
    view._qualityApplied = false;
    applyQualityConfig();
    resize();
    // every program is gone with the old context: warm them up again before the next frame
    view.ready = false;
    warmStarted = false;
  }, false);

  // ---------------------------------------------------------------------------------------------
  // Resize triggers
  // ---------------------------------------------------------------------------------------------
  let resizeQueued = false;
  const queueResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  };
  addEventListener('resize', queueResize);
  document.addEventListener('fullscreenchange', queueResize);
  document.addEventListener('webkitfullscreenchange', queueResize);
  addEventListener('orientationchange', () => { queueResize(); setTimeout(resize, 300); });
  try { new ResizeObserver(queueResize).observe(container); } catch { /* old browsers: window resize only */ }
  try { globalThis.visualViewport?.addEventListener('resize', queueResize); } catch { /* ignore */ }

  // ---------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------
  const on = (name, fn) => events?.on?.(name, fn);
  const modeFor = (phase) => {
    if (phase === 'prep' || phase === 'wave' || phase === 'paused') return 'play';
    if (phase === 'gameover') return 'hold';
    return 'attract';
  };
  on('phase:change', ({ from, to } = {}) => {
    setMode(modeFor(to));
    if (to !== 'gameover') glitchHold = 0;
    // the opaque BSOD / victory screens stop view.render (main.js), so a long crash glitch could be frozen
    // mid-way and resume over the restored / retried board: drop it when leaving them
    if (from === 'gameover' || from === 'victory') { glitchTime = 0; glitchAmt = 0; }
    if (from === 'boot' && to === 'menu') view.powerOn();
    // a feature drop requested mid-wave lands at the next calm moment (programs are precompiled anyway)
    if (pendingLow && to !== 'wave') applyLow('deferred drop');
  });
  on('game:new', () => { view.degauss(1); });
  on('wave:start', ({ isBoss } = {}) => { view.glitch(isBoss ? 0.45 : 0.18, isBoss ? 0.4 : 0.22); });
  on('cpu:damage', ({ amount = 5, cpu } = {}) => {
    const k = Math.min(1, amount / 25);
    const low = cpu != null && cpu < 30 ? 0.25 : 0;
    view.shake(0.3 + k * 0.55, 0.28 + k * 0.35);
    view.flash(0xff2a1a, 0.25 + k * 0.45);
    view.glitch(0.25 + k * 0.55 + low, 0.14 + k * 0.26);
    view.kick(0.015 + k * 0.03);
  });
  on('boss:spawn', () => {
    view.glitch(0.85, 0.6);
    view.shake(0.4, 0.5);
    view.flash(0xff1744, 0.25);
  });
  on('boss:killed', () => {
    view.flash(0xffffff, 0.85);
    view.shake(0.9, 0.7);
    view.kick(0.07);
    view.glitch(0.5, 0.25);
  });
  on('gameover', () => {
    view.glitch(1.8, 1.3);
    view.shake(1.0, 0.9);
    view.flash(0x2040ff, 0.6);
    glitchHold = 0.08;
  });
  on('victory', () => { view.flash(0xffffff, 0.6); view.degauss(0.7); });
  on('settings:change', ({ key, value } = {}) => {
    if (key === 'crt') view.setCRT(value);
    if (key === 'quality') view.setQuality(value);
  });

  // initial configuration
  view.setQuality(forcedQuality || settings.quality || 'auto'); // also sizes everything (resize)
  setMode(modeFor(ctx.game?.phase || 'boot'));
  return view;
}
