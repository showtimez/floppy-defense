// Procedural low-poly virus models (Compo: everything generated in code).
// Every model part is ONE InstancedMesh shared by all enemies of that kind, so a whole wave costs a handful of draw
// calls. All parts share one MeshStandardMaterial patched with:
//   per-vertex  aEmis  (0..1 emissive mask, vertex colour × mask × emissiveIntensity → bloom-friendly accents)
//   per-instance aFx   (x = hit flash, y = slow/frost amount, z = emissive boost, w = darken for banded segments)
// The enemies module owns the simulation; this module turns Enemy objects into instance matrices once per update.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _root = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Geometry helpers: each piece is a non-indexed primitive with flat vertex colour + emissive mask.
// ---------------------------------------------------------------------------------------------
const PRIM = {
  box: new THREE.BoxGeometry(1, 1, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  octa: new THREE.OctahedronGeometry(1, 0),
};

function piece(src, color, emis = 0, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.clearGroups();
  _e.set(r[0], r[1], r[2], 'XYZ');
  _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e), _s.set(s[0], s[1], s[2]));
  g.applyMatrix4(_m);
  paint(g, color, emis);
  return g;
}

function paint(g, color, emis) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n);
  _col.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
    em[i] = emis;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmis', new THREE.BufferAttribute(em, 1));
  return g;
}

// Flat polygon given as local (x, z) points, extruded upward from y0 by `h`.
function flat(points, h, color, emis = 0, y0 = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g0 = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  // shape (x, y, depth) -> rotate +90° on X: (x, -depth, y)  => shape y becomes local +z, extrusion goes down
  const g = piece(g0, color, emis, [0, y0 + h, 0], [Math.PI / 2, 0, 0]);
  g0.dispose();
  return g;
}

// Thin bar (box) on the XZ plane from (ax, az) to (bx, bz).
function stroke(ax, az, bx, bz, w, h, y, color, emis) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) + w * 0.6;
  return piece(PRIM.box, color, emis, [(ax + bx) / 2, y + h / 2, (az + bz) / 2], [0, Math.atan2(-dz, dx), 0], [len, h, w]);
}

function build(pieces) {
  const g = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// Classic bezier heart in the XY plane, centred, width ≈ w.
function heartShape(w) {
  const k = w / 22;
  const P = (x, y) => [(x - 5) * k, (9.5 - y) * k];
  const s = new THREE.Shape();
  const m = (x, y) => s.moveTo(...P(x, y));
  const b = (a, c, d, e, f, g) => s.bezierCurveTo(...P(a, c), ...P(d, e), ...P(f, g));
  m(5, 5);
  b(5, 5, 4, 0, 0, 0);
  b(-6, 0, -6, 7, -6, 7);
  b(-6, 11, -3, 15.4, 5, 19);
  b(12, 15.4, 16, 11, 16, 7);
  b(16, 7, 16, 0, 10, 0);
  b(7, 0, 5, 5, 5, 5);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Model geometries. Local frame: +Z = forward (movement direction), +Y = up, origin on the ground.
// For flat "paper" content the reading frame is: up = +Z, right = -X (so it reads upright when walking away).
// ---------------------------------------------------------------------------------------------
const C = {
  worm: 0xff2bd6, wormDark: 0x9a1585, wormTip: 0xffc2f4,
  white: 0xffffff, black: 0x0a0a0c, ink: 0x151517,
  // warm orange-stained wood so the horse reads orange (its type colour) rather than brown on the gold traces
  wood: 0xc4702a, woodLight: 0xdc8a3a, woodDark: 0x7c4216, woodDeep: 0x4a2a10, hatch: 0xff8a1f, evil: 0xff2a1a,
  metal: 0xa7adb3,
  // cool white-blue paper: documents read as cyan pages, never as the beige drive-bay sockets
  paper: 0xe6f2ff, paperFold: 0xa4b6cc, wordBlue: 0x2b56d8, glyph: 0x2ef2ff, line: 0x8796ab,
  melissaEye: 0xff2040,
  heart: 0xff3c8e, heartSide: 0xc8145e, seal: 0xff1744, envelope: 0xf6ead2, envelopeFlap: 0xe2cfa6,
  ice: 0xbff2ff,
};

function wormHeadGeo() {
  const P = [];
  P.push(piece(PRIM.ico1, C.worm, 0.45, [0, 0, 0], [0, 0, 0], [0.2, 0.18, 0.21]));
  // big googly eyes with angry brows (they must read at ~6 px)
  for (const sx of [-1, 1]) {
    P.push(piece(PRIM.ico1, C.white, 0.12, [sx * 0.085, 0.075, 0.12], [0, 0, 0], [0.08, 0.08, 0.072]));
    P.push(piece(PRIM.ico1, C.black, 0, [sx * 0.088, 0.085, 0.178], [0, 0, 0], [0.048, 0.05, 0.03]));
    P.push(piece(PRIM.box, C.black, 0, [sx * 0.085, 0.163, 0.13], [0, 0, sx * 0.42], [0.1, 0.028, 0.035]));
    // antennae with glowing tips
    P.push(piece(PRIM.cyl6, C.wormDark, 0.2, [sx * 0.07, 0.22, -0.01], [-0.35, 0, -sx * 0.45], [0.013, 0.17, 0.013]));
    P.push(piece(PRIM.ico0, C.wormTip, 1.0, [sx * 0.112, 0.3, -0.045], [0, 0, 0], [0.04, 0.04, 0.04]));
  }
  // grin
  P.push(piece(PRIM.box, C.black, 0, [0, -0.045, 0.19], [0.2, 0, 0], [0.12, 0.022, 0.03]));
  return build(P);
}

function wormSegGeo() {
  // unit-radius body segment + glowing dorsal spine; instances scale it
  return build([
    piece(PRIM.ico1, C.worm, 0.42, [0, 0, 0], [0, 0, 0], [1, 0.92, 1]),
    piece(PRIM.cone4, C.wormTip, 0.9, [0, 0.98, -0.05], [-0.35, Math.PI / 4, 0], [0.32, 0.55, 0.32]),
  ]);
}

function trojanBodyGeo() {
  const P = [];
  // cart platform (narrow, so the legs and wheels read from above)
  P.push(piece(PRIM.box, C.woodDark, 0, [0, 0.16, -0.02], [0, 0, 0], [0.36, 0.06, 0.82]));
  // legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P.push(piece(PRIM.box, C.wood, 0, [sx * 0.1, 0.29, sz * 0.21 - 0.02], [0, 0, 0], [0.07, 0.22, 0.07]));
  }
  // barrel body with plank lines (visible from above) and a glowing hatch: the soldiers are inside
  P.push(piece(PRIM.box, C.wood, 0.02, [0, 0.52, -0.04], [0, 0, 0], [0.3, 0.26, 0.58]));
  for (const x of [-0.075, 0.075]) P.push(piece(PRIM.box, C.woodDark, 0, [x, 0.652, -0.04], [0, 0, 0], [0.016, 0.008, 0.58]));
  for (const sx of [-1, 1]) {
    P.push(piece(PRIM.box, C.woodDark, 0, [sx * 0.152, 0.47, -0.04], [0, 0, 0], [0.008, 0.016, 0.58]));
    P.push(piece(PRIM.box, C.woodDark, 0, [sx * 0.152, 0.57, -0.04], [0, 0, 0], [0.008, 0.016, 0.58]));
  }
  // one big glowing hatch panel on the back: reads orange from the top-down camera
  P.push(piece(PRIM.box, C.hatch, 1.0, [0, 0.66, -0.07], [0, 0, 0], [0.24, 0.012, 0.36]));
  P.push(piece(PRIM.box, C.woodDeep, 0, [0, 0.668, -0.07], [0, 0, 0], [0.012, 0.004, 0.3]));
  for (const sx of [-1, 1]) P.push(piece(PRIM.box, C.hatch, 0.9, [sx * 0.154, 0.52, 0.04], [0, 0, 0], [0.008, 0.1, 0.16]));
  // long proud neck + head + snout
  P.push(piece(PRIM.box, C.woodLight, 0, [0, 0.8, 0.24], [0.42, 0, 0], [0.17, 0.44, 0.19]));
  P.push(piece(PRIM.box, C.woodDeep, 0, [0, 0.88, 0.15], [0.42, 0, 0], [0.06, 0.42, 0.09]));
  P.push(piece(PRIM.box, C.hatch, 1.0, [0, 0.898, 0.109], [0.42, 0, 0], [0.035, 0.38, 0.04])); // glowing mane strip
  P.push(piece(PRIM.box, C.woodLight, 0, [0, 1.04, 0.44], [0.3, 0, 0], [0.17, 0.17, 0.36]));
  P.push(piece(PRIM.box, C.woodDark, 0, [0, 0.98, 0.62], [0.3, 0, 0], [0.155, 0.13, 0.07]));
  // ears
  for (const sx of [-1, 1]) P.push(piece(PRIM.cone4, C.woodDark, 0, [sx * 0.055, 1.17, 0.35], [-0.2, Math.PI / 4, 0], [0.045, 0.13, 0.045]));
  // evil glowing eyes (stick out a little so they read from above)
  for (const sx of [-1, 1]) P.push(piece(PRIM.box, C.evil, 1.0, [sx * 0.09, 1.09, 0.47], [0.3, 0, 0], [0.08, 0.1, 0.1]));
  // tail
  P.push(piece(PRIM.box, C.woodDeep, 0, [0, 0.52, -0.39], [-0.6, 0, 0], [0.05, 0.26, 0.05]));
  return build(P);
}

function wheelGeo() {
  return build([
    piece(PRIM.cyl8, C.woodDeep, 0, [0, 0, 0], [0, 0, Math.PI / 2], [0.1, 0.07, 0.1]),
    piece(PRIM.cyl6, C.metal, 0.05, [0, 0, 0], [0, 0, Math.PI / 2], [0.04, 0.085, 0.04]),
    piece(PRIM.box, C.wood, 0, [0, 0, 0], [0, 0, 0], [0.074, 0.17, 0.025]),
  ]);
}

const PAGE_W = 0.44, PAGE_H = 0.58, PAGE_T = 0.022, FOLD = 0.13;
function pageOutline(w = PAGE_W, h = PAGE_H, fold = FOLD) {
  const x = w / 2, z = h / 2;
  // folded corner at the reading top-right = (+z, -x)
  return [[x, -z], [-x, -z], [-x, z - fold], [-x + fold, z], [x, z]];
}

function pageBase(P, titleColor) {
  const x = PAGE_W / 2, z = PAGE_H / 2, y = PAGE_T;
  P.push(flat(pageOutline(), PAGE_T, C.paper, 0.02));
  P.push(flat([[-x, z - FOLD], [-x + FOLD, z - FOLD], [-x + FOLD, z]], 0.006, C.paperFold, 0, y));
  // title bar (Word blue / red)
  P.push(piece(PRIM.box, titleColor, 1.0, [0.035, y + 0.004, z - 0.045], [0, 0, 0], [0.32, 0.008, 0.05]));
}

function pageGeo() {
  const P = [];
  pageBase(P, C.wordBlue);
  const y = PAGE_T + 0.002;
  // glowing "W" glyph: reading coords (u right, v up) -> x = -u, z = v
  const W = [[-1, 1], [-0.5, -1], [0, 0.35], [0.5, -1], [1, 1]];
  for (let i = 0; i < W.length - 1; i++) {
    const [u0, v0] = W[i], [u1, v1] = W[i + 1];
    P.push(stroke(-u0 * 0.115, v0 * 0.085 + 0.03, -u1 * 0.115, v1 * 0.085 + 0.03, 0.038, 0.012, y, C.glyph, 1.0));
  }
  // text lines, left-aligned (reading left = +x)
  const L = [0.32, 0.25, 0.3];
  L.forEach((w, i) => P.push(piece(PRIM.box, C.line, 0, [0.17 - w / 2, y + 0.003, -0.12 - i * 0.052], [0, 0, 0], [w, 0.006, 0.024])));
  return build(P);
}

function melissaTopGeo() {
  const P = [];
  pageBase(P, C.wordBlue);
  const y = PAGE_T + 0.002;
  const R = (u, v) => [-u, v];
  // angry slanted glowing eyes (inner corners low), dark pupils, heavy brows
  for (const s of [-1, 1]) {
    const eye = [[0.025, 0.055], [0.195, 0.125], [0.185, -0.015], [0.04, -0.02]].map(([u, v]) => R(u * s, v));
    if (s < 0) eye.reverse();
    P.push(flat(eye, 0.012, C.melissaEye, 1.0, y));
    P.push(piece(PRIM.box, C.black, 0, [-s * 0.115, y + 0.017, 0.04], [0, 0, 0], [0.05, 0.006, 0.055]));
    P.push(stroke(-s * 0.015, 0.1, -s * 0.215, 0.185, 0.05, 0.02, y, C.ink, 0));
  }
  // jagged shouting mouth: dark slot + teeth
  P.push(flat([R(-0.17, -0.075), R(0.17, -0.075), R(0.15, -0.225), R(-0.15, -0.225)], 0.006, C.ink, 0, y));
  P.push(flat([R(-0.1, -0.17), R(0.1, -0.17), R(0.08, -0.22), R(-0.08, -0.22)], 0.008, 0xd0303a, 0.25, y));
  for (let i = 0; i < 5; i++) {
    const u0 = -0.17 + i * 0.068;
    P.push(flat([R(u0, -0.078), R(u0 + 0.068, -0.078), R(u0 + 0.034, -0.13)], 0.012, C.white, 0.2, y));
  }
  return build(P);
}

function heartGeo() {
  const depth = 0.32;
  const g0 = new THREE.ExtrudeGeometry(heartShape(1.7), {
    depth, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.08, bevelSegments: 1, curveSegments: 5,
  });
  g0.translate(0, 0, -depth / 2);
  // colour caps vs sides using the extrude groups (0 = caps, 1 = sides)
  const g = g0.index ? g0.toNonIndexed() : g0.clone();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), em = new Float32Array(n);
  const cap = new THREE.Color(C.heart), side = new THREE.Color(C.heartSide);
  const groups = g0.groups.length ? g0.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const gr of groups) {
    const c = gr.materialIndex === 0 ? cap : side;
    for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      em[i] = gr.materialIndex === 0 ? 0.55 : 0.4;
    }
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.clearGroups();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmis', new THREE.BufferAttribute(em, 1));
  g0.dispose();
  const front = depth / 2 + 0.09 + 0.005;
  const P = [g];
  // cute-evil face on the front cap
  for (const sx of [-1, 1]) {
    P.push(piece(PRIM.ico1, C.black, 0, [sx * 0.22, 0.17, front], [0, 0, 0], [0.1, 0.13, 0.03]));
    P.push(piece(PRIM.ico0, C.white, 1.0, [sx * 0.22 - 0.03, 0.21, front + 0.02], [0, 0, 0], [0.035, 0.035, 0.02]));
    // eyelids (half-closed, smug)
    P.push(piece(PRIM.box, C.heartSide, 0.3, [sx * 0.22, 0.28, front + 0.02], [0, 0, -sx * 0.25], [0.24, 0.07, 0.04]));
  }
  const smile = new THREE.TorusGeometry(0.17, 0.03, 3, 7, Math.PI);
  P.push(piece(smile, C.black, 0, [0.03, -0.02, front], [0, 0, Math.PI + 0.15], [1, 1, 1]));
  smile.dispose();
  // glossy highlight
  P.push(piece(PRIM.ico1, C.white, 0.9, [-0.5, 0.42, front - 0.01], [0, 0, 0.6], [0.13, 0.07, 0.03]));
  return build(P);
}

function envelopeGeo() {
  const P = [];
  const w = 0.62, d = 0.42, h = 0.05;
  P.push(piece(PRIM.box, C.envelope, 0.18, [0, h / 2, 0], [0, 0, 0], [w, h, d]));
  P.push(flat([[-w / 2, d / 2], [w / 2, d / 2], [0, -0.03]], 0.01, C.envelopeFlap, 0.12, h));
  // lower crease lines
  P.push(stroke(-w / 2, -d / 2, -0.06, 0.02, 0.012, 0.006, h, C.envelopeFlap, 0.1));
  P.push(stroke(w / 2, -d / 2, 0.06, 0.02, 0.012, 0.006, h, C.envelopeFlap, 0.1));
  // heart wax seal (flat, facing up)
  const s0 = new THREE.ExtrudeGeometry(heartShape(0.16), { depth: 0.02, bevelEnabled: false, curveSegments: 3 });
  P.push(piece(s0, C.seal, 1.0, [0, h + 0.012, -0.02], [-Math.PI / 2, Math.PI, 0], [1, 1, 1]));
  s0.dispose();
  return build(P);
}

function frostGeo() {
  return build([
    piece(PRIM.octa, C.ice, 0.45, [0, 0, 0], [0, 0, 0], [0.45, 1.5, 0.45]),
    piece(PRIM.octa, C.ice, 0.45, [0.5, -0.35, 0.2], [0, 0.5, 0.7], [0.25, 0.8, 0.25]),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
function patchVirusShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute float aEmis;
attribute vec4 aFx;
varying float vEmis;
varying vec4 vFx;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vEmis = aEmis;
vFx = aFx;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying float vEmis;
varying vec4 vFx;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 ice = vec3(0.42, 0.8, 1.0);
  float slow = vFx.y;
  float dark = 1.0 - vFx.w * 0.5;
  diffuseColor.rgb *= dark;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.35, 0.65, 1.3) + vec3(0.02, 0.06, 0.16), slow * 0.3);
  // icy rim only on grazing faces (a plain fresnel lights whole side faces of the boxy flat-shaded rigs)
  float fres = smoothstep(0.6, 1.0, 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0));
  totalEmissiveRadiance = vColor.rgb * vEmis * emissive * (1.0 + vFx.z) * dark;
  totalEmissiveRadiance = mix(totalEmissiveRadiance, totalEmissiveRadiance * 0.35 + ice * vEmis * emissive * 0.35, slow * 0.3);
  totalEmissiveRadiance += vec3(0.25, 0.6, 1.0) * slow * (0.03 + fres * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFx.x * 0.55);
  totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(1.0, 0.97, 0.92) * 0.9, vFx.x * 0.45);
}`);
}

function virusMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true,
    emissive: 0xffffff, emissiveIntensity: 1.7,
  });
  m.onBeforeCompile = patchVirusShader;
  m.customProgramCacheKey = () => 'fd-virus-v2';
  return m;
}

const BAR_VERT = /* glsl */`
attribute vec4 aBar;
varying vec2 vUv;
varying vec4 vBar;
varying float vW;
void main() {
  vUv = uv;
  vBar = aBar;
  vec2 size = vec2(instanceMatrix[0][0], instanceMatrix[1][1]);
  vW = size.x;
  vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;

const BAR_FRAG = /* glsl */`
varying vec2 vUv;
varying vec4 vBar;
varying float vW;
void main() {
  float frac = vBar.x, lag = vBar.y, segs = vBar.z, alpha = vBar.w;
  float bw = 0.03 / vW;
  float bh = 0.2;
  float edge = clamp(step(vUv.x, bw) + step(1.0 - bw, vUv.x) + step(vUv.y, bh) + step(1.0 - bh, vUv.y), 0.0, 1.0);
  float x = (vUv.x - bw) / (1.0 - 2.0 * bw);
  float gap = step(0.84, fract(x * segs));
  vec3 fill = frac > 0.5 ? vec3(0.12, 1.0, 0.3) : (frac > 0.25 ? vec3(1.0, 0.6, 0.0) : vec3(1.0, 0.12, 0.08));
  vec3 col = vec3(0.01, 0.04, 0.02);
  if (x < frac) col = fill * (1.0 - gap * 0.8);
  else if (x < lag) col = vec3(1.0, 0.95, 0.85) * (1.0 - gap * 0.7);
  col = mix(col, vec3(0.0), edge);
  gl_FragColor = vec4(col, alpha * 0.95);
  #include <colorspace_fragment>
}`;

const BLOB_VERT = /* glsl */`
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BLOB_FRAG = /* glsl */`
uniform float uOpacity;
varying vec2 vP;
void main() {
  float r = clamp(1.0 - dot(vP, vP), 0.0, 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, r * r * uOpacity);
}`;

// ---------------------------------------------------------------------------------------------
// Instanced batches
// ---------------------------------------------------------------------------------------------
function makeBatch(parent, geometry, material, cap, { shadow = true, renderOrder = 0, fx = true, colors = false } = {}) {
  const b = { parent, geometry, material, cap, n: 0, shadow, renderOrder, fx, colors, mesh: null, fxArr: null, fxAttr: null, mat: null, colArr: null };
  alloc(b, cap, null);
  return b;
}

function alloc(b, cap, old) {
  if (b.fx) {
    const arr = new Float32Array(cap * 4);
    if (old && b.fxArr) arr.set(b.fxArr.subarray(0, Math.min(b.fxArr.length, arr.length)));
    b.fxArr = arr;
    b.fxAttr = new THREE.InstancedBufferAttribute(arr, 4);
    b.fxAttr.setUsage(THREE.DynamicDrawUsage);
    b.geometry.setAttribute(b.fx === true ? 'aFx' : b.fx, b.fxAttr);
  }
  const mesh = new THREE.InstancedMesh(b.geometry, b.material, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (old) mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, cap * 16)));
  if (b.colors) {
    const arr = new Float32Array(cap * 3);
    if (old && b.colArr) arr.set(b.colArr.subarray(0, Math.min(b.colArr.length, arr.length)));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    b.colArr = arr;
  }
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = b.shadow;
  mesh.receiveShadow = false;
  mesh.renderOrder = b.renderOrder;
  mesh.matrixAutoUpdate = false;
  b.parent.add(mesh);
  if (old) { b.parent.remove(old); old.dispose(); }
  b.mesh = mesh;
  b.mat = mesh.instanceMatrix.array;
  b.cap = cap;
}

function slot(b) {
  if (b.n >= b.cap) alloc(b, b.cap * 2, b.mesh);
  return b.n++;
}

function put(b, m, f0 = 0, f1 = 0, f2 = 0, f3 = 0) {
  const i = slot(b);
  m.toArray(b.mat, i * 16);
  if (b.fxArr) {
    const o = i * 4;
    b.fxArr[o] = f0; b.fxArr[o + 1] = f1; b.fxArr[o + 2] = f2; b.fxArr[o + 3] = f3;
  }
  return i;
}

function flush(b) {
  const mesh = b.mesh;
  mesh.count = b.n;
  mesh.visible = b.n > 0;
  if (b.n > 0) {
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, b.n * 16);
    im.needsUpdate = true;
    if (b.fxAttr) {
      b.fxAttr.clearUpdateRanges();
      b.fxAttr.addUpdateRange(0, b.n * 4);
      b.fxAttr.needsUpdate = true;
    }
    if (b.colArr) {
      const ic = mesh.instanceColor;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, b.n * 3);
      ic.needsUpdate = true;
    }
  }
  b.n = 0;
}

// Fast T·Ry·S matrix.
function trsY(m, x, y, z, yaw, sx, sy, sz) {
  const c = Math.cos(yaw), s = Math.sin(yaw), te = m.elements;
  te[0] = c * sx; te[1] = 0; te[2] = -s * sx; te[3] = 0;
  te[4] = 0; te[5] = sy; te[6] = 0; te[7] = 0;
  te[8] = s * sz; te[9] = 0; te[10] = c * sz; te[11] = 0;
  te[12] = x; te[13] = y; te[14] = z; te[15] = 1;
  return m;
}

function trsE(m, x, y, z, pitch, yaw, roll, sx, sy, sz) {
  _e.set(pitch, yaw, roll, 'YXZ');
  return m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function labelTexture(text, color, glow) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(4,8,6,0.82)';
  g.fillRect(8, 14, 496, 68);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(10, 16, 492, 64);
  g.font = 'bold 46px "Courier New", Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, 256, 50);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.55;
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Soft radial glow (generated in code): white core fading to transparent; tinted per instance.
function haloTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.46)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.16)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------------------------
export const WORM_SEGMENTS = 6;
const WORM_RADII = [0.15, 0.14, 0.128, 0.115, 0.1, 0.085];
const WORM_SPACING = 0.15;
const TRAIL_N = 40;
const TRAIL_STEP = 0.045;
export const FLASH_TIME = 0.06; // hit flash length (enemies.js re-arms it at most every 0.15 s)
export const DIE_TIME = 0.2;
export const LEAK_TIME = 0.45;
export const SPAWN_TIME = 0.4;

export function createEnemyModels(ctx) {
  const scene = ctx.view && ctx.view.scene;
  const root = new THREE.Group();
  root.name = 'enemies';
  if (scene && scene.add) scene.add(root);

  const mat = virusMaterial();
  const B = {
    wormHead: makeBatch(root, wormHeadGeo(), mat, 128),
    wormSeg: makeBatch(root, wormSegGeo(), mat, 128 * WORM_SEGMENTS),
    trojan: makeBatch(root, trojanBodyGeo(), mat, 48),
    wheel: makeBatch(root, wheelGeo(), mat, 48 * 4),
    page: makeBatch(root, pageGeo(), mat, 160),
    melissa: makeBatch(root, melissaTopGeo(), mat, 4),
    heart: makeBatch(root, heartGeo(), mat, 4),
    envelope: makeBatch(root, envelopeGeo(), mat, 4),
    frost: makeBatch(root, frostGeo(), mat, 240),
  };
  const blobMat = new THREE.ShaderMaterial({
    vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, transparent: true, depthWrite: false,
    uniforms: { uOpacity: { value: 0.42 } },
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const blob = makeBatch(root, new THREE.CircleGeometry(1, 14), blobMat, 256, { shadow: false, renderOrder: 1, fx: false });
  // colour-coded danger halo on the PCB under every virus (one additive draw call for all of them)
  let halo = null;
  try {
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    halo = makeBatch(root, new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), haloMat, 256, { shadow: false, renderOrder: 2, fx: false, colors: true });
  } catch (err) { halo = null; }
  const barMat = new THREE.ShaderMaterial({
    vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const bars = makeBatch(root, new THREE.PlaneGeometry(1, 1), barMat, 256, { shadow: false, renderOrder: 30, fx: 'aBar' });

  // Boss name labels (sprites with CanvasTexture), pooled per type.
  const labelDefs = {
    melissa: { text: 'MELISSA.DOC', color: '#7fb2ff', glow: '#3d7bff', h: 2.55 },
    iloveyou: { text: 'ILOVEYOU.VBS', color: '#ff7ab8', glow: '#ff3c8e', h: 2.9 },
  };
  const labelPool = { melissa: [], iloveyou: [] };
  const labelMats = {};
  const labelUsed = { melissa: 0, iloveyou: 0 };
  function label(kind, x, y, z, alpha, t) {
    const d = labelDefs[kind];
    if (!d) return;
    if (!labelMats[kind]) {
      try {
        labelMats[kind] = new THREE.SpriteMaterial({ map: labelTexture(d.text, d.color, d.glow), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      } catch (err) { labelMats[kind] = null; }
    }
    if (!labelMats[kind]) return;
    const pool = labelPool[kind];
    let sp = pool[labelUsed[kind]];
    if (!sp) {
      sp = new THREE.Sprite(labelMats[kind]);
      sp.renderOrder = 31;
      sp.scale.set(2.4, 0.45, 1);
      root.add(sp);
      pool.push(sp);
    }
    labelUsed[kind]++;
    sp.visible = true;
    sp.position.set(x, y + Math.sin(t * 2.2) * 0.06, z);
    sp.material.opacity = alpha;
  }

  const cpuPos = () => (ctx.map && ctx.map.cpu && ctx.map.cpu.pos) || null;

  // -------------------------------------------------------------------------------------------
  function initVisual(e, opts = {}) {
    const v = {
      yaw: Math.atan2(e.dir.x, e.dir.z), lx: -e.dir.z, lz: e.dir.x,
      flash: 0, flashCd: 0, punch: 0, spawnT: opts.noSpawnFx ? SPAWN_TIME : 0, hopT: 0, hopDur: 0.42, hx: 0, hz: 0,
      mode: 0, modeT: 0, seed: Math.random(), slowVis: 0, pulse: 0, barLag: 1, barA: 0, stage: 0,
      dx: e.pos.x, dz: e.pos.z, // last visual root position (for death / leak)
      trail: null, th: 0, wx: 0, wz: 0,
    };
    if (opts.hopFrom) {
      v.hopT = v.hopDur;
      v.hx = opts.hopFrom.x;
      v.hz = opts.hopFrom.z;
    }
    if (e.def.model === 'worm') {
      v.trail = new Float32Array(TRAIL_N * 2);
      const off = e.offset || 0;
      const sx = opts.hopFrom ? opts.hopFrom.x : e.pos.x - e.dir.z * off;
      const sz = opts.hopFrom ? opts.hopFrom.z : e.pos.z + e.dir.x * off;
      // body starts tucked behind the head, back along the path (worms crawl out of the port)
      for (let k = 0; k < TRAIL_N; k++) {
        const back = opts.hopFrom ? k * 0.01 : k * TRAIL_STEP;
        v.trail[k * 2] = sx - e.dir.x * back;
        v.trail[k * 2 + 1] = sz - e.dir.z * back;
      }
      v.th = 0;
      v.wx = sx; v.wz = sz;
    }
    e.vis = v;
    return v;
  }

  // Trail ring: index th = most recent point; k steps back = (th + k) % N (we write backwards).
  function trailPush(v, x, z) {
    v.th = (v.th - 1 + TRAIL_N) % TRAIL_N;
    v.trail[v.th * 2] = x;
    v.trail[v.th * 2 + 1] = z;
  }
  function trailUpdate(v, hx, hz) {
    let px = v.trail[v.th * 2], pz = v.trail[v.th * 2 + 1];
    let dx = hx - px, dz = hz - pz;
    let d = Math.hypot(dx, dz);
    let guard = 0;
    while (d >= TRAIL_STEP && guard++ < 8) {
      px += (dx / d) * TRAIL_STEP;
      pz += (dz / d) * TRAIL_STEP;
      trailPush(v, px, pz);
      dx = hx - px; dz = hz - pz;
      d = Math.hypot(dx, dz);
    }
    if (d >= TRAIL_STEP) { trailPush(v, hx, hz); }
  }
  // Point at arc distance b behind the head -> _p.x/_p.z
  function trailAt(v, hx, hz, b) {
    const px = v.trail[v.th * 2], pz = v.trail[v.th * 2 + 1];
    const acc = Math.hypot(hx - px, hz - pz);
    if (b <= acc) {
      const f = acc > 1e-5 ? b / acc : 0;
      _p.x = hx + (px - hx) * f;
      _p.z = hz + (pz - hz) * f;
      return;
    }
    const r = (b - acc) / TRAIL_STEP;
    let k = Math.floor(r);
    if (k > TRAIL_N - 2) k = TRAIL_N - 2;
    const f = Math.min(1, r - k);
    const i0 = ((v.th + k) % TRAIL_N) * 2, i1 = ((v.th + k + 1) % TRAIL_N) * 2;
    _p.x = v.trail[i0] + (v.trail[i1] - v.trail[i0]) * f;
    _p.z = v.trail[i0 + 1] + (v.trail[i1 + 1] - v.trail[i0 + 1]) * f;
  }

  // -------------------------------------------------------------------------------------------
  function begin() {
    labelUsed.melissa = 0;
    labelUsed.iloveyou = 0;
  }

  function end() {
    const sm = ctx.view && ctx.view.renderer && ctx.view.renderer.shadowMap;
    blobMat.uniforms.uOpacity.value = sm && sm.enabled ? 0.26 : 0.42;
    for (const k in B) flush(B[k]);
    flush(blob);
    if (halo) flush(halo);
    flush(bars);
    for (const kind in labelPool) {
      const pool = labelPool[kind];
      for (let i = labelUsed[kind]; i < pool.length; i++) pool[i].visible = false;
    }
  }

  // Draw one enemy (alive, dying or leaking). t = simulation time.
  function draw(e, t) {
    const v = e.vis;
    if (!v) return;
    const def = e.def;
    let x = e.pos.x, z = e.pos.z, y = 0;
    let s = def.scale || 1;
    // fading hit flash: a tint, never a solid white silhouette (keeps each virus's colour identity under focus fire)
    let flash = v.flash > 0 ? 0.35 + 0.65 * Math.min(1, v.flash / FLASH_TIME) : 0;
    let boost = 0;
    let alpha = 1;

    // spawn: glitchy scale-in at the port
    if (v.spawnT < SPAWN_TIME) {
      const g = v.spawnT / SPAWN_TIME;
      const tick = Math.floor(v.spawnT * 24) + v.seed * 100;
      const jitter = hash(tick) < 0.55 ? 1 : 0;
      s *= Math.min(1, g * 1.25) * (1 + (hash(tick + 3) - 0.5) * 0.9 * jitter * (1 - g));
      x += (hash(tick + 7) - 0.5) * 0.35 * jitter * (1 - g);
      boost += (1 - g) * 1.6 * (0.4 + jitter);
      alpha = g;
    }
    // hop (split children / summoned worms): arc from origin to the path
    if (v.hopT > 0) {
      const k = 1 - v.hopT / v.hopDur;
      const ek = 1 - (1 - k) * (1 - k);
      x = v.hx + (x - v.hx) * ek;
      z = v.hz + (z - v.hz) * ek;
      y += Math.sin(k * Math.PI) * 0.55 * (def.boss ? 0.3 : 1);
    }
    let sx = 1, sy = 1;
    if (v.punch > 0) { sx = 1 + v.punch * 0.16; sy = 1 - v.punch * 0.14; }

    if (v.mode === 1) { // dying: pop then shrink
      const k = Math.min(1, v.modeT / DIE_TIME);
      x = v.dx; z = v.dz;
      s *= k < 0.3 ? 1 + k * 0.9 : 1.27 * (1 - (k - 0.3) / 0.7);
      flash = 1 - k * 0.6;
      boost += 0.4 * (1 - k);
      alpha = 1 - k;
    } else if (v.mode === 2) { // leaking: dive into the CPU
      const k = Math.min(1, v.modeT / LEAK_TIME);
      const cp = cpuPos();
      x = v.dx; z = v.dz;
      if (cp) { x += (cp.x - x) * k * k; z += (cp.z - z) * k * k; }
      y -= k * k * 0.5;
      s *= 1 - k * 0.85;
      boost += k * 1.2;
      alpha = 1 - k;
    } else {
      v.dx = x; v.dz = z;
    }
    if (s < 0.001) return;
    const slow = v.slowVis;
    const yaw = v.yaw + (v.mode === 2 ? v.modeT * 14 : 0);

    switch (def.model) {
      case 'worm': drawWorm(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t); break;
      case 'trojan': drawTrojan(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost); break;
      case 'macro':
      case 'macro_mini': drawPage(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t); break;
      case 'melissa': drawMelissa(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t); break;
      case 'iloveyou': drawLove(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t); break;
      default: drawPage(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t);
    }

    // ground blob shadow
    const br = (e.radius || 0.3) * (def.boss ? 1.25 : 1.35) * s * Math.max(0.4, 1 - y * 0.6);
    trsY(_m, x, 0.025, z, 0, br, br, br);
    _m.multiply(_m2.makeRotationX(-Math.PI / 2));
    put(blob, _m);

    // danger halo: virus colour glow on the board (bosses brighter, flares on hit, fades with spawn/death)
    if (halo) {
      const hr = (e.radius || 0.3) * 2.0 * s;
      trsY(_m, x, 0.03, z, 0, hr, 1, hr);
      const i = put(halo, _m);
      const k = ((def.boss ? 1.3 : 1) * 0.9 + 0.6 * Math.min(1, flash)) * alpha;
      _col.setHex(e.color != null ? e.color : def.color);
      const o = i * 3;
      halo.colArr[o] = _col.r * k; halo.colArr[o + 1] = _col.g * k; halo.colArr[o + 2] = _col.b * k;
    }

    // frost crystals around slowed viruses
    if (slow > 0.04 && v.mode === 0) {
      const r = (e.radius || 0.3) * 1.05 * s;
      const fs = slow * (def.boss ? 0.2 : 0.085) * Math.min(1.4, s + 0.3);
      for (let k = 0; k < 3; k++) {
        const a = t * 0.9 + k * (TAU / 3) + v.seed * TAU;
        trsE(_m, x + Math.sin(a) * r, 0.06 + fs * 0.6, z + Math.cos(a) * r, 0.35, a, 0.2, fs, fs, fs);
        put(B.frost, _m, 0, 1, 0.2, 0);
      }
    }

    // hp bar (only when damaged; bosses always)
    if (v.mode === 0 && (e.hp < e.maxHp || def.boss)) {
      const frac = Math.max(0, e.hp / e.maxHp);
      const w = def.barW || 0.6;
      const h = def.boss ? 0.15 : 0.1;
      const te = _m.identity().elements;
      te[0] = w; te[5] = h;
      te[12] = x; te[13] = (def.barY || 1) * (s / (def.scale || 1)) + y; te[14] = z;
      const i = slot(bars);
      _m.toArray(bars.mat, i * 16);
      const o = i * 4;
      bars.fxArr[o] = frac;
      bars.fxArr[o + 1] = Math.max(frac, v.barLag);
      bars.fxArr[o + 2] = def.barSegs || 8;
      bars.fxArr[o + 3] = Math.min(1, v.barA) * alpha;
    }
  }

  function drawWorm(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t) {
    // slither: head swings laterally, the body follows the head's real trail
    const phase = e.dist * 4.2 + v.seed * TAU;
    const wig = Math.sin(phase) * 0.09 * s;
    const px = Math.cos(v.yaw), pz = -Math.sin(v.yaw);
    // trail-consistent base position (the last alive spot when dying/leaking) + animation offset
    const bx = v.mode === 0 ? x : v.dx, bz = v.mode === 0 ? z : v.dz;
    const offx = x - bx, offz = z - bz;
    const hx = bx + px * wig, hz = bz + pz * wig;
    if (v.mode === 0) trailUpdate(v, hx, hz);
    const bob = Math.abs(Math.sin(phase * 2)) * 0.025;
    const headYaw = yaw + Math.cos(phase) * 0.35;
    trsE(_m, hx + offx, y + 0.2 * s + bob, hz + offz, -0.1, headYaw, Math.cos(phase) * 0.12, s * sx, s * sy, s * sx);
    put(B.wormHead, _m, flash, slow, boost, 0);
    for (let i = 0; i < WORM_SEGMENTS; i++) {
      const b = (0.16 + i * WORM_SPACING) * s;
      trailAt(v, hx, hz, b);
      const r = WORM_RADII[i] * s;
      const by = y + r + Math.abs(Math.sin(phase * 2 - (i + 1) * 0.9)) * 0.03;
      trsY(_m, _p.x + offx, by, _p.z + offz, yaw, r * sx, r * sy, r * sx);
      put(B.wormSeg, _m, flash, slow, boost, i % 2);
    }
  }

  function drawTrojan(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost) {
    const d = e.dist;
    const rock = Math.sin(d * 7.5 + v.seed * 6) * 0.07;
    const roll = Math.sin(d * 3.7 + v.seed * 4) * 0.045;
    const bounce = Math.abs(Math.sin(d * 7.5 + v.seed * 6)) * 0.025;
    trsE(_root, x, y + bounce, z, rock, yaw, roll, s * sx, s * sy, s * sx);
    put(B.trojan, _root, flash, slow, boost, 0);
    const ang = d / 0.1;
    for (let k = 0; k < 4; k++) {
      const wx = k < 2 ? -0.215 : 0.215;
      const wz = k % 2 ? 0.25 : -0.29;
      _m2.makeRotationX(ang + k);
      _m2.elements[12] = wx; _m2.elements[13] = 0.1; _m2.elements[14] = wz;
      _m.multiplyMatrices(_root, _m2);
      put(B.wheel, _m, flash, slow, boost, 0);
    }
  }

  function drawPage(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t) {
    const ph = t * 3 + v.seed * TAU;
    const bob = Math.sin(ph) * 0.06 * s + 0.05;
    const flutter = Math.sin(ph * 1.7) * 0.22;
    const pitch = -0.3 + Math.sin(ph * 1.3) * 0.08;
    const lift = 0.3 + 0.12 * s;
    trsE(_m, x, y + lift + bob, z, pitch, yaw + Math.sin(ph * 0.7) * 0.15, flutter, s * sx, s * sy, s * sx);
    put(B.page, _m, flash, slow, boost, 0);
  }

  function drawMelissa(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t) {
    const sa = e.def.splitAt;
    const lower = 1 + Math.max(0, (sa ? sa.thresholds.length : 2) - v.stage);
    const PS = 2.2 * s; // page scale
    const stomp = Math.abs(Math.sin(e.dist * 5 + t * 0.5)) * 0.07;
    const shake = v.flash > 0 ? (hash(t * 60) - 0.5) * 0.08 : 0;
    // the stack of pages walks along the path
    trsE(_root, x + shake, y + 0.12 + stomp * 0.5, z, 0, yaw, 0, sx, sy, sx);
    for (let k = 0; k < lower; k++) {
      trsE(_m2, (k % 2 ? 0.03 : -0.03) * PS, k * 0.06 * PS, 0, 0, (k % 2 ? 1 : -1) * 0.07 * (k + 1), 0, PS, PS, PS);
      _m.multiplyMatrices(_root, _m2);
      put(B.page, _m, flash, slow, boost, 0.3);
    }
    // the angry face page stands up and glares at the player (always readable), leaning into the walk
    const topY = y + 0.08 + lower * 0.06 * PS + 0.5 * s + stomp;
    const lean = Math.sin(yaw) * 0.35;
    const fs = PS * 1.12 * (1 + v.pulse * 0.08);
    trsE(_m, x + shake, topY, z + 0.1 * s, -1.05 + Math.sin(t * 2.2) * 0.05, Math.PI + lean + Math.sin(t * 1.3) * 0.06,
      Math.sin(t * 1.7) * 0.05 + shake, fs * sx, fs * sy, fs * sx);
    put(B.melissa, _m, flash, slow, boost + v.pulse, 0);
    // orbiting mail-merge pages
    if (v.mode === 0) {
      for (let k = 0; k < 3; k++) {
        const a = t * 1.6 + k * (TAU / 3);
        const r = 1.3 * s;
        trsE(_m, x + Math.sin(a) * r, y + 0.7 + Math.sin(t * 2.3 + k) * 0.18, z + Math.cos(a) * r, -0.5, a + Math.PI / 2, 0.45, 0.55 * s, 0.55 * s, 0.55 * s);
        put(B.page, _m, flash, slow, boost * 0.5, 0);
      }
      label('melissa', x, ((e.def.barY || 2) + 0.6) * s + y, z, Math.min(1, v.spawnT / SPAWN_TIME), t);
    }
  }

  function drawLove(e, v, x, y, z, s, sx, sy, yaw, flash, slow, boost, t) {
    // heartbeat: lub-dub, plus a swell before each worm summon (v.pulse 0..1)
    const bt = (t * 1.25) % 1;
    const beat = Math.exp(-Math.pow((bt - 0.1) * 14, 2)) + 0.6 * Math.exp(-Math.pow((bt - 0.32) * 14, 2));
    const pulse = (1 + beat * 0.09 + v.pulse * 0.16) * s;
    const bob = Math.sin(t * 1.8) * 0.08;
    // the heart faces the player (smug face always readable) and leans toward where it is going
    const lean = Math.sin(yaw) * 0.3;
    trsE(_m, x, y + 0.86 * s + bob, z, -0.82 + Math.sin(t * 1.3) * 0.05, lean, Math.sin(t * 0.9) * 0.08 - lean * 0.3,
      pulse * sx, pulse * sy, pulse * sx);
    put(B.heart, _m, flash, slow, boost + beat * 0.7 + v.pulse * 1.5, 0);
    // the love letter flutters ahead of it, along the path
    trsE(_root, x, y, z, 0, yaw, 0, s * sx, s * sy, s * sx);
    trsE(_m2, Math.sin(t * 2.1) * 0.06, 0.42 + Math.sin(t * 2.6 + 1) * 0.07, 0.95, -0.4, Math.sin(t * 1.4) * 0.2, Math.sin(t * 3) * 0.08,
      1.25 + v.pulse * 0.2, 1.25 + v.pulse * 0.2, 1.25 + v.pulse * 0.2);
    _m.multiplyMatrices(_root, _m2);
    put(B.envelope, _m, flash, slow, boost + v.pulse, 0);
    if (v.mode === 0) label('iloveyou', x, ((e.def.barY || 1.85) + 0.6) * s + y, z, Math.min(1, v.spawnT / SPAWN_TIME), t);
  }

  function reset() {
    for (const k in B) { B[k].n = 0; flush(B[k]); }
    blob.n = 0; flush(blob);
    if (halo) { halo.n = 0; flush(halo); }
    bars.n = 0; flush(bars);
    for (const kind in labelPool) for (const sp of labelPool[kind]) sp.visible = false;
  }

  return { root, batches: B, initVisual, begin, draw, end, reset, material: mat };
}
