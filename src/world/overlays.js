// Dynamic board overlays: slot hover/selection markers, tower range disc, heat haze + component glow,
// CPU die shader, LED sprites. All shaders are tiny and allocation-free per frame.
import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trapezoidPath } from './geom.js';

const DISC_VS = `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// ---- range disc: translucent fill, crisp anti-aliased ring, dashed inner ring, radar sweep ---------------
export function createRangeDisc() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(PALETTE.phosphor) },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uRadius: { value: 3 },
    },
    vertexShader: DISC_VS,
    fragmentShader: `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uRadius;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float px = fwidth(r);
  float ringW = 0.035 / uRadius;
  float ring = 1.0 - smoothstep(ringW, ringW + px * 1.5, abs(r - (1.0 - ringW - px)));
  float inside = 1.0 - smoothstep(1.0 - ringW * 2.0 - px, 1.0 - ringW * 2.0, r);
  float fill = (0.11 + 0.2 * pow(r, 3.0)) * inside;
  float ang = atan(vUv.y, vUv.x);
  float sw = fract(ang / 6.2831853 + uTime * 0.45);
  float sweep = pow(sw, 10.0) * 0.32 * inside;
  float dashR = 1.0 - 0.18 / uRadius;
  float dash = step(0.5, fract(ang * 24.0 / 6.2831853 - uTime * 0.6)) * (1.0 - smoothstep(0.0, px * 1.5 + 0.006, abs(r - dashR))) * 0.45;
  float grid = 0.0;
  vec2 g = abs(fract(vUv * uRadius * 1.0) - 0.5);
  grid = (1.0 - smoothstep(0.0, px * uRadius * 1.5 + 0.01, min(g.x, g.y))) * 0.05 * inside;
  float a = fill + sweep + dash + grid + ring;
  vec3 col = uColor * (0.9 + ring * 1.4 + sweep);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity);
}`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.03;
  mesh.renderOrder = 5;
  mesh.visible = false;
  mesh.name = 'world:range';
  return mesh;
}

// ---- slot marker: square outline on the board + animated corner brackets ------------------------------------
function frameGeometry(h, t, y) {
  const g = [];
  const quad = (x0, z0, x1, z1) => {
    const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    p.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    g.push(p);
  };
  quad(-h - t, -h - t, h + t, -h);
  quad(-h - t, h, h + t, h + t);
  quad(-h - t, -h, -h, h);
  quad(h, -h, h + t, h);
  return g;
}

function bracketGeometry(h, arm, t, y) {
  const parts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = new THREE.PlaneGeometry(arm, t).rotateX(-Math.PI / 2);
    a.translate(sx * (h - arm / 2), y, sz * (h - t / 2));
    const b = new THREE.PlaneGeometry(t, arm - t).rotateX(-Math.PI / 2);
    b.translate(sx * (h - t / 2), y, sz * (h - t - (arm - t) / 2));
    parts.push(a, b);
  }
  return parts;
}

function merge(list) {
  // tiny local merge (positions + uvs only, all PlaneGeometries)
  let n = 0;
  for (const g of list) n += g.index.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const p = g.attributes.position, idx = g.index;
    for (let i = 0; i < idx.count; i++) {
      const k = idx.getX(i);
      pos[o++] = p.getX(k); pos[o++] = p.getY(k); pos[o++] = p.getZ(k);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeBoundingSphere();
  return out;
}

export function createSlotMarker(color, { brackets = false } = {}) {
  const group = new THREE.Group();
  group.name = brackets ? 'world:selected' : 'world:hover';
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(brackets ? 2.2 : 2.0),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const frame = new THREE.Mesh(merge(frameGeometry(0.52, brackets ? 0.045 : 0.07, 0.02)), mat);
  frame.renderOrder = 6;
  group.add(frame);
  // hover only: faint additive wash over the bay top, so the hovered socket reads at 1x without zoom
  let fill = null;
  if (!brackets) {
    const fillMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    fill = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), fillMat);
    fill.position.y = 0.17;
    fill.renderOrder = 6;
    group.add(fill);
  }
  let br = null;
  if (brackets) {
    br = new THREE.Mesh(merge(bracketGeometry(0.66, 0.24, 0.06, 0.03)), mat);
    br.renderOrder = 6;
    group.add(br);
    // short vertical posts on the bracket corners, readable even when a floppy covers the socket
    const posts = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = new THREE.PlaneGeometry(0.06, 0.34);
      p.translate(0, 0.17, 0);
      const q = p.clone().rotateY(Math.PI / 2);
      p.translate(sx * 0.66, 0.03, sz * 0.66);
      q.translate(sx * 0.66, 0.03, sz * 0.66);
      posts.push(p, q);
    }
    const postMat = mat.clone();
    postMat.side = THREE.DoubleSide;
    postMat.opacity = 0.55;
    const pm = new THREE.Mesh(merge(posts), postMat);
    pm.renderOrder = 6;
    br.add(pm);
  }
  group.visible = false;
  return { group, frame, fill, brackets: br, material: mat };
}

// ---- heat: ground haze disc + glowing component overlay -----------------------------------------------------
export function createHeatHaze(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uOver: { value: 0 }, uTime: { value: 0 } },
    vertexShader: DISC_VS,
    fragmentShader: `
uniform float uLevel; uniform float uOver; uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float ang = atan(vUv.y, vUv.x);
  float wob = sin(ang * 5.0 + uTime * 1.3) * 0.6 + sin(ang * 9.0 - uTime * 2.1) * 0.4;
  float waves = 0.5 + 0.5 * sin(r * 20.0 - uTime * (3.0 + uOver * 4.0) + wob * 1.4);
  float body = pow(1.0 - r, 1.4);
  float edge = 1.0 - smoothstep(0.0, 0.03, abs(r - 0.965));
  float dash = step(0.5, fract(ang * 16.0 / 6.2831853 + uTime * 0.25));
  vec3 warm = mix(vec3(1.0, 0.55, 0.08), vec3(1.0, 0.12, 0.04), clamp(uLevel * 0.6 + uOver, 0.0, 1.0));
  float beat = 0.75 + 0.25 * sin(uTime * (4.0 + uOver * 8.0));
  float a = uLevel * (body * (0.35 + 0.45 * waves) * 0.55 + edge * dash * (0.35 + 0.65 * uOver) * beat);
  gl_FragColor = vec4(warm * a * 1.6, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.025;
  mesh.renderOrder = 4;
  mesh.visible = false;
  return mesh;
}

export function createHeatGlow(w, d) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uOver: { value: 0 }, uTime: { value: 0 }, uSize: { value: new THREE.Vector2(w, d) } },
    vertexShader: DISC_VS,
    fragmentShader: `
uniform float uLevel; uniform float uOver; uniform float uTime; uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec2 p = abs(vUv) * uSize * 0.5;
  vec2 hs = uSize * 0.5 - 0.22;
  float d = length(max(p - hs, 0.0));
  float glow = exp(-d * 7.0);
  float core = 1.0 - smoothstep(0.0, 0.05, d);
  float shimmer = 0.75 + 0.25 * sin(uTime * 7.0 + (vUv.x * uSize.x + vUv.y * uSize.y) * 3.0);
  float beat = 0.7 + 0.3 * sin(uTime * (3.0 + uOver * 9.0));
  vec3 col = mix(vec3(1.0, 0.45, 0.06), vec3(1.0, 0.1, 0.03), clamp(uLevel * 0.5 + uOver * 0.8, 0.0, 1.0));
  float a = uLevel * (core * 0.45 * shimmer + glow * 0.55) * beat;
  gl_FragColor = vec4(col * a * 1.8, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, d + 0.5).rotateX(-Math.PI / 2), mat);
  mat.uniforms.uSize.value.set(w + 0.5, d + 0.5);
  mesh.renderOrder = 4;
  mesh.visible = false;
  return mesh;
}

// ---- CPU die: emissive circuit pattern tinted by integrity, scanline shimmer, cracks, hit flash -------------
export function createDieMaterial(dieTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDie: { value: dieTex },
      uColor: { value: new THREE.Color(PALETTE.phosphor) },
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uCrack: { value: 0 },
      uHit: { value: 0 },
      uFlicker: { value: 1 },
    },
    vertexShader: `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
uniform sampler2D uDie; uniform vec3 uColor; uniform float uTime; uniform float uIntensity; uniform float uCrack;
uniform float uHit; uniform float uFlicker;
varying vec2 vUv;
float crackAt(vec2 uv) {
  float g = texture2D(uDie, uv).g;
  return g > 0.02 ? step(1.0 - g, uCrack) : 0.0;
}
void main() {
  vec4 d = texture2D(uDie, vUv);
  float pattern = d.r;
  float frame = d.b;
  float scan = 0.5 + 0.5 * sin(vUv.y * 60.0 - uTime * 5.0);
  float sweep = smoothstep(0.92, 1.0, 1.0 - abs(fract(vUv.y - uTime * 0.18) - 0.5) * 2.0);
  float pulse = 0.82 + 0.18 * sin(uTime * 2.2);
  vec3 col = uColor * (0.06 + pattern * 3.2 * (0.82 + 0.18 * scan) + sweep * 0.35) * pulse * uIntensity * uFlicker;
  col = mix(col, vec3(2.4, 0.25, 0.12), uHit * (0.35 + pattern * 1.5));
  col *= 1.0 - frame * 0.85;
  float c = crackAt(vUv);
  float e = 1.0 / 256.0 * 1.5;
  float around = max(max(crackAt(vUv + vec2(e, 0.0)), crackAt(vUv - vec2(e, 0.0))), max(crackAt(vUv + vec2(0.0, e)), crackAt(vUv - vec2(0.0, e))));
  col = mix(col, vec3(2.2, 0.55, 0.12) * (0.7 + 0.3 * sin(uTime * 13.0)), (1.0 - c) * around * step(0.001, uCrack));
  col = mix(col, vec3(0.0), c);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

// ---- LEDs: tiny unlit bodies + additive halo sprites (bloom-independent glow) ------------------------------
export function createLeds(count) {
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.1, 0.06, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    count,
  );
  body.name = 'world:leds';
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  const haloTex = new THREE.CanvasTexture(cv);
  const halo = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    count,
  );
  halo.name = 'world:ledHalos';
  halo.renderOrder = 7;
  body.frustumCulled = false;
  halo.frustumCulled = false;
  return { body, halo };
}

// ---- live serial ports: amber glow on the DB-9 D-shell top + its COM silkscreen label -----------------------
// One draw call for every port: shell rings + label quads share a tiny CanvasTexture (labels + a solid block);
// a per-vertex port index picks the port's intensity from uAmt (vec4, up to 4 ports).
// ports: [{ name, pos }]   labels: [{ text, x, z, size, align }] (silkscreen entries, world units)
export function createPortGlow(ports, labels) {
  const W = 512, H = 256, K = 128, ROW = 96; // K = canvas px per world unit
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.fillRect(300, 24, 160, 48); // solid block (shell rings sample its centre)
  const solidU = 380 / W, solidV = 1 - 48 / H;
  const geos = [];
  const tag = (geo, port, uvFn) => {
    geo.deleteAttribute('normal');
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uvFn(uv, i);
    geo.setAttribute('aPort', new THREE.Float32BufferAttribute(new Float32Array(uv.count).fill(port), 1));
    geos.push(geo);
  };
  ports.slice(0, 4).forEach((pt, i) => {
    // D-shell top ring (same footprint/orientation as board.js serial ports), a hair wider than the metal
    const outer = trapezoidPath(1.62, 1.34, 0.72, 0.14);
    outer.holes.push(trapezoidPath(1.34, 1.08, 0.48, 0.07, THREE.Path));
    const ring = new THREE.ShapeGeometry(outer, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
    ring.translate(pt.pos.x + 0.1, 0.548, pt.pos.z);
    tag(ring, i, (uv, k) => uv.setXY(k, solidU, solidV));
    // COM label: same font metrics as the PCB silkscreen (pcbTexture text()), glow halo baked by shadowBlur
    const lb = labels.find((l) => l && l.text === pt.name);
    if (!lb || i > 1) return;
    const y0 = i * ROW;
    const px = Math.max(8, lb.size * 1.32 * K);
    const align = lb.align || 'center';
    const ax = align === 'left' ? 16 : align === 'right' ? 240 : 128;
    g.save();
    g.font = `bold ${px}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(255,255,255,0.95)';
    g.shadowBlur = 16;
    g.fillText(lb.text, ax, y0 + ROW / 2);
    g.shadowBlur = 6;
    g.fillText(lb.text, ax, y0 + ROW / 2);
    g.restore();
    const pw = 256 / K, ph = ROW / K;
    const quad = new THREE.PlaneGeometry(pw, ph).rotateX(-Math.PI / 2);
    // anchor the canvas text point (ax, row middle) onto the silkscreen anchor (lb.x, lb.z)
    quad.translate(lb.x + (pw / 2 - ax / K), 0.02, lb.z);
    const u0 = 0, u1 = 256 / W, v0 = 1 - (y0 + ROW) / H, v1 = 1 - y0 / H;
    tag(quad, i, (uv, k) => uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0)));
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = (geos.length && mergeGeometries(geos, false)) || new THREE.BufferGeometry();
  for (const gg of geos) gg.dispose();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Color(PALETTE.amber) }, uAmt: { value: new THREE.Vector4(0, 0, 0, 0) } },
    vertexShader: `
attribute float aPort;
uniform vec4 uAmt;
varying vec2 vUv; varying float vAmt;
void main() {
  vUv = uv;
  vAmt = dot(uAmt, vec4(equal(vec4(aPort), vec4(0.0, 1.0, 2.0, 3.0))));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform sampler2D uMap; uniform vec3 uColor;
varying vec2 vUv; varying float vAmt;
void main() {
  float a = texture2D(uMap, vUv).a * vAmt;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'world:portGlow';
  mesh.renderOrder = 7;
  mesh.visible = false;
  return { mesh, amt: mat.uniforms.uAmt.value };
}
