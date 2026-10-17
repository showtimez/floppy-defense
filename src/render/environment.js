// Mood: lights, a procedural reflection environment (PMREM of a tiny "case interior" scene) and the dark
// perforated-steel case floor that fills everything around the motherboard. Everything is generated in code.
import * as THREE from 'three';
import { BOARD } from '../config.js';

export const FOG_COLOR = 0x05080a;
export const FLOOR_Y = -1.2;

// Key light direction (from the light toward the board): upper-left-front, warm.
export const KEY_DIR = new THREE.Vector3(-0.42, 1, 0.5).normalize();

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xc4d6ff, 0x2c2418, 0.75);
  const key = new THREE.DirectionalLight(0xffe4c2, 2.35);
  key.position.copy(KEY_DIR).multiplyScalar(30);
  key.target.position.set(0, 0, 0);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 1.1);
  rim.position.set(9, 7, -16);
  rim.target.position.set(0, 0, 0);
  scene.add(hemi, key, key.target, rim, rim.target);

  // tight orthographic shadow frustum around the board volume (computed in light space)
  const s = key.shadow;
  s.bias = -0.00035;
  s.normalBias = 0.03;
  s.radius = 3.5;
  s.blurSamples = 8;
  fitShadowCamera(key);
  return { hemi, key, rim };
}

export function fitShadowCamera(light) {
  const cam = light.shadow.camera;
  const hw = BOARD.W / 2 + 1.5;
  const hh = BOARD.H / 2 + 1.5;
  const m = new THREE.Matrix4().lookAt(light.position, light.target.position, new THREE.Vector3(0, 1, 0));
  const inv = new THREE.Matrix4().makeTranslation(light.position.x, light.position.y, light.position.z).multiply(m).invert();
  const v = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const x of [-hw, hw]) for (const y of [-0.3, 2.6]) for (const z of [-hh, hh]) {
    v.set(x, y, z).applyMatrix4(inv);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
  }
  cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
  cam.near = Math.max(0.1, -z1 - 1);
  cam.far = -z0 + 1;
  cam.updateProjectionMatrix();
}

// A dark box "case interior" with a warm soft-box, a cool back strip and a faint phosphor bounce: gives
// metals (heatsink, shutters, connectors) and glossy plastics believable reflections.
export function createEnvironmentMap(renderer) {
  return beginEnvironmentMap(renderer).finish();
}

// Two-step PMREM, so its heavy GGX convolution shader (about a second of synchronous driver compile on a cold
// D3D11 cache) compiles in parallel with every other program instead of freezing the boot screen:
// begin() creates the generator's internal targets/materials and only *issues* their compiles; it also
// exposes a placeholder texture with the exact shape of the final map (cube-UV, same size), so the scene
// materials can be compiled against it already. finish() renders the map (fast once the programs are linked).
// Uses PMREMGenerator internals of three r186; anything unexpected falls back to the plain synchronous path.
const PMREM_SIZE = 256;
const FLAT_CAM = new THREE.OrthographicCamera();
export function beginEnvironmentMap(renderer) {
  const { scene: s, dispose } = buildEnvScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  let placeholder = null;
  try {
    if (typeof pmrem._setSize === 'function' && typeof pmrem._allocateTargets === 'function') {
      pmrem._setSize(PMREM_SIZE);
      placeholder = pmrem._allocateTargets(); // also builds the ping-pong target + blur/GGX materials
      const ping = pmrem._pingPongRenderTarget;
      const geo = pmrem._lodMeshes?.[0]?.geometry;
      const mats = [pmrem._ggxMaterial, pmrem._blurMaterial].filter(Boolean);
      if (!placeholder?.texture || !ping || !geo || !mats.length) throw new Error('unexpected PMREMGenerator internals');
      const g = new THREE.Group();
      for (const m of mats) {
        const mesh = new THREE.Mesh(geo, m);
        mesh.frustumCulled = false;
        g.add(mesh);
      }
      const prev = renderer.getRenderTarget();
      try {
        // same target kind as the real passes (offscreen half-float) so the program keys match
        renderer.setRenderTarget(ping);
        renderer.compile(g, FLAT_CAM);
        renderer.compile(s, FLAT_CAM);
      } finally {
        renderer.setRenderTarget(prev);
      }
    }
  } catch (err) {
    placeholder?.dispose();
    placeholder = null;
  }
  let done = false;
  return {
    placeholder: placeholder ? placeholder.texture : null,
    finish() {
      if (done) return null;
      done = true;
      try {
        return pmrem.fromScene(s, 0.035, 0.1, 100, { size: PMREM_SIZE });
      } finally {
        pmrem.dispose();
        dispose();
        placeholder?.dispose();
      }
    },
  };
}

function buildEnvScene() {
  const s = new THREE.Scene();
  const geos = [];
  const mats = [];
  const room = new THREE.BoxGeometry(24, 12, 24);
  const roomMat = new THREE.MeshBasicMaterial({ color: 0x14181c, side: THREE.BackSide });
  geos.push(room); mats.push(roomMat);
  s.add(new THREE.Mesh(room, roomMat));
  const panel = (color, k, w, h, x, y, z) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide });
    geos.push(g); mats.push(m);
    const p = new THREE.Mesh(g, m);
    p.position.set(x, y, z);
    p.lookAt(0, 0, 0);
    s.add(p);
  };
  panel(0xffe0b8, 7.5, 9, 6, -5, 5.9, 4);    // warm key soft-box
  panel(0xffffff, 1.6, 8, 2.5, 4, 4, 11.9);   // front fill
  panel(0x8fb6ff, 3.2, 16, 1.4, 0, 2.5, -11.9); // cool back strip (rim)
  panel(0x22ff77, 0.35, 14, 14, 0, -5.9, 0);  // phosphor bounce from below
  panel(0xffb000, 0.6, 3, 3, 11.9, 1, -3);    // amber LED side
  return {
    scene: s,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const FLOOR_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FLOOR_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uHole;
uniform vec3 uFog;
uniform vec3 uSpill;
uniform vec2 uBoard;
uniform vec2 uShadowOff;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vW;
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  vec2 q = vW.xz;
  // perforated steel: staggered round holes
  vec2 g = q * 2.0;
  g.x += 0.5 * mod(floor(g.y), 2.0);
  vec2 cell = fract(g) - 0.5;
  float fw = fwidth(g.x) * 1.2;
  float hole = 1.0 - smoothstep(0.19 - fw, 0.19 + fw, length(cell));
  hole *= 1.0 - smoothstep(0.12, 0.5, fw);
  // stamped ribs: soft raised bands every 7 units
  float rb = abs(fract(q.x / 7.0 + 0.5) - 0.5) * 7.0;
  float rib = smoothstep(0.55, 0.25, rb) * 0.35 - smoothstep(0.85, 0.55, rb) * smoothstep(0.25, 0.55, rb) * 0.2;
  // light pool from the key light, brighter toward the upper-left
  vec2 lc = (q - vec2(-3.0, -2.0)) * vec2(0.7, 1.0);
  float light = 0.18 + 0.95 * exp(-dot(lc, lc) / 380.0);
  vec3 col = mix(uBase * (1.0 + rib), uHole, hole * 0.9) * light;
  // soft contact shadow of the motherboard (offset away from the key light) and phosphor spill
  float sd = sdBox(q - uShadowOff, uBoard);
  col *= 1.0 - 0.82 * (1.0 - smoothstep(-0.8, 3.2, sd));
  col += uSpill * exp(-max(sd + 0.6, 0.0) * 0.45);
  float dist = length(vW - cameraPosition);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createBackdrop(scene) {
  const geo = new THREE.PlaneGeometry(260, 260);
  geo.rotateX(-Math.PI / 2);
  const lin = (hex) => new THREE.Color(hex);
  const uniforms = {
    uBase: { value: lin(0x2a3036) },
    uHole: { value: lin(0x050607) },
    uFog: { value: lin(FOG_COLOR) },
    uSpill: { value: lin(0x0b2a16).multiplyScalar(0.55) },
    uBoard: { value: new THREE.Vector2(BOARD.W / 2 + 0.6, BOARD.H / 2 + 0.6) },
    uShadowOff: { value: new THREE.Vector2(-KEY_DIR.x * 1.6, -KEY_DIR.z * 1.6) },
    uFogNear: { value: 30 },
    uFogFar: { value: 90 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, uniforms });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = FLOOR_Y;
  mesh.name = 'render:backdrop';
  mesh.renderOrder = 10; // drawn after the board so early-z skips every covered pixel
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);
  return {
    mesh,
    setFog(near, far) {
      uniforms.uFogNear.value = near;
      uniforms.uFogFar.value = far;
    },
  };
}

// Dust motes drifting through the key light above the board (old PCs are dusty). One Points draw call,
// animated entirely in the vertex shader from the real-time clock, so it keeps floating in menus/pause.
const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec4 aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * (0.6 + aSeed.w * 0.5);
  p.x += sin(t * 0.13 + aSeed.x * 6.28) * 1.6 + uTime * 0.05;
  p.y += sin(t * 0.21 + aSeed.y * 6.28) * 0.5;
  p.z += cos(t * 0.11 + aSeed.z * 6.28) * 1.2;
  p.x = mod(p.x + 15.0, 30.0) - 15.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.6 + aSeed.w) / max(1.0, -mv.z);
  // brighter inside the light pool (upper-left), twinkle as the mote turns
  vec2 lc = (p.xz - vec2(-3.0, -2.0)) * vec2(0.7, 1.0);
  float light = 0.25 + exp(-dot(lc, lc) / 110.0);
  vA = light * (0.55 + 0.45 * sin(uTime * (1.5 + aSeed.x * 2.0) + aSeed.y * 30.0));
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 3.5) * vA;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export function createDust(scene, count = 140) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 1] = 0.6 + Math.random() * 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 19;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 60 },
    uColor: { value: new THREE.Color(0xffe6c0).multiplyScalar(0.22) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'render:dust';
  points.frustumCulled = false;
  points.renderOrder = 8;
  points.matrixAutoUpdate = false;
  scene.add(points);
  return {
    points,
    update(time, pxScale) {
      uniforms.uTime.value = time;
      uniforms.uScale.value = pxScale;
    },
  };
}
