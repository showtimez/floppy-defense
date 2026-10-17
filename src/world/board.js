// Static motherboard: PCB plane, components (merged by material), case rim, connectors, CPU, fan.
// Returns the meshes plus references to the few animated parts.
import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { createBuilder, roundedRectShape, trapezoidPath } from './geom.js';

const CAP_COLORS = { blue: 0x1f3fa8, black: 0x1a1a1e, purple: 0x4a2a7a, green: 0x1f6a3a };
const WIRE = { red: 0xc0282a, black: 0x151515, yellow: 0xe2c22a, orange: 0xe07a1f, blue: 0x2a54c8, white: 0xe8e8e8 };

export function createBoardMaterials(atlas, quality) {
  const m = {
    plastic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 }),
    label: new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.5, metalness: 0.02 }),
  };
  m.metal.envMapIntensity = 1.2;
  void quality;
  return m;
}

// Builder helper: textured quad (PlaneGeometry faces +Z) rotated sequentially about X, then Y, then Z.
function labelEuler(B, key, region, w, h, x, y, z, rx, ry = 0, rz = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, region.u0 + uv.getX(i) * (region.u1 - region.u0), region.v0 + uv.getY(i) * (region.v1 - region.v0));
  }
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  B.add(key, g, 0xffffff, x, y, z);
  g.dispose();
}

// Centred cylinder lying along an axis.
function rod(B, key, color, r, len, x, y, z, axis = 'x', seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  B.add(key, g, color, x, y, z);
  g.dispose();
}

function labelCircle(B, key, region, r, x, y, z) {
  const g = new THREE.CircleGeometry(r, 28);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, region.u0 + uv.getX(i) * (region.u1 - region.u0), region.v0 + uv.getY(i) * (region.v1 - region.v0));
  }
  B.add(key, g, 0xffffff, x, y, z, -Math.PI / 2, 0, 0);
  g.dispose();
}

function legs(B, x, z, len, n, side, axis = 'x', y = 0.0) {
  // DIP / QFP legs: little bent metal tabs along an edge
  for (let k = 0; k < n; k++) {
    const t = -len / 2 + (len / n) * (k + 0.5);
    if (axis === 'x') B.box('metal', 0xbfc4c9, 0.045, 0.06, 0.12, x + t, y, z + side);
    else B.box('metal', 0xbfc4c9, 0.12, 0.06, 0.045, x + side, y, z + t);
  }
}

function screwHead(B, x, y, z, r = 0.16) {
  B.cyl('metal', 0xc9ced3, r, r * 1.05, 0.06, x, y, z, 12);
  B.box('plastic', 0x2a2a2a, r * 1.5, 0.012, r * 0.28, x, y + 0.06, z, 0.4);
  B.box('plastic', 0x2a2a2a, r * 0.28, 0.012, r * 1.5, x, y + 0.06, z, 0.4);
}

export function buildBoard(ctx, layout, atlas, pcb, mats) {
  const B = createBuilder();
  const R = atlas.regions;
  const out = { meshes: [], refs: {} };

  // ---- PCB plane --------------------------------------------------------------------------------------
  const pcbMat = new THREE.MeshStandardMaterial({
    map: pcb.map,
    roughnessMap: pcb.surf,
    metalnessMap: pcb.surf,
    bumpMap: pcb.surf,
    bumpScale: 2.2,
    roughness: 1,
    metalness: 1,
  });
  // living board: tiny signal packets running along the decorative traces (see pcbTexture signal map)
  const sigU = { uSig: { value: pcb.signal }, uSigT: { value: 0 }, uSigAmt: { value: 0.7 }, uSigCol: { value: new THREE.Color(PALETTE.phosphor) } };
  if (pcb.signal) {
    pcbMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, sigU);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uSig; uniform float uSigT; uniform float uSigAmt; uniform vec3 uSigCol;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec4 sgn = texture2D(uSig, vMapUv);
  float head = pow(fract(sgn.r - uSigT), 18.0);
  totalEmissiveRadiance += uSigCol * (sgn.g * head * uSigAmt * 2.2);
}`);
    };
    pcbMat.customProgramCacheKey = () => 'fd-pcb-signal-v1';
  }
  out.refs.pcbSignal = sigU;
  const maxAniso = ctx.view?.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  pcb.map.anisotropy = Math.min(8, maxAniso);
  pcb.surf.anisotropy = Math.min(8, maxAniso);
  const pcbMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 15).rotateX(-Math.PI / 2), pcbMat);
  pcbMesh.name = 'world:pcb';
  pcbMesh.receiveShadow = true;
  out.meshes.push(pcbMesh);
  out.refs.pcbMaterial = pcbMat;

  // PCB edge (thickness) visible inside the case recess
  B.box('plastic', 0x0a2a1b, 24.0, 0.08, 15.0, 0, -0.08, 0);

  // ---- case: metal tray, beige rim with bevel and screws, front panel -----------------------------------------
  const beige = PALETTE.beige, beigeDark = PALETTE.beigeDark;
  B.box('plastic', 0x55524a, 70, 0.05, 50, 0, -0.3, 0); // tray / far floor
  const rimH = 0.34;
  const rim = (x, z, w, d) => {
    B.box('plastic', beigeDark, w, 0.47, d, x, -0.27, z);
    B.box('plastic', beige, w - 0.12, 0.14, d - 0.12, x, rimH - 0.14, z);
  };
  // left / right / top / bottom (bottom = front panel strip, wider)
  rim(-12.75, 0.0, 1.4, 18.6);
  rim(12.75, 0.0, 1.4, 18.6);
  rim(0, -8.4, 24.1, 1.7);
  rim(0, 8.3, 24.1, 1.5);
  // vent slots on the top rim
  for (let k = 0; k < 26; k++) B.box('plastic', 0x6f6858, 0.12, 0.012, 0.9, -6 + k * 0.48, rimH, -8.45);
  // case screws on the rim
  for (const [x, z] of [[-12.75, -8.4], [12.75, -8.4], [-12.75, 8.62], [12.75, 8.62], [-12.75, 0], [12.75, 0]]) screwHead(B, x, rimH - 0.02, z, 0.17);
  // front panel: display recess, turbo button, power button, badge
  B.box('plastic', 0x2a2824, 1.7, 0.012, 0.8, 6.2, rimH, 8.12);
  B.box('plastic', 0xcfc6aa, 0.9, 0.06, 0.5, 2.6, rimH, 8.12);
  B.box('plastic', 0xb6ad92, 0.62, 0.05, 0.32, 2.6, rimH + 0.06, 8.12);
  B.cyl('plastic', 0xcfc6aa, 0.34, 0.36, 0.08, -2.2, rimH, 8.12, 20);
  B.cyl('plastic', 0xbdb397, 0.26, 0.28, 0.05, -2.2, rimH + 0.08, 8.12, 20);
  B.box('metal', 0xb9bec4, 3.3, 0.02, 0.86, -7.5, rimH, 8.12);
  B.label('label', R.badge, 3.2, 0.8, -7.5, rimH + 0.022, 8.12);

  // ---- PCB corner screws (brass standoffs + heads) -------------------------------------------------------
  for (const [x, z] of layout.screws) {
    B.cyl('metal', 0xc8a250, 0.22, 0.24, 0.05, x, 0, z, 12);
    screwHead(B, x, 0.05, z, 0.15);
  }

  // ---- serial ports (DB-9 lying face-up on the left edge) -----------------------------------------------------
  const shellRing = (() => {
    const outer = trapezoidPath(1.5, 1.22, 0.62, 0.1);
    outer.holes.push(trapezoidPath(1.34, 1.08, 0.48, 0.07, THREE.Path));
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.16, bevelEnabled: false, curveSegments: 3 });
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  for (const pt of layout.ports) {
    const x = pt.pos.x + 0.1, z = pt.pos.z;
    B.box('plastic', 0x18181b, 0.9, 0.34, 2.0, x, 0, z);               // body
    B.box('metal', 0xaeb4ba, 1.0, 0.04, 2.3, x, 0.34, z);              // flange
    B.add('metal', shellRing, 0xd0d5da, x, 0.38, z, 0, Math.PI / 2, 0); // D shell
    labelEuler(B, 'label', R.db9, 1.2, 0.44, x, 0.47, z, -Math.PI / 2, Math.PI / 2, 0);
    for (const s of [-1, 1]) {
      B.cyl('metal', 0xc2c7cc, 0.1, 0.1, 0.22, x, 0.38, z + s * 0.95, 6);
      B.cyl('metal', 0x5d6266, 0.045, 0.045, 0.23, x, 0.38, z + s * 0.95, 8);
    }
  }

  // ---- components ------------------------------------------------------------------------------------------
  const heatParts = {}; // spotId -> [{ x, z, w, d, y }]
  const addHeat = (id, part) => { if (!id) return; (heatParts[id] ||= []).push(part); };

  for (const cp of layout.comps) {
    const { x, z } = cp;
    switch (cp.type) {
      case 'ram': {
        const tilt = -1.0; // radians (lean back, chips facing the camera)
        const h = 0.6, len = cp.len;
        for (let k = 0; k < (cp.sticks || 4); k++) {
          const bz = z - 0.46 + k * 0.42;
          B.box('plastic', 0xe8e1cc, len + 0.3, 0.16, 0.2, x, 0, bz);
          B.box('metal', 0xc5cad0, 0.12, 0.26, 0.24, x - len / 2 - 0.14, 0, bz);
          B.box('metal', 0xc5cad0, 0.12, 0.26, 0.24, x + len / 2 + 0.14, 0, bz);
          // module: PCB tilted about X
          const ct = Math.cos(tilt), st = Math.sin(tilt);
          const off = (ly, lz) => [0.12 + ly * ct - lz * st, bz + ly * st + lz * ct];
          const [my, mz] = off(h / 2, 0);
          B.add('plastic', new THREE.BoxGeometry(len, h, 0.035), 0x1e6a3c, x, my, mz, tilt, 0, 0);
          const [gy, gz] = off(0.05, 0.02);
          B.add('metal', new THREE.BoxGeometry(len - 0.2, 0.07, 0.01), 0xe2b453, x, gy, gz, tilt, 0, 0);
          for (let c = 0; c < 8; c++) {
            const cx = x - len / 2 + 0.5 + c * ((len - 1.0) / 7);
            const [cy, cz] = off(0.33, 0.04);
            B.add('plastic', new THREE.BoxGeometry(0.62, 0.3, 0.05), 0x161618, cx, cy, cz, tilt, 0, 0);
            const [ly, lz] = off(0.33, 0.066);
            labelEuler(B, 'label', R.simmChip, 0.58, 0.27, cx, ly, lz, tilt);
          }
          // white sticker on the first module
          if (k === (cp.sticks || 4) - 1) {
            const [sy, sz] = off(0.33, 0.04);
            B.add('plastic', new THREE.BoxGeometry(0.5, 0.26, 0.012), 0xf0eee6, x + len / 2 - 0.35, sy, sz, tilt, 0, 0);
          }
        }
        addHeat(cp.heat, { x, z: z + 0.15, w: len + 0.2, d: 1.8, y: 0.62 });
        break;
      }
      case 'chipset': {
        const s = cp.size;
        B.box('plastic', 0x19191c, s, 0.1, s, x, 0.02, z);
        legs(B, x, z, s - 0.2, 12, -s / 2 - 0.05, 'x', 0.0);
        legs(B, x, z, s - 0.2, 12, s / 2 + 0.05, 'x', 0.0);
        legs(B, x, z, s - 0.2, 12, -s / 2 - 0.05, 'z', 0.0);
        legs(B, x, z, s - 0.2, 12, s / 2 + 0.05, 'z', 0.0);
        B.box('plastic', 0x777a80, s * 0.8, 0.02, s * 0.8, x, 0.12, z);
        B.box('metal', 0xb8bec5, s * 0.86, 0.07, s * 0.86, x, 0.14, z);
        const n = 5, pitch = (s * 0.86 - 0.14) / (n - 1);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          B.box('metal', 0xc9ced4, 0.13, 0.3, 0.13, x - (s * 0.86 - 0.14) / 2 + i * pitch, 0.21, z - (s * 0.86 - 0.14) / 2 + j * pitch);
        }
        addHeat(cp.heat, { x, z, w: s, d: s, y: 0.52 });
        break;
      }
      case 'qfp': {
        const s = cp.size;
        B.box('plastic', 0x19191c, s, 0.1, s, x, 0.02, z);
        legs(B, x, z, s - 0.16, 14, -s / 2 - 0.05, 'x');
        legs(B, x, z, s - 0.16, 14, s / 2 + 0.05, 'x');
        legs(B, x, z, s - 0.16, 14, -s / 2 - 0.05, 'z');
        legs(B, x, z, s - 0.16, 14, s / 2 + 0.05, 'z');
        B.label('label', R.vgaTop, s - 0.04, s - 0.04, x, 0.122, z);
        addHeat(cp.heat, { x, z, w: s, d: s, y: 0.13 });
        break;
      }
      case 'vrm': {
        const n = cp.n || 5, span = 3.4;
        // heatsink bar at the back (toward the CPU) with fins facing the camera side
        B.box('metal', 0xb3b9c0, span + 0.3, 0.62, 0.16, x, 0, z - 0.2);
        for (let k = 0; k < 9; k++) B.box('metal', 0xc2c8ce, 0.05, 0.58, 0.22, x - span / 2 + k * (span / 8), 0.02, z - 0.39);
        for (let k = 0; k < n; k++) {
          const mx = x - span / 2 + 0.3 + k * ((span - 0.6) / (n - 1));
          B.box('metal', 0xd0d5da, 0.42, 0.58, 0.03, mx, 0.02, z - 0.1);
          B.box('plastic', 0x161618, 0.42, 0.44, 0.15, mx, 0.06, z + 0.0);
          labelEuler(B, 'label', R.mosfet, 0.38, 0.2, mx, 0.36, z + 0.077, 0);
          for (const lx of [-0.12, 0, 0.12]) B.box('metal', 0xbfc4c9, 0.04, 0.08, 0.2, mx + lx, 0, z + 0.12);
        }
        addHeat(cp.heat, { x, z: z - 0.1, w: span + 0.4, d: 0.9, y: 0.66 });
        break;
      }
      case 'bios': {
        B.box('plastic', 0x19191c, 1.6, 0.12, 0.6, x, 0.03, z);
        legs(B, x, z, 1.6, 16, -0.33, 'x');
        legs(B, x, z, 1.6, 16, 0.33, 'x');
        out.refs.biosSticker = { x, y: 0.152, z, w: 1.05, d: 0.48 };
        break;
      }
      case 'battery': {
        B.cyl('plastic', 0x1c1c1f, 0.5, 0.52, 0.05, x, 0, z, 24);
        B.cyl('metal', 0xd4d9de, 0.42, 0.42, 0.08, x, 0.05, z, 28);
        labelCircle(B, 'label', R.battery, 0.4, x, 0.131, z);
        B.box('metal', 0xc0c5ca, 0.14, 0.03, 0.9, x + 0.32, 0.12, z);
        break;
      }
      case 'isa': {
        const white = cp.color === 'white';
        B.box('plastic', white ? 0xefe9d8 : 0x151517, cp.len, 0.22, 0.34, x, 0, z);
        B.label('label', white ? R.pciTop : R.isaTop, cp.len - 0.02, 0.32, x, 0.222, z);
        B.box('plastic', white ? 0xefe9d8 : 0x151517, 0.12, 0.26, 0.38, x - cp.len / 2 + 0.06, 0, z);
        B.box('plastic', white ? 0xefe9d8 : 0x151517, 0.12, 0.26, 0.38, x + cp.len / 2 - 0.06, 0, z);
        break;
      }
      case 'din': {
        B.box('plastic', 0x18181b, 1.0, 0.28, 1.0, x + 0.1, 0, z);
        B.cyl('metal', 0xc4c9ce, 0.48, 0.5, 0.18, x, 0.28, z, 24);
        labelCircle(B, 'label', R.din, 0.4, x, 0.462, z);
        break;
      }
      case 'power': {
        for (const [k, cols] of [[0, ['orange', 'red', 'yellow', 'blue', 'black', 'black']], [1, ['black', 'black', 'white', 'red', 'red', 'red']]]) {
          const bx = x - 0.24 + k * 0.48;
          B.box('plastic', 0xefe9d8, 0.44, 0.34, 1.36, bx, 0, z);
          labelEuler(B, 'label', R.powerTop, 1.3, 0.4, bx, 0.342, z, -Math.PI / 2, Math.PI / 2, 0);
          cols.forEach((c, i) => {
            const wz = z - 0.55 + i * 0.22;
            rod(B, 'gloss', WIRE[c], 0.05, 2.5, bx - 1.25, 0.4, wz, 'x', 6);
          });
        }
        break;
      }
      case 'crystal': {
        B.box('metal', 0xd2d7dc, 0.66, 0.2, 0.26, x, 0, z);
        B.cyl('metal', 0xd2d7dc, 0.13, 0.13, 0.2, x - 0.33, 0, z, 10);
        B.cyl('metal', 0xd2d7dc, 0.13, 0.13, 0.2, x + 0.33, 0, z, 10);
        B.label('label', R.crystal, 0.62, 0.22, x, 0.202, z);
        break;
      }
      case 'dip': {
        const vert = !!cp.rot;
        const w = vert ? 0.4 : cp.len, d = vert ? cp.len : 0.4;
        B.box('plastic', 0x19191c, w, 0.1, d, x, 0.03, z);
        if (vert) { legs(B, x, z, cp.len, cp.pins, -0.23, 'z'); legs(B, x, z, cp.len, cp.pins, 0.23, 'z'); }
        else { legs(B, x, z, cp.len, cp.pins, -0.23, 'x'); legs(B, x, z, cp.len, cp.pins, 0.23, 'x'); }
        const reg = cp.label === 'U12' ? R.dip1 : R.dip0;
        labelEuler(B, 'label', reg, cp.len - 0.04, 0.36, x, 0.132, z, -Math.PI / 2, vert ? Math.PI / 2 : 0, 0);
        break;
      }
      case 'fanHeader': {
        B.box('plastic', 0xefe9d8, 0.46, 0.16, 0.22, x, 0, z);
        for (let k = 0; k < 3; k++) B.box('metal', 0xe2b453, 0.05, 0.3, 0.05, x - 0.13 + k * 0.13, 0, z);
        break;
      }
      case 'jumper': {
        const vert = !!cp.rot, n = cp.n;
        for (let k = 0; k < n; k++) {
          const t = -((n - 1) * 0.13) / 2 + k * 0.13;
          const px = vert ? x : x + t, pz = vert ? z + t : z;
          B.box('plastic', 0x141416, 0.12, 0.06, 0.24, px, 0, pz, vert ? Math.PI / 2 : 0);
          B.box('metal', 0xe2b453, 0.035, 0.24, 0.035, px, 0, pz - (vert ? 0 : 0.06));
          B.box('metal', 0xe2b453, 0.035, 0.24, 0.035, px, 0, pz + (vert ? 0 : 0.06));
        }
        // jumper cap on the first pair
        const t0 = -((n - 1) * 0.13) / 2;
        B.box('gloss', 0x2a5cd8, vert ? 0.22 : 0.12, 0.2, vert ? 0.12 : 0.22, vert ? x : x + t0, 0.06, vert ? z + t0 : z);
        break;
      }
      case 'cap': {
        const col = CAP_COLORS[cp.col] ?? CAP_COLORS.blue;
        B.cyl('gloss', col, cp.rad, cp.rad, cp.h, x, 0, z, 12);
        B.cyl('metal', 0xd7dce1, cp.rad * 0.92, cp.rad * 0.92, 0.012, x, cp.h, z, 12);
        B.box('plastic', 0x55595e, cp.rad * 1.6, 0.008, 0.025, x, cp.h + 0.012, z);
        B.box('plastic', 0x55595e, 0.025, 0.008, cp.rad * 1.6, x, cp.h + 0.012, z);
        // minus stripe facing the camera
        B.box('plastic', 0xd8d8d0, cp.rad * 0.55, cp.h * 0.9, 0.02, x + cp.rad * 0.35, 0.02, z + cp.rad * 0.93, 0.35);
        break;
      }
      case 'toroid': {
        B.add('gloss', new THREE.TorusGeometry(0.27, 0.12, 6, 16), 0xb06a2c, x, 0.12, z, Math.PI / 2, 0, 0);
        B.cyl('plastic', 0x2d5a2d, 0.17, 0.17, 0.2, x, 0.02, z, 12);
        break;
      }
      default:
        break;
    }
  }

  // ---- CPU socket + chip ----------------------------------------------------------------------------------
  const cpu = layout.cpu;
  {
    const { x, z } = cpu.pos;
    const s = cpu.size;
    B.box('plastic', 0xe9e2cc, s + 0.1, 0.26, s + 0.1, x, 0, z);
    B.label('label', R.socketTop, s, s, x, 0.262, z);
    // ZIF lever along the bottom edge, handle at the right
    rod(B, 'metal', 0xc7ccd1, 0.05, s - 0.2, x - 0.1, 0.17, z + s / 2 + 0.12, 'x');
    B.box('plastic', 0xe9e2cc, 0.18, 0.14, 0.3, x + s / 2 - 0.05, 0.12, z + s / 2 + 0.12);
    B.box('plastic', 0xd8d0b8, 0.4, 0.2, 0.3, x - s / 2 - 0.05, 0.0, z + s / 2 + 0.05);
    // chip
    const c = s - 0.62;
    B.box('plastic', 0xc8c2b4, c, 0.14, c, x, 0.26, z);
    B.label('label', R.cpuTop, c - 0.02, c - 0.02, x, 0.402, z);
    // gold pin rim peeking out between chip and socket
    const rows = [c / 2 + 0.07, c / 2 + 0.17];
    for (const rr of rows) {
      const n = 17;
      for (let k = 0; k < n; k++) {
        const t = -rr + ((2 * rr) / (n - 1)) * k;
        for (const [px, pz] of [[t, -rr], [t, rr], [-rr, t], [rr, t]]) B.box('metal', 0xe4b852, 0.05, 0.03, 0.05, x + px, 0.262, z + pz);
      }
    }
    out.refs.cpuChip = { x, z, size: c, top: 0.402 };
  }

  // ---- fan unit: heatsink base + fins + frame + blades (animated group) -----------------------------------
  const fan = layout.fan;
  {
    const { x, z } = fan.pos;
    const s = fan.size;
    B.box('metal', 0xaeb5bd, s + 0.1, 0.1, s + 0.1, x, 0, z);
    for (let k = 0; k < 12; k++) B.box('metal', 0xc6ccd3, 0.045, 0.42, s - 0.04, x - s / 2 + 0.08 + k * ((s - 0.16) / 11), 0.1, z);
    // frame: square with circular opening
    const shape = roundedRectShape(s, s, 0.16);
    const hole = new THREE.Path();
    hole.absarc(0, 0, s / 2 - 0.12, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const frame = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 20 });
    frame.rotateX(-Math.PI / 2);
    B.add('plastic', frame, 0x232327, x, 0.52, z);
    frame.dispose();
    // motor struts under the blades
    for (let k = 0; k < 3; k++) {
      const an = (k / 3) * Math.PI * 2 + 0.3;
      B.box('plastic', 0x1c1c1f, s / 2 - 0.1, 0.05, 0.08, x + Math.cos(an) * (s / 4), 0.54, z + Math.sin(an) * (s / 4), -an);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) screwHead(B, x + sx * (s / 2 - 0.17), 0.84, z + sz * (s / 2 - 0.17), 0.09);
    // heat pipes to the CPU socket
    for (const dz of [-0.7, 0.7]) rod(B, 'metal', 0xc8743a, 0.07, 1.0, x + s / 2 + 0.35, 0.18, z + dz, 'x', 10);
    // fan cable to the CPU_FAN header
    const hdr = layout.comps.find((c2) => c2.type === 'fanHeader');
    if (hdr) {
      [['red', -0.06], ['black', 0], ['yellow', 0.06]].forEach(([col, o]) => {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x + s / 2 - 0.1 + o, 0.62, z + s / 2 - 0.05),
          new THREE.Vector3(x + s / 2 + 0.15 + o, 0.3, z + s / 2 + 0.25),
          new THREE.Vector3(hdr.x - 0.2 + o, 0.12, hdr.z - 0.5),
          new THREE.Vector3(hdr.x + o * 2, 0.22, hdr.z),
        ]);
        const tube = new THREE.TubeGeometry(curve, 14, 0.035, 5, false);
        B.add('gloss', tube, WIRE[col]);
        tube.dispose();
      });
    }
    // warning sticker on the heatsink edge
    labelEuler(B, 'label', R.warn, 0.62, 0.24, x - s / 2 + 0.55, 0.68, z + s / 2 + 0.03, 0);
  }

  out.meshes.push(...B.build(mats, { castShadow: true, receiveShadow: true }));
  out.heatParts = heatParts;

  // ---- fan blades (rotating group) -------------------------------------------------------------------------
  {
    const { x, z } = fan.pos;
    const s = fan.size;
    const group = new THREE.Group();
    group.position.set(x, 0.7, z);
    group.name = 'world:fanRotor';
    const rIn = 0.34, rOut = s / 2 - 0.16, nb = 7;
    const pos = [], idx = [];
    for (let b = 0; b < nb; b++) {
      const a0 = (b / nb) * Math.PI * 2;
      const base = pos.length / 3;
      const RS = 4, AS = 3;
      for (let i = 0; i <= RS; i++) {
        const r = rIn + ((rOut - rIn) * i) / RS;
        const sweep = 0.35 * (i / RS);       // swept-back blade
        const width = 0.62 - 0.12 * (i / RS);
        for (let j = 0; j <= AS; j++) {
          const t = j / AS - 0.5;
          const a = a0 + sweep + t * width;
          pos.push(Math.cos(a) * r, -t * 0.16, Math.sin(a) * r);
        }
      }
      for (let i = 0; i < RS; i++) for (let j = 0; j < AS; j++) {
        const k = base + i * (AS + 1) + j;
        idx.push(k, k + 1, k + AS + 1, k + 1, k + AS + 2, k + AS + 1);
      }
    }
    const bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bladeGeo.setIndex(idx);
    bladeGeo.computeVertexNormals();
    const blades = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }));
    blades.castShadow = true;
    group.add(blades);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn + 0.02, 0.16, 20), new THREE.MeshStandardMaterial({ color: 0x1d1d21, roughness: 0.5 }));
    hub.position.y = 0.0;
    group.add(hub);
    const hubLabel = new THREE.Mesh(new THREE.CircleGeometry(rIn - 0.02, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.4 }));
    const uv = hubLabel.geometry.attributes.uv, rg = R.fanHub;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rg.u0 + uv.getX(i) * (rg.u1 - rg.u0), rg.v0 + uv.getY(i) * (rg.v1 - rg.v0));
    hubLabel.position.y = 0.081;
    group.add(hubLabel);
    // motion blur disc (visible when spinning fast)
    const blurMat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 }, uAng: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uAmt; uniform float uAng; varying vec2 vUv;
void main(){ float r = length(vUv); if (r > 1.0 || r < 0.3) discard;
float a = atan(vUv.y, vUv.x);
float streak = 0.55 + 0.45 * sin(a * 7.0 + uAng);
gl_FragColor = vec4(vec3(0.16, 0.17, 0.2), uAmt * (0.35 + 0.25 * streak) * smoothstep(1.0, 0.92, r)); }`,
      transparent: true,
      depthWrite: false,
    });
    const blur = new THREE.Mesh(new THREE.PlaneGeometry(rOut * 2, rOut * 2).rotateX(-Math.PI / 2), blurMat);
    blur.position.set(x, 0.79, z);
    blur.renderOrder = 3;
    out.meshes.push(group, blur);
    out.refs.fanRotor = group;
    out.refs.fanBlur = blurMat;
  }

  return out;
}

// Floppy drive-bay sockets: one InstancedMesh (body + slit + label recess + eject button).
export function buildSlotSockets(slots) {
  const B = createBuilder();
  B.box('k', 0x141416, 0.9, 0.09, 0.9, 0, 0, 0);                 // black body
  B.box('k', 0x8a8270, 0.86, 0.05, 0.86, 0, 0.09, 0);            // muted beige drive bezel (recedes vs the paths)
  B.box('k', 0x1a1a1d, 0.72, 0.012, 0.6, 0, 0.14, -0.03);         // dark recess
  B.box('k', 0x020202, 0.62, 0.006, 0.12, 0, 0.152, -0.06);       // disk slit
  B.box('k', 0xb0b6bd, 0.66, 0.012, 0.025, 0, 0.152, -0.13);      // metal lips
  B.box('k', 0xb0b6bd, 0.66, 0.012, 0.025, 0, 0.152, 0.01);
  B.box('k', PALETTE.beigeDark, 0.2, 0.03, 0.1, 0.24, 0.14, 0.33); // eject button
  B.box('k', 0x3b3b40, 0.16, 0.012, 0.1, -0.28, 0.14, 0.33);      // LED window
  const [mesh] = B.build({ k: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 }) });
  const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.max(1, slots.length));
  inst.name = 'world:slotSockets';
  const m = new THREE.Matrix4();
  const white = new THREE.Color(1, 1, 1);
  slots.forEach((s, i) => {
    m.makeTranslation(s.pos.x, 0, s.pos.z);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, white); // per-bay tint (map.update: recede in waves, breathe when affordable in prep)
  });
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.count = slots.length;
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  return inst;
}

// 7-segment "MHz" turbo display on the front panel (redrawn when the game speed changes).
export function createTurboDisplay() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
  const drawDigit = (ox, d) => {
    const on = SEG[d] || '';
    const w = 34, h = 48, t = 6;
    const segs = {
      a: [ox + t, 6, w - 2 * t, t], d: [ox + t, 6 + h - t, w - 2 * t, t], g: [ox + t, 6 + h / 2 - t / 2, w - 2 * t, t],
      f: [ox, 6 + t, t, h / 2 - t], b: [ox + w - t, 6 + t, t, h / 2 - t], e: [ox, 6 + h / 2, t, h / 2 - t], c: [ox + w - t, 6 + h / 2, t, h / 2 - t],
    };
    for (const [k, r] of Object.entries(segs)) {
      g.fillStyle = on.includes(k) ? '#ff2a1a' : '#2a0806';
      g.fillRect(r[0], r[1], r[2], r[3]);
    }
  };
  const draw = (str) => {
    g.fillStyle = '#0a0302';
    g.fillRect(0, 0, 128, 64);
    drawDigit(14, str[0]);
    drawDigit(58, str[1]);
    g.fillStyle = '#ff2a1a';
    g.font = 'bold 12px Arial';
    g.fillText('MHz', 98, 56);
    tex.needsUpdate = true;
  };
  draw('33');
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62).rotateX(-Math.PI / 2), mat);
  mesh.name = 'world:turbo';
  return { mesh, draw };
}
