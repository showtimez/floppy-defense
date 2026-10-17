// Virus paths rendered as wide gold PCB traces with an emissive "data flow" (comet packets that travel
// toward the CPU). One merged mesh for both paths; the shared tail is drawn once.
import * as THREE from 'three';
import { PALETTE } from '../config.js';

const TRACE_W = 0.66;
const TRACE_Y = 0.012;

// Build a mitred ribbon for a polyline. rem[i] = distance remaining to the CPU at point i.
function pushRibbon(pos, uv, rem, idx, pts, cum, total, upTo) {
  const base = pos.length / 3;
  let count = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (cum[i] > upTo + 1e-4) break;
    const p = pts[i];
    // averaged tangent with miter scaling
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d0x = p.x - a.x, d0z = p.z - a.z;
    let d1x = b.x - p.x, d1z = b.z - p.z;
    const l0 = Math.hypot(d0x, d0z) || 1, l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0; d0z /= l0; d1x /= l1; d1z /= l1;
    if (i === 0) { d0x = d1x; d0z = d1z; }
    if (i === n - 1) { d1x = d0x; d1z = d0z; }
    let tx = d0x + d1x, tz = d0z + d1z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const miter = 1 / Math.max(0.5, nx * -d1z + nz * d1x);
    const hw = (TRACE_W / 2) * miter;
    pos.push(p.x + nx * hw, TRACE_Y, p.z + nz * hw, p.x - nx * hw, TRACE_Y, p.z - nz * hw);
    uv.push(cum[i], 1, cum[i], 0);
    rem.push(total - cum[i], total - cum[i]);
    if (count > 0) {
      const k = base + (count - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    count++;
  }
}

export function createTraceMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uSpacing: { value: 2.6 },
    uFlowColor: { value: new THREE.Color(PALETTE.phosphor) },
    uIntensity: { value: 1.2 },
    uDanger: { value: 0 },
    uPulse: { value: 0 },
    uBeat: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8823f,
    roughness: 0.34,
    metalness: 0.45,
    emissive: 0x000000,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRem;\nvarying float vRem;\nvarying vec2 vTUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRem = aRem;\nvTUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uSpacing; uniform vec3 uFlowColor; uniform float uIntensity; uniform float uDanger; uniform float uPulse; uniform float uBeat;
varying float vRem; varying vec2 vTUv;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float tSide = abs(vTUv.y * 2.0 - 1.0);
// rounded copper profile: darker towards the edges, bright rim highlight
float tEdge = smoothstep(0.72, 1.0, tSide);
diffuseColor.rgb *= mix(1.0, 0.42, tEdge);
diffuseColor.rgb += vec3(0.10, 0.07, 0.02) * (1.0 - smoothstep(0.0, 0.5, tSide));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float s = vRem + uTime;
  float f = fract(s / uSpacing);
  // comet packet: sharp leading edge toward the CPU, fading tail
  float head = smoothstep(0.0, 0.025, f);
  float comet = head * pow(1.0 - f, 4.0);
  float bits = 0.35 + 0.65 * step(0.42, fract(s * 6.0 / uSpacing));
  float core = 1.0 - smoothstep(0.16, 0.34, tSide);
  float rim = smoothstep(0.80, 0.9, tSide) * (1.0 - smoothstep(0.95, 1.0, tSide));
  float nearCpu = 1.0 + 1.6 * (1.0 - smoothstep(0.0, 4.0, vRem));
  vec3 flow = uFlowColor * (comet * bits * core * 2.4 + core * 0.10 + rim * (0.18 + comet * 0.6)) * uIntensity * nearCpu;
  // danger: slow red heartbeat along the whole trace
  flow += vec3(1.0, 0.08, 0.04) * uDanger * core * (0.25 + 0.25 * sin(uBeat - vRem * 0.8));
  flow += uFlowColor * uPulse * core * 1.5;
  totalEmissiveRadiance += flow + vec3(0.035, 0.024, 0.008);
}`);
  };
  mat.customProgramCacheKey = () => 'fd-trace-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

// paths: [{ points: Vector3[], cum: number[], length }]
export function buildTraces(paths, sharedStart) {
  const pos = [], uv = [], rem = [], idx = [];
  paths.forEach((p, i) => {
    const upTo = i === 0 ? p.length : Math.min(p.length, sharedStart[i] + 0.02);
    pushRibbon(pos, uv, rem, idx, p.points, p.cum, p.length, upTo);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aRem', new THREE.Float32BufferAttribute(rem, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = createTraceMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'world:traces';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return { mesh, material: mat, uniforms: mat.userData.uniforms };
}

// Distance along path i at which it joins path 0 for good (start of the shared tail), or its length.
export function findSharedStart(paths) {
  const out = [paths[0]?.length ?? 0];
  const a = paths[0];
  for (let i = 1; i < paths.length; i++) {
    const b = paths[i];
    let ia = a.points.length - 1, ib = b.points.length - 1;
    while (ia >= 0 && ib >= 0 && a.points[ia].distanceToSquared(b.points[ib]) < 1e-6) { ia--; ib--; }
    out.push(b.cum[Math.min(b.points.length - 1, ib + 1)]);
  }
  return out;
}
