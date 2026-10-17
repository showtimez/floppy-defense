// GPU particle systems: every effect is an instanced quad/box whose whole life (ballistics, bounce, spin,
// fade) is evaluated in the vertex shader from its spawn attributes and a shared clock uniform. Spawning
// writes one ring-buffer slot; nothing is touched per frame on the CPU (zero allocations, one draw call
// per system). Dead / expired instances collapse to a clipped point.
// Idea adapted from ZelariFPS/src/render/fxParts.js (createRings) and tempesta-fixart/src/game/sprites.js.
import * as THREE from 'three';

export const SHAPE = { GLOW: 0, FLARE: 1, PIXEL: 2, RING: 3 };

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uKill;
#define HIDE { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
`;

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export function createSystem({ base, capacity, layout, material, renderOrder = 0, name }) {
  const geo = new THREE.InstancedBufferGeometry();
  if (base.index) geo.setIndex(base.index);
  for (const k of Object.keys(base.attributes)) geo.setAttribute(k, base.attributes[k]);
  const attrs = [];
  const arrays = {};
  for (const [key, size] of Object.entries(layout)) {
    const arr = new Float32Array(capacity * size);
    const a = new THREE.InstancedBufferAttribute(arr, size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(key, a);
    attrs.push(a);
    arrays[key] = arr;
  }
  geo.instanceCount = 0;
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name || 'fx';
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.matrixAutoUpdate = false;
  let head = 0;
  let used = 0;
  let total = 0;
  let lo = -1;
  let hi = -1;
  const sys = {
    mesh,
    arrays,
    capacity,
    alloc() {
      const i = head;
      head = (head + 1) % capacity;
      if (used < capacity) used++;
      if (lo < 0) lo = total;
      hi = total;
      total++;
      return i;
    },
    flush() {
      if (lo < 0) return;
      geo.instanceCount = used;
      const n = hi - lo + 1;
      const start = lo % capacity;
      for (let j = 0; j < attrs.length; j++) {
        const a = attrs[j];
        const s = a.itemSize;
        a.clearUpdateRanges();
        if (n >= capacity) {
          a.addUpdateRange(0, capacity * s);
        } else if (start + n <= capacity) {
          a.addUpdateRange(start * s, n * s);
        } else {
          a.addUpdateRange(start * s, (capacity - start) * s);
          a.addUpdateRange(0, (start + n - capacity) * s);
        }
        a.needsUpdate = true;
      }
      lo = -1;
      hi = -1;
    },
  };
  // safety net if nobody calls flush() before rendering (uploads land one frame later)
  mesh.onBeforeRender = () => sys.flush();
  return sys;
}

// ------------------------------------------------------------------------------------------------
// Voxel debris: lit cubes, ballistic with one bounce on the board, spin, digital blink + shrink at the end
// aP: pos.xyz, birth   aV: vel.xyz, life   aC: rgb, size   aR: axis.xyz, spin   aX: gravity, floorY, glow, blink
// ------------------------------------------------------------------------------------------------
export function cubeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: COMMON + /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aR;
attribute vec4 aX;
varying vec3 vCol;
varying vec3 vN;
varying float vGlow;
vec3 rot(vec3 v, vec3 a, float ang) {
  float c = cos(ang), s = sin(ang);
  return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
}
void main() {
  float life = aV.w;
  float age = uTime - aP.w;
  if (life <= 0.0 || age < 0.0 || age >= life || aP.w < uKill) HIDE
  float k = age / life;
  float g = aX.x;
  float fy = aX.y + aC.w * 0.5;
  vec3 p0 = aP.xyz;
  vec3 v = aV.xyz;
  float disc = v.y * v.y - 2.0 * g * (p0.y - fy);
  float t1 = (g < 0.0 && disc >= 0.0) ? (-v.y - sqrt(disc)) / g : 1e5;
  vec3 p;
  float spinT = age;
  if (age < t1) {
    p = p0 + v * age;
    p.y += 0.5 * g * age * age;
  } else {
    vec3 pc = p0 + v * t1;
    float vy1 = -(v.y + g * t1) * 0.3;
    float tau = age - t1;
    float tb = -2.0 * vy1 / g;
    float tt = min(tau, tb);
    p = vec3(pc.x, fy, pc.z) + vec3(v.x, 0.0, v.z) * 0.3 * tt;
    p.y = fy + max(0.0, vy1 * tt + 0.5 * g * tt * tt);
    spinT = t1 + tt * 0.4;
  }
  float s = aC.w * (1.0 - smoothstep(0.6, 1.0, k));
  float blink = step(0.4, fract(age * 21.0 + aP.w * 7.31));
  s *= mix(1.0, blink, aX.w * step(0.62, k));
  float ang = aR.w * spinT;
  vec3 lp = rot(position * s, aR.xyz, ang);
  vN = rot(normal, aR.xyz, ang);
  vCol = aC.rgb;
  vGlow = aX.z * (1.0 - k) * (1.0 - k) + aX.z * 0.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + lp, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying float vGlow;
void main() {
  vec3 n = normalize(vN);
  float l = 0.42 + 0.75 * max(dot(n, vec3(-0.38, 0.84, 0.4)), 0.0) + 0.18 * max(-n.z, 0.0);
  vec3 c = vCol * (l + vGlow);
  gl_FragColor = vec4(c, 1.0);
` + OUTPUT + '}',
  });
}

// ------------------------------------------------------------------------------------------------
// Additive billboards: glow dots, star flares, hard pixels, thin rings
// aP: pos.xyz, birth   aV: vel.xyz, life   aC: rgb (HDR), size0   aX: size1, gravity, drag, shape
// ------------------------------------------------------------------------------------------------
export function glowMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    vertexShader: COMMON + /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aX;
varying vec2 vQ;
varying vec3 vCol;
varying float vShape;
void main() {
  float life = aV.w;
  float age = uTime - aP.w;
  if (life <= 0.0 || age < 0.0 || age >= life || aP.w < uKill) HIDE
  float k = age / life;
  float dr = aX.z;
  float m = dr > 0.0 ? (1.0 - exp(-dr * age)) / dr : age;
  vec3 p = aP.xyz + aV.xyz * m;
  p.y += 0.5 * aX.y * age * age;
  float size = mix(aC.w, aX.x, k);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vQ = position.xy * 2.0;
  vCol = aC.rgb * pow(1.0 - k, 1.4);
  vShape = aX.w;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
varying float vShape;
void main() {
  float r2 = dot(vQ, vQ);
  float a;
  if (vShape < 0.5) {
    a = exp(-r2 * 5.0) * 0.8 + exp(-r2 * 30.0) * 0.7;
  } else if (vShape < 1.5) {
    vec2 q = abs(vQ);
    a = exp(-q.x * 16.0) * exp(-q.y * 2.6) + exp(-q.y * 16.0) * exp(-q.x * 2.6) + exp(-r2 * 14.0) * 0.8;
  } else if (vShape < 2.5) {
    vec2 q = abs(vQ);
    float mq = max(q.x, q.y);
    a = (1.0 - smoothstep(0.5, 0.56, mq)) + exp(-mq * mq * 7.0) * 0.25;
  } else {
    float r = sqrt(r2);
    a = exp(-pow((r - 0.78) / 0.08, 2.0));
  }
  a *= 1.0 - smoothstep(0.92, 1.0, max(abs(vQ.x), abs(vQ.y)));
  gl_FragColor = vec4(vCol * a, 1.0);
` + OUTPUT + '}',
  });
}

// ------------------------------------------------------------------------------------------------
// Smoke: soft lumpy puffs, alpha blended, rising and growing
// aP: pos.xyz, birth   aV: vel.xyz, life   aC: rgb, size0   aX: size1, buoyancy, drag, seed
// ------------------------------------------------------------------------------------------------
export function smokeMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: COMMON + /* glsl */ `
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aC;
attribute vec4 aX;
varying vec2 vQ;
varying vec3 vCol;
varying float vA;
varying float vSeed;
void main() {
  float life = aV.w;
  float age = uTime - aP.w;
  if (life <= 0.0 || age < 0.0 || age >= life || aP.w < uKill) HIDE
  float k = age / life;
  float dr = aX.z;
  float m = dr > 0.0 ? (1.0 - exp(-dr * age)) / dr : age;
  vec3 p = aP.xyz + aV.xyz * m;
  p.y += 0.5 * aX.y * age * age;
  float size = mix(aC.w, aX.x, sqrt(k));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float a = aX.w * 6.2831 + age * 0.8;
  vec2 c = position.xy;
  c = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  mv.xy += c * size;
  gl_Position = projectionMatrix * mv;
  vQ = position.xy * 2.0;
  vCol = aC.rgb;
  vA = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.45, 1.0, k));
  vSeed = aX.w;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
varying float vA;
varying float vSeed;
void main() {
  float r = length(vQ);
  float ang = atan(vQ.y, vQ.x);
  float lump = 0.82 + 0.1 * sin(ang * 3.0 + vSeed * 17.0) + 0.08 * sin(ang * 5.0 - vSeed * 9.0);
  float a = 1.0 - smoothstep(0.35 * lump, lump, r);
  float shade = 0.75 + 0.35 * vQ.y;
  gl_FragColor = vec4(vCol * shade, a * vA * 0.6);
` + OUTPUT + '}',
  });
}

// ------------------------------------------------------------------------------------------------
// Ground rings (XZ): expanding shockwave with a dashed "radar" edge and a faint filled body
// aP: pos.xyz, birth   aC: rgb, life   aR: r0, r1, width, dashes
// ------------------------------------------------------------------------------------------------
export function ringMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: COMMON + /* glsl */ `
attribute vec4 aP;
attribute vec4 aC;
attribute vec4 aR;
varying vec2 vL;
varying vec3 vCol;
varying vec4 vR;
varying float vK;
void main() {
  float life = aC.w;
  float age = uTime - aP.w;
  if (life <= 0.0 || age < 0.0 || age >= life || aP.w < uKill) HIDE
  float k = age / life;
  float R = aR.y + aR.z * 4.0;
  vec2 l = position.xy * 2.0 * R;
  vec3 p = aP.xyz + vec3(l.x, 0.0, -l.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vL = l;
  vCol = aC.rgb;
  vR = aR;
  vK = k;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vL;
varying vec3 vCol;
varying vec4 vR;
varying float vK;
void main() {
  float d = length(vL);
  float e = 1.0 - pow(1.0 - vK, 2.6);
  float r = mix(vR.x, vR.y, e);
  float w = vR.z * (1.0 + vK * 0.8);
  float ring = exp(-pow((d - r) / w, 2.0));
  if (vR.w > 0.5) {
    float seg = fract(atan(vL.y, vL.x) / 6.2831853 * vR.w + vK * 0.6);
    ring *= 0.45 + 0.55 * step(0.35, seg);
  }
  float body = smoothstep(r, r * 0.25, d) * 0.12;
  float a = (ring + body) * pow(1.0 - vK, 1.4);
  gl_FragColor = vec4(vCol * a, 1.0);
` + OUTPUT + '}',
  });
}

// ------------------------------------------------------------------------------------------------
// Beams: camera-facing ribbon between two points, crackling jitter, white-hot core
// aA: from.xyz, birth   aB: to.xyz, life   aC: rgb, width
// ------------------------------------------------------------------------------------------------
export function beamMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    vertexShader: COMMON + /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
varying float vY;
varying vec3 vCol;
varying float vA;
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float life = aB.w;
  float age = uTime - aA.w;
  if (life <= 0.0 || age < 0.0 || age >= life || aA.w < uKill) HIDE
  float k = age / life;
  float f = position.x + 0.5;
  vec3 dir = aB.xyz - aA.xyz;
  vec3 p = aA.xyz + dir * f;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = aC.w * (1.0 + 1.5 * (1.0 - k));
  float jit = (h11(f * 9.0 + floor(uTime * 45.0) + aA.w) - 0.5) * aC.w * 3.0 * sin(f * 3.14159);
  p += side * (position.y * w * 2.0 + jit);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vY = position.y * 2.0;
  vCol = aC.rgb;
  vA = 1.0 - k * k;
}`,
    fragmentShader: /* glsl */ `
varying float vY;
varying vec3 vCol;
varying float vA;
void main() {
  float core = exp(-vY * vY * 10.0);
  float glow = exp(-vY * vY * 2.5) * 0.6;
  vec3 c = (vCol * (core + glow) + vec3(core * core * 1.5)) * vA;
  gl_FragColor = vec4(c, 1.0);
` + OUTPUT + '}',
  });
}

// ------------------------------------------------------------------------------------------------
// Floating DOS text: one instance per glyph, billboarded, typed in char by char, rising and fading
// aP: anchor.xyz, birth   aG: glyph, xoff (chars), life, height   aC: rgb, rise   aD: type delay
// aO: outline rgb (black by default; HDR = glowing rim)
// ------------------------------------------------------------------------------------------------
export function textMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: COMMON + /* glsl */ `
uniform vec2 uGrid;
uniform float uAspect;
attribute vec4 aP;
attribute vec4 aG;
attribute vec4 aC;
attribute float aD;
attribute vec3 aO;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vOut;
varying float vA;
void main() {
  float life = aG.z;
  float age = uTime - aP.w;
  if (life <= 0.0 || age < aD || age >= life || aP.w < uKill) HIDE
  float k = age / life;
  float rise = aC.w * (1.0 - pow(1.0 - min(k * 1.25, 1.0), 3.0));
  vec4 mv = viewMatrix * vec4(aP.xyz + vec3(0.0, rise, 0.0), 1.0);
  float ca = age - aD;
  float pop = 1.0 + 0.55 * (1.0 - smoothstep(0.0, 0.1, ca));
  float h = aG.w * pop;
  vec2 c = position.xy;
  mv.xy += vec2((aG.y * aG.w + c.x * h) * uAspect, c.y * h);
  gl_Position = projectionMatrix * mv;
  float col = mod(aG.x, uGrid.x);
  float row = floor(aG.x / uGrid.x + 0.001);
  vUv = vec2((col + c.x + 0.5) / uGrid.x, (row + 0.5 - c.y) / uGrid.y);
  vCol = aC.rgb * (1.0 + 1.2 * (1.0 - smoothstep(0.0, 0.12, ca)));
  vOut = aO;
  vA = 1.0 - smoothstep(0.7, 1.0, k);
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vOut;
varying float vA;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a * vA < 0.01) discard;
  // atlas: rgb = 1 on the glyph fill, 0 on its 1-px outline; the outline colour defaults to black,
  // an HDR colour turns it into a glowing rim (bloom)
  gl_FragColor = vec4(mix(vOut, vCol, t.r), t.a * vA);
` + OUTPUT + '}',
  });
}
