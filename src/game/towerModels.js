// Procedural low-poly floppy turrets: a beige drive-bay base, a turntable + yoke holding a tilted 3.5" drive and the
// floppy disk itself (bevelled body in the tower colour, sliding metal shutter, write-protect window, paper label drawn
// on a CanvasTexture). Upgrades swap label/shutter and add parts (v2 backup disk + gold trim, v3 holo label, antenna,
// emitter ring, glow). Also owns the instanced DEFRAG "fragment" cubes. Everything is drawn with InstancedMeshes.
// Static parts are merged into vertex-coloured meshes (pattern adapted from ZelariFPS/src/render/utilModels.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config.js';
import { TOWERS, TOWER_TYPES } from '../data/towers.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- dimensions (world units, 1 = one board cell)
export const SOCKET_Y = 0.15;           // top of the map's slot socket
const BASE_W = 0.84;                    // drive-bay chassis footprint
const BASE_H = 0.15;
const BASE_BEVEL = 0.02;
const TURRET_Y = SOCKET_Y + BASE_H;     // turntable sits on the chassis
const TURRET_Z = -0.03;                 // yaw axis slightly north so the front strip of the chassis stays visible
const PIVOT_Y = 0.17;                   // cradle pivot above the turntable
const CRADLE_Z = 0.24;                  // cradle pushed forward so the reclined disk is balanced over the yaw axis
export const RECLINE = 0.85;            // disk leans back ~49deg: its face stays readable from the 64deg camera
const TS = 1.15;                        // turret scale (drive + disk) over the chassis
const LEVEL_SCALE = [1.0, 1.06, 1.12];  // the head (yoke + drive + disk) grows with each upgrade
const PIP_X0 = -0.31;                   // level pips on the chassis front strip (left of the turntable)
const PIP_DX = 0.13;
const PIP_Z = 0.36;
const STRIP_Z = 0.355;
const DRIVE_W = 0.74;
const DRIVE_H = 0.15;
const DRIVE_D = 0.2;
const INSERT = 0.07;                    // how deep the disk sits in the drive
const FLOPPY_Y = DRIVE_H / 2 - INSERT;  // floppy group origin (disk bottom edge) in cradle space
const DISK_W = 0.62;
const DISK_H = 0.66;
const DISK_T = 0.04;
const DISK_BEVEL = 0.006;
const FACE_Z = DISK_T / 2 + DISK_BEVEL; // front face of the disk (local +Z, toward the target)
const SHUT_W = 0.29;
const SHUT_H = 0.23;
const SHUT_X = -0.02;                   // closed shutter position
const SHUT_SLIDE = 0.1;                 // open = SHUT_X + SHUT_SLIDE (window aligns with the media)
const SHUT_HOLE_X = -0.065;             // shutter window, relative to the shutter centre
const HOLE_W = 0.065;
const HOLE_Y0 = DISK_H - 0.19;
const HOLE_Y1 = DISK_H - 0.04;
const LABEL_W = 0.44;
const LABEL_H = 0.3;
const LABEL_Y = 0.245;
export const MUZZLE = new THREE.Vector3(0, 0.46, FACE_Z + 0.08);
const FS = 1.2;                         // floppy scale (the disk is the hero: a bit oversized vs the drive)

// ---------------------------------------------------------------- colours
const COL = {
  beige: PALETTE.beige,
  beigeDark: PALETTE.beigeDark,
  beigeLight: 0xe6dfc8,
  slot: 0x141416,
  dark: 0x2a2a2e,
  plate: 0x3a3b40,
  metal: 0x9aa1a8,
  media: 0x2b1d12,
  hub: 0xbfc4ca,
  gold: 0xe9b949,
  white: 0xf1eee2,
  vent: 0x8f866c,
};

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

// ---------------------------------------------------------------- geometry helpers
function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m4.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1));
  geo.applyMatrix4(_m4);
  return geo;
}

// Bucket of parts that become ONE vertex-coloured mesh.
function parts() {
  const list = [];
  return {
    list,
    add(geo, color, x, y, z, rx, ry, rz) {
      place(geo, x, y, z, rx, ry, rz);
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      _c.set(color);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.clearGroups();
      list.push(g);
      return g;
    },
    merge(matrix = null) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (matrix) geo.applyMatrix4(matrix);
      geo.computeBoundingSphere();
      return geo;
    },
  };
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function rectPath(x0, y0, x1, y1) {
  const p = new THREE.Path();
  p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0);
  return p;
}

// 3.5" disk outline: chamfered top-right corner, write-protect + HD windows in the bottom corners. Origin = bottom centre.
function diskShape() {
  const s = new THREE.Shape();
  const x0 = -DISK_W / 2, x1 = DISK_W / 2, c = 0.05;
  s.moveTo(x0, 0); s.lineTo(x1, 0); s.lineTo(x1, DISK_H - c); s.lineTo(x1 - c, DISK_H); s.lineTo(x0, DISK_H); s.lineTo(x0, 0);
  s.holes.push(rectPath(x0 + 0.035, 0.09, x0 + 0.08, 0.145));
  s.holes.push(rectPath(x1 - 0.08, 0.09, x1 - 0.035, 0.145));
  return s;
}

function diskBodyGeometry() {
  const g = new THREE.ExtrudeGeometry(diskShape(), {
    depth: DISK_T, bevelEnabled: true, bevelThickness: DISK_BEVEL, bevelSize: DISK_BEVEL, bevelSegments: 1, curveSegments: 2,
  });
  g.translate(0, 0, -DISK_T / 2);
  g.clearGroups();
  g.computeBoundingSphere();
  return g;
}

function shutterPlate() {
  const s = new THREE.Shape();
  const x0 = -SHUT_W / 2, x1 = SHUT_W / 2, y0 = DISK_H - SHUT_H, y1 = DISK_H + 0.004;
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
  s.holes.push(rectPath(SHUT_HOLE_X - HOLE_W / 2, HOLE_Y0, SHUT_HOLE_X + HOLE_W / 2, HOLE_Y1));
  return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: 1 });
}

// metal shutter: front + back plate (with window) + the cap over the top edge. Vertex-coloured (metal / gold).
function shutterGeometry(color) {
  const p = parts();
  p.add(shutterPlate(), color, 0, 0, FACE_Z + 0.0006);
  p.add(shutterPlate(), color, 0, 0, -FACE_Z - 0.0046);
  p.add(box(SHUT_W, 0.004, FACE_Z * 2 + 0.01), color, 0, DISK_H + 0.002, 0);
  // pressed groove line under the window
  p.add(box(SHUT_W * 0.8, 0.008, 0.002), mulHex(color, 0.7), 0, DISK_H - SHUT_H + 0.025, FACE_Z + 0.0055);
  return p.merge();
}

function mulHex(hex, k) {
  _c.set(hex).multiplyScalar(k);
  return _c.getHex();
}

// media window, hub (back), write-protect slider: one vertex-coloured mesh per disk
function diskDetailsGeometry() {
  const p = parts();
  const mx = SHUT_X + SHUT_HOLE_X + SHUT_SLIDE;
  const my = (HOLE_Y0 + HOLE_Y1) / 2;
  p.add(new THREE.PlaneGeometry(HOLE_W, HOLE_Y1 - HOLE_Y0), COL.media, mx, my, FACE_Z + 0.0003);
  p.add(new THREE.PlaneGeometry(HOLE_W, HOLE_Y1 - HOLE_Y0), COL.media, mx, my, -FACE_Z - 0.0003, 0, Math.PI, 0);
  // metal hub on the back
  p.add(cyl(0.085, 0.085, 0.006, 20), COL.hub, 0, 0.35, -FACE_Z - 0.003, Math.PI / 2, 0, 0);
  p.add(box(0.036, 0.036, 0.003), COL.slot, 0, 0.35, -FACE_Z - 0.0065);
  p.add(box(0.018, 0.03, 0.003), COL.slot, 0.048, 0.33, -FACE_Z - 0.0065);
  // write-protect slider (closes half of the bottom-left window)
  p.add(box(0.045, 0.028, DISK_T * 0.8), COL.slot, -DISK_W / 2 + 0.0575, 0.104, 0);
  return p.merge();
}

// static chassis that sits on the map socket (root space, y from SOCKET_Y)
function baseGeometry() {
  const p = parts();
  const shell = new THREE.ExtrudeGeometry(roundedRectShape(BASE_W - BASE_BEVEL * 2, BASE_W - BASE_BEVEL * 2, 0.06), {
    depth: BASE_H - BASE_BEVEL * 2, bevelEnabled: true, bevelThickness: BASE_BEVEL, bevelSize: BASE_BEVEL, bevelSegments: 2, curveSegments: 3,
  });
  shell.rotateX(-Math.PI / 2);
  shell.translate(0, BASE_BEVEL, 0);
  p.add(shell, COL.beige);
  const top = BASE_H + 0.001;
  // front control strip (south edge, faces the camera): 3 level-pip sockets + the disk slot
  p.add(box(0.76, 0.004, 0.1), COL.beigeDark, 0, top, STRIP_Z);
  p.add(box(0.19, 0.006, 0.026), COL.slot, 0.235, top + 0.002, STRIP_Z);   // disk slot
  // pip sockets (lit pips are a separate instanced mesh)
  for (let i = 0; i < 3; i++) p.add(box(0.122, 0.005, 0.072), COL.slot, PIP_X0 + i * PIP_DX, top + 0.002, PIP_Z);
  // corner screws
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.add(cyl(0.022, 0.022, 0.008, 8), COL.metal, sx * 0.34, top + 0.003, sz * 0.34 - (sz > 0 ? 0.1 : 0));
  // south face: a drive-bay slit
  p.add(box(0.5, 0.024, 0.006), COL.slot, 0, BASE_H * 0.55, BASE_W / 2 + 0.001);
  // side vents
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) p.add(box(0.006, 0.014, 0.1), COL.vent, sx * (BASE_W / 2 + 0.001), BASE_H * 0.6, -0.24 + i * 0.13);
  return p.merge();
}

// one lit level pip (base space); drawn once per earned level, offset by PIP_DX
function pipGeometry() {
  const g = box(0.11, 0.012, 0.06);
  g.translate(PIP_X0, BASE_H + 0.007, PIP_Z);
  return g;
}

// matrix that maps cradle space into turret space (pitch + offset), used to bake the drive into the turret mesh
function cradleMatrix(out = new THREE.Matrix4()) {
  _e.set(-RECLINE, 0, 0);
  _q.setFromEuler(_e);
  return out.compose(_v.set(0, PIVOT_Y, CRADLE_Z), _q, _s.set(1, 1, 1));
}

// turntable (turret space, does not grow with the level so it never covers the level pips)
function turntableGeometry() {
  const t = parts();
  t.add(cyl(0.3, 0.315, 0.03, 24), COL.dark, 0, 0.015, 0);             // groove
  t.add(cyl(0.27, 0.28, 0.04, 24), COL.beigeDark, 0, 0.022, 0);       // turntable plate
  t.add(cyl(0.12, 0.12, 0.006, 16), COL.metal, 0, 0.044, 0);          // spindle cap
  return t.merge();
}

// yoke + the (tilted) drive, in head space (= turret space scaled by LEVEL_SCALE)
function turretGeometry() {
  const t = parts();
  for (const sx of [-1, 1]) {
    const ax = sx * (DRIVE_W / 2 + 0.035);
    t.add(box(0.045, PIVOT_Y + 0.02, 0.11), COL.beige, ax, (PIVOT_Y + 0.02) / 2 + 0.02, CRADLE_Z);
    t.add(cyl(0.04, 0.04, 0.03, 10), COL.dark, sx * (DRIVE_W / 2 + 0.062), PIVOT_Y, CRADLE_Z, 0, 0, Math.PI / 2);
  }
  const d = parts();
  d.add(box(DRIVE_W, DRIVE_H, DRIVE_D), COL.beige, 0, 0, 0);
  d.add(box(DRIVE_W - 0.06, 0.006, 0.064), COL.slot, 0, DRIVE_H / 2 + 0.002, 0);              // disk slot
  d.add(box(DRIVE_W - 0.02, DRIVE_H - 0.03, 0.008), COL.beigeDark, 0, -0.004, DRIVE_D / 2 + 0.003); // front bezel
  d.add(box(0.46, 0.012, 0.006), COL.slot, 0.04, 0.022, DRIVE_D / 2 + 0.008);                 // door line
  d.add(box(0.08, 0.032, 0.02), COL.beigeLight, 0.25, -0.03, DRIVE_D / 2 + 0.01);             // eject button
  d.add(box(0.05, 0.03, 0.01), COL.slot, -0.27, -0.03, DRIVE_D / 2 + 0.008);                  // LED housing
  d.add(box(DRIVE_W - 0.04, 0.012, DRIVE_D - 0.04), COL.beigeDark, 0, -DRIVE_H / 2 - 0.004, 0);
  const driveGeo = d.merge(cradleMatrix());
  t.list.push(driveGeo);
  return t.merge();
}

// v2: fanned backup disk (body separate for its own colour) + its details + a gold trim on the drive
function backupDetailsGeometry() {
  const p = parts();
  const s = 0.86;
  // shutter (gold) + label stripe + hub, in backup-disk space (scaled afterwards)
  p.add(box(SHUT_W, SHUT_H, FACE_Z * 2 + 0.008), COL.gold, SHUT_X, DISK_H - SHUT_H / 2 + 0.002, 0);
  p.add(cyl(0.085, 0.085, 0.006, 16), COL.hub, 0, 0.35, -FACE_Z - 0.003, Math.PI / 2, 0, 0);
  const g = p.merge(new THREE.Matrix4().makeScale(s, s, s));
  return g;
}

function driveTrimGeometry() {
  const p = parts();
  p.add(box(DRIVE_W + 0.012, 0.016, DRIVE_D + 0.012), COL.gold, 0, DRIVE_H / 2 - 0.012, 0);
  p.add(box(DRIVE_W - 0.12, 0.006, 0.05), COL.slot, 0, DRIVE_H / 2 + 0.003, -0.066);         // second slot
  return p.merge();
}

// v3: whip antenna with glowing tip (cradle space) + emitter ring (floppy space)
function antennaGeometry() {
  const p = parts();
  // whip antenna on the drive's left edge, leaning outward so it clears the disk
  const ax = -DRIVE_W / 2 - 0.01, L = 0.78, lean = 0.22;
  const tx = ax - Math.sin(lean) * L, ty = DRIVE_H / 2 + Math.cos(lean) * L;
  p.add(cyl(0.01, 0.016, L, 6), 0xffffff, (ax + tx) / 2, (DRIVE_H / 2 + ty) / 2, -0.02, 0, 0, lean);
  const tip = p.add(new THREE.IcosahedronGeometry(0.09, 0), 0xffffff, tx, ty, -0.02);
  p.add(cyl(0.03, 0.036, 0.026, 8), 0xffffff, ax, DRIVE_H / 2 + 0.013, -0.02);
  // vertex colours act as an HDR multiplier on the per-tower glow colour: whip x0.8, beacon tip x3 (blooms)
  for (const g of p.list) {
    const a = g.attributes.color.array;
    const k = g === tip ? 3 : 0.8;
    for (let i = 0; i < a.length; i++) a[i] = k;
  }
  return p.merge();
}

// v3: dashed ground ring under the chassis (root space, flat). Vertex colour = intensity (additive blending).
function groundRingGeometry() {
  const list = [];
  const add = (r0, r1, a0, a1, k) => {
    const g = new THREE.RingGeometry(r0, r1, Math.max(2, Math.round((a1 - a0) / TAU * 64)), 1, a0, a1 - a0);
    g.rotateX(-Math.PI / 2);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3).fill(k);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    list.push(g);
  };
  const DASHES = 12;
  for (let i = 0; i < DASHES; i++) {
    const a0 = (i / DASHES) * TAU;
    add(0.57, 0.66, a0, a0 + (TAU / DASHES) * 0.62, 1);
  }
  add(0.685, 0.7, 0, TAU, 0.45);   // faint outer hairline
  const geo = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  geo.computeBoundingSphere();
  return geo;
}

function ringGeometry() {
  const p = parts();
  p.add(new THREE.TorusGeometry(0.13, 0.011, 6, 28), 0xffffff);
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3;
    p.add(box(0.035, 0.035, 0.03), 0xffffff, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0, 0, 0, a);
  }
  return p.merge();
}

// ---------------------------------------------------------------- label textures (CanvasTexture, handwritten marker)
const HAND = '"Segoe Print", "Comic Sans MS", "Marker Felt", "Bradley Hand", "Chalkboard SE", "Comic Neue", cursive';
const PRINT = '"Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function handText(g, text, x, y, maxW, size, ink, rnd, tilt) {
  g.save();
  g.font = `bold ${size}px ${HAND}`;
  const w = g.measureText(text).width || 1;
  const k = Math.min(1, maxW / w);
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(k, 1);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 1.4;
  g.lineJoin = 'round';
  let cx = 0;
  for (const ch of text) {
    const cw = g.measureText(ch).width;
    g.save();
    g.translate(cx, (rnd() - 0.5) * 3.5);
    g.rotate((rnd() - 0.5) * 0.14);
    g.globalAlpha = 0.95;
    g.fillText(ch, 0, 0);
    g.strokeText(ch, 0, 0);
    g.globalAlpha = 0.22;
    g.fillText(ch, 0.9, 0.7);
    g.restore();
    cx += cw * 0.97;
  }
  g.restore();
  return w * k;
}

function wobblyEllipse(g, cx, cy, rx, ry, rnd, passes = 2) {
  for (let p = 0; p < passes; p++) {
    g.beginPath();
    const a0 = rnd() * TAU;
    for (let i = 0; i <= 26; i++) {
      const a = a0 + (i / 24) * TAU;
      const j = 1 + (rnd() - 0.5) * 0.08;
      const x = cx + Math.cos(a) * rx * j, y = cy + Math.sin(a) * ry * j;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function doodle(g, kind, x, y, ink) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = ink;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'shield') {
    g.moveTo(0, -18); g.lineTo(16, -12); g.quadraticCurveTo(16, 10, 0, 20); g.quadraticCurveTo(-16, 10, -16, -12); g.closePath();
    g.moveTo(-7, 1); g.lineTo(-1, 8); g.lineTo(9, -7);
  } else if (kind === 'flame') {
    g.moveTo(0, 20); g.quadraticCurveTo(-16, 10, -8, -4); g.quadraticCurveTo(-6, 4, -2, 4); g.quadraticCurveTo(-6, -10, 4, -20);
    g.quadraticCurveTo(4, -6, 12, -2); g.quadraticCurveTo(16, 12, 0, 20);
  } else {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) g.rect(-16 + c * 11, -10 + r * 11, 9, 9);
  }
  g.stroke();
  g.restore();
}

function drawLabel(type, level, backup = false) {
  const def = TOWERS[type];
  const L = def.art || { title: type.toUpperCase(), ink: '#111', note: '' };
  const w = 256, h = 176;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return c;
  const rnd = seeded(type.length * 7919 + type.charCodeAt(0) * 131 + level * 977);
  const holo = level >= 3;
  if (holo) {
    const gr = g.createLinearGradient(0, h, w, 0);
    const stops = ['#ff6ad5', '#7afcff', '#a8ff78', '#fff27a', '#ff9a6a', '#c49bff', '#7afcff'];
    stops.forEach((col, i) => gr.addColorStop(i / (stops.length - 1), col));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.22;
    g.fillStyle = '#ffffff';
    for (let x = -h; x < w; x += 24) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 9, 0); g.lineTo(x + 9, h); g.fill(); }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = '#f4f0e3';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(110,90,50,${(0.04 + rnd() * 0.06).toFixed(3)})`;
      g.fillRect(rnd() * w, rnd() * h, 1.6, 1.6);
    }
  }
  const css = '#' + _c.set(def.color).getHexString();
  // printed manufacturer band
  g.fillStyle = holo ? 'rgba(12,10,32,0.88)' : css;
  g.fillRect(0, 0, w, 30);
  g.fillStyle = holo ? '#eafffb' : (type === 'defrag' ? '#2a1f00' : '#ffffff');
  g.textBaseline = 'middle';
  g.font = `bold 15px ${PRINT}`;
  g.fillText('3.5"  HD  1.44 MB', 9, 16);
  g.textAlign = 'right';
  g.font = `bold 12px ${PRINT}`;
  g.fillText(holo ? 'GOLD+' : 'MF-2HD', w - 9, 16);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  // ruled lines
  g.strokeStyle = holo ? 'rgba(255,255,255,0.55)' : 'rgba(70,120,210,0.38)';
  g.lineWidth = 1.5;
  for (let y = 70; y < h; y += 34) { g.beginPath(); g.moveTo(8, y); g.lineTo(w - 8, y); g.stroke(); }
  if (backup) {
    handText(g, 'BACKUP', 16, 66, 220, 40, L.ink, rnd, -0.05);
    handText(g, '(do not lose!!)', 30, 120, 200, 24, '#555', rnd, 0.03);
    return c;
  }
  const ink = holo ? '#0b0a24' : L.ink;
  // handwritten title
  handText(g, L.title, 12, 66, 232, 40, ink, rnd, -0.035);
  // version: red marker, underlined (v1), circled (v2), circled + stars (v3)
  const red = holo ? '#b0006a' : '#cc1626';
  const vx = 128, vy = 150;
  const vw = handText(g, (TOWERS[type].levels[level - 1] || {}).version || 'v1.0', vx, vy, 112, 46, red, rnd, -0.07);
  g.strokeStyle = red;
  g.lineWidth = 3.5;
  g.lineCap = 'round';
  if (level === 1) {
    g.beginPath(); g.moveTo(vx - 4, vy + 10); g.quadraticCurveTo(vx + vw / 2, vy + 4, vx + vw + 6, vy + 6); g.stroke();
  } else {
    wobblyEllipse(g, vx + vw / 2, vy - 15, vw / 2 + 14, 27, rnd, level);
  }
  if (level >= 3) {
    g.font = `bold 26px ${HAND}`;
    g.fillStyle = red;
    g.fillText('!!', vx + vw + 6, vy - 26);
  }
  // doodle + note in pencil
  doodle(g, L.doodle, 44, 112, ink);
  g.font = `bold 15px ${HAND}`;
  g.fillStyle = holo ? 'rgba(10,10,40,0.85)' : 'rgba(60,60,70,0.85)';
  g.fillText(L.note || '', 12, 166);
  return c;
}

// ---------------------------------------------------------------- factory
// Rendering is fully instanced: every tower is a light hierarchy of proxy Object3Ds (never added to the scene) that
// the animation drives; sync() copies the proxies' world matrices into one InstancedMesh per part/material, so the
// whole tower set costs ~30 draw calls no matter how many floppies are on the board.
const CAP = 48;   // max towers drawn at once (26-28 slots + selling ones)

// per-instance emissive for MeshStandardMaterial (selection pulse, fire flash, overheat glow, v3 glow)
function withInstanceEmissive(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 instanceEmissive;\nvarying vec3 vInstEmissive;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstEmissive = instanceEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInstEmissive;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vInstEmissive;');
  };
  mat.customProgramCacheKey = () => 'fd-instance-emissive';
  return mat;
}

export function createTowerModels(ctx) {
  const G = {};
  const M = {};
  const textures = [];

  G.base = baseGeometry();
  G.pip = pipGeometry();
  G.turntable = turntableGeometry();
  G.turret = turretGeometry();
  G.body = diskBodyGeometry();
  G.details = diskDetailsGeometry();
  G.shutter = shutterGeometry(0xffffff);
  G.label = new THREE.PlaneGeometry(LABEL_W, LABEL_H);
  G.label.translate(0, LABEL_Y, FACE_Z + 0.0008);
  G.led = new THREE.BoxGeometry(0.03, 0.018, 0.012);
  G.led.translate(-0.27, -0.03, DRIVE_D / 2 + 0.014);
  const BS = 0.86; // backup disk scale
  G.backupBody = G.body.clone().scale(BS, BS, BS);
  G.backupLabel = G.label.clone().scale(BS, BS, BS);
  G.backupDetails = backupDetailsGeometry();
  G.trim = driveTrimGeometry();
  G.antenna = antennaGeometry();
  G.ring = ringGeometry();
  G.groundRing = groundRingGeometry();

  M.beige = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
  M.details = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
  M.metal = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xc4cad1, roughness: 0.28, metalness: 0.55 });
  M.gold = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xf2c14e, roughness: 0.25, metalness: 0.6, emissive: 0x3a2600 });
  M.unlit = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });   // LEDs, pips, emitter ring (instanceColor)
  M.antenna = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });   // whip + HDR tip
  // dark silhouette hull around every disk: separates the floppies from the busy PCB (yellow defrag vs gold traces)
  M.ink = new THREE.MeshBasicMaterial({ color: 0x07090b, side: THREE.BackSide });
  M.groundRing = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  M.outline = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.phosphor).multiplyScalar(1.4), side: THREE.BackSide, toneMapped: false, transparent: true, opacity: 0.9 });
  const LED_OFF = new THREE.Color(0x0c3a18);
  const LED_ON = new THREE.Color(PALETTE.phosphor).multiplyScalar(3);
  const LED_AMBER = new THREE.Color(PALETTE.amber).multiplyScalar(2.5);
  const GLOW = {};
  const BASE_COLOR = {};
  const PIP_COLOR = {};
  for (const type of TOWER_TYPES) {
    const col = TOWERS[type].color;
    BASE_COLOR[type] = new THREE.Color(col);
    GLOW[type] = new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.15).multiplyScalar(1.25);
    PIP_COLOR[type] = new THREE.Color(col).multiplyScalar(2.5);   // HDR: the level pips bloom in the tower colour
  }

  function makeTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
    return tex;
  }
  function labelMaterial(type, level, backup = false) {
    try {
      const tex = makeTexture(drawLabel(type, level, backup));
      return level >= 3 && !backup
        ? new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.3 })
        : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0 });
    } catch (err) {
      return new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.9 });
    }
  }

  // ---------------------------------------------------------------- instanced part meshes
  const group = new THREE.Group();
  group.name = 'towerMeshes';
  const parts = [];
  function part(name, geo, mat, { color = false, emissive = false, shadow = false } = {}) {
    let g = geo;
    if (emissive) {
      g = geo.clone();
      const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('instanceEmissive', a);
    }
    const m = new THREE.InstancedMesh(g, mat, CAP);
    m.name = `tower:${name}`;
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.userData.n = 0;
    m.userData.emissive = emissive ? g.attributes.instanceEmissive : null;
    group.add(m);
    parts.push(m);
    return m;
  }

  const P = {
    base: part('base', G.base, M.beige, { shadow: true }),
    pips: part('pips', G.pip, M.unlit, { color: true }),
    turntable: part('turntable', G.turntable, M.beige, { shadow: true }),
    turret: part('turret', G.turret, M.beige, { shadow: true }),
    led: part('led', G.led, M.unlit, { color: true }),
    details: part('details', G.details, M.details),
    metal: part('shutter', G.shutter, M.metal),
    gold: part('shutterGold', G.shutter, M.gold),
    backupDetails: part('backupDetails', G.backupDetails, M.details),
    backupLabel: part('backupLabel', G.backupLabel, labelMaterial('antivirus', 1, true)),
    trim: part('trim', G.trim, M.gold),
    antenna: part('antenna', G.antenna, M.antenna, { color: true }),
    ring: part('ring', G.ring, M.unlit, { color: true }),
    groundRing: part('groundRing', G.groundRing, M.groundRing, { color: true }),
    // silhouette hulls: one instanced mesh for every type's disk body, one for the v2 backup disks
    ink: part('ink', G.body, M.ink),
    backupInk: part('backupInk', G.backupBody, M.ink),
    body: {},
    backupBody: {},
    label: {},
  };
  P.ink.renderOrder = -1;          // just below the bodies
  P.backupInk.renderOrder = -1;
  P.groundRing.renderOrder = 2;    // additive, after the opaque board
  const labelMats = {};
  for (const type of TOWER_TYPES) {
    const col = TOWERS[type].color;
    P.body[type] = part(`body:${type}`, G.body,
      withInstanceEmissive(new THREE.MeshStandardMaterial({ color: col, roughness: 0.38, metalness: 0.04 })), { color: true, emissive: true, shadow: true });
    P.backupBody[type] = part(`backupBody:${type}`, G.backupBody,
      new THREE.MeshStandardMaterial({ color: new THREE.Color(col).multiplyScalar(0.62), roughness: 0.45, metalness: 0.04 }));
    P.label[type] = [1, 2, 3].map((lv) => {
      const mat = labelMaterial(type, lv);
      labelMats[`${type}:${lv}`] = mat;
      return part(`label:${type}:${lv}`, G.label, mat);
    });
  }

  // the single selection outline (inverted hull around the selected floppy), placed by sync()
  const outline = new THREE.Mesh(G.body, M.outline);
  outline.matrixAutoUpdate = false;
  outline.matrix.makeScale(1e-5, 1e-5, 1e-5);   // invisible speck until a floppy is selected (shader warm-up frame)
  outline.visible = false;
  outline.renderOrder = -1;
  outline.frustumCulled = false;
  group.add(outline);
  const OUT_S = 1.2;   // larger than the dark silhouette hull (INK_S) so the phosphor rim shows around it
  const OUT_LOCAL = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -DISK_H * (OUT_S - 1) * 0.45, 0), new THREE.Quaternion(), new THREE.Vector3(OUT_S, 1 + (OUT_S - 1) * 0.9, 1.5));
  let selectedVis = null;
  // silhouette hull: 1.08x about the disk centre (a little deeper in z so the rim also shows on the thin edges)
  const INK_S = 1.08;
  const inkLocal = (k) => new THREE.Matrix4().compose(
    new THREE.Vector3(0, DISK_H * k * 0.5 * (1 - INK_S), 0), new THREE.Quaternion(), new THREE.Vector3(INK_S, INK_S, 1.4));
  const INK_LOCAL = inkLocal(1);
  const INK_LOCAL_BACKUP = inkLocal(BS);
  const _im = new THREE.Matrix4();
  const _pm = new THREE.Matrix4();

  // ---------------------------------------------------------------- proxies
  function build(type, level = 1) {
    const root = new THREE.Group();
    root.name = `tower:${type}`;
    const base = new THREE.Object3D();
    base.position.y = SOCKET_Y;
    root.add(base);
    const turret = new THREE.Object3D();
    turret.position.set(0, TURRET_Y, TURRET_Z);
    turret.scale.setScalar(TS);
    root.add(turret);
    const head = new THREE.Object3D();   // yoke + drive + disks: scaled by LEVEL_SCALE
    turret.add(head);
    const cradle = new THREE.Object3D();
    cradle.position.set(0, PIVOT_Y, CRADLE_Z);
    cradle.rotation.x = -RECLINE;
    head.add(cradle);
    const floppy = new THREE.Object3D();
    floppy.position.y = FLOPPY_Y;
    floppy.scale.setScalar(FS);
    cradle.add(floppy);
    const shutter = new THREE.Object3D();
    shutter.position.x = SHUT_X;
    floppy.add(shutter);
    const ring = new THREE.Object3D();
    ring.position.copy(MUZZLE);
    ring.position.z -= 0.035;
    floppy.add(ring);
    // v2 backup disk, fanned 25 deg sideways so the wider silhouette reads from above
    const backup = new THREE.Object3D();
    backup.position.set(0.07, FLOPPY_Y + 0.01, -0.066);
    backup.rotation.z = -0.436;
    backup.scale.setScalar(FS);
    cradle.add(backup);
    // v3 ground ring on the board around the socket (child of the chassis so it follows insert/eject scaling)
    const groundRing = new THREE.Object3D();
    groundRing.position.y = 0.025 - SOCKET_Y;
    base.add(groundRing);
    const vis = {
      type, level: 1, root, base, turret, head, cradle, floppy, shutter, ring, backup, groundRing,
      headK: 1, headTarget: 1,
      baseColor: BASE_COLOR[type],
      tint: new THREE.Color(1, 1, 1),
      emissive: new THREE.Color(0, 0, 0),
      ledColor: LED_OFF.clone(),
      yaw: 0, anim: null, animT: 0, animFlag: false, ready: false,
      recoil: 0, shutterK: 0, ledT: 0, idleLedT: Math.random() * 3, pulseT: 9, smokeT: Math.random(),
      selected: false, heatK: 0, glow: 0, ledPhase: (Math.random() * 3) | 0,
    };
    setLevel(vis, level, true);
    return vis;
  }

  function setLevel(vis, level, snap = false) {
    vis.level = Math.max(1, Math.min(3, level | 0));
    vis.glow = vis.level >= 3 ? 0.3 : 0.1;   // a little self-illumination keeps the disks popping over the busy PCB
    vis.headTarget = LEVEL_SCALE[vis.level - 1];
    if (snap) { vis.headK = vis.headTarget; vis.head.scale.setScalar(vis.headK); }
  }

  // world-space muzzle point (in front of the disk face, where bolts appear)
  function muzzle(vis, out) {
    vis.floppy.updateWorldMatrix(true, false);
    return vis.floppy.localToWorld(out.copy(MUZZLE));
  }

  // top of the floppy in world space (steam wisps, upgrade text)
  function top(vis, out) {
    vis.floppy.updateWorldMatrix(true, false);
    return vis.floppy.localToWorld(out.set(0, DISK_H, 0));
  }

  function setSelected(vis) {
    selectedVis = vis || null;
    if (!selectedVis) outline.visible = false;
  }

  function disposeVis(vis) {
    if (selectedVis === vis) setSelected(null);
    vis.root.parent?.remove(vis.root);
  }

  // ---------------------------------------------------------------- animation (driven by towers.update, sim dt)
  const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const spring = (t, amp, w = 38, k = 9) => amp * Math.cos(w * t) * Math.exp(-k * t);

  const T_INSERT = 0.85;
  const T_UPGRADE = 0.8;
  const T_EJECT = 0.6;
  const HEAT_TINT = new THREE.Color(1, 0.62, 0.55);

  function startAnim(vis, kind) {
    if (kind === 'upgrade') {
      // an upgrade may interrupt the insertion: make sure the chassis is fully grown
      vis.base.scale.set(1, 1, 1);
      vis.turret.scale.set(TS, TS, TS);
    } else {
      vis.ready = false;
    }
    vis.anim = kind;
    vis.animT = 0;
    vis.animFlag = false;
  }

  // returns an event string when something notable happens this step: 'click' | 'swap' | 'done' | null
  function animate(vis, dt, time) {
    let evt = null;
    const f = vis.floppy;
    let offY = 0, spinY = 0, sc = 1;
    if (vis.anim) {
      vis.animT += dt;
      const t = vis.animT;
      if (vis.anim === 'insert') {
        const bs = Math.max(0.001, easeOutBack(clamp01(t / 0.2)));
        vis.base.scale.set(bs, bs, bs);
        vis.turret.scale.set(bs * TS, bs * TS, bs * TS);
        if (t < 0.42) {
          const u = clamp01((t - 0.06) / 0.36);
          offY = 2.4 + (0.3 - 2.4) * u * u;
          spinY = (1 - u) * TAU;
        } else if (t < 0.52) {
          const v = (t - 0.42) / 0.1;
          offY = 0.3 + (-0.035 - 0.3) * v * v;
        } else {
          if (!vis.animFlag) { vis.animFlag = true; vis.ledT = 0.55; evt = 'click'; }
          offY = spring(t - 0.52, -0.035);
        }
        if (t >= T_INSERT) {
          vis.anim = null; vis.ready = true; offY = 0;
          vis.base.scale.set(1, 1, 1); vis.turret.scale.set(TS, TS, TS);
          evt = 'done';
        }
      } else if (vis.anim === 'upgrade') {
        if (t < 0.22) {
          offY = 0.55 * easeOutCubic(t / 0.22);
        } else if (t < 0.46) {
          offY = 0.55 + Math.sin((t - 0.22) / 0.24 * Math.PI) * 0.06;
        } else if (t < 0.56) {
          const v = (t - 0.46) / 0.1;
          offY = 0.55 + (-0.04 - 0.55) * v * v;
        } else {
          offY = spring(t - 0.56, -0.04);
        }
        spinY = TAU * easeOutCubic(clamp01((t - 0.08) / 0.42));
        if (!vis.animFlag && t >= 0.3) { vis.animFlag = true; evt = 'swap'; }
        if (t >= 0.56 && t - dt < 0.56) vis.ledT = 0.5;
        if (t >= T_UPGRADE) { vis.anim = null; vis.ready = true; offY = 0; spinY = 0; evt = 'done'; }
      } else if (vis.anim === 'eject') {
        const u = clamp01(t / T_EJECT);
        offY = 1.5 * easeOutCubic(u);
        spinY = u * TAU * 1.5;
        sc = 1 - clamp01((t - 0.2) / 0.35);
        const bs = Math.max(0.001, 1 - clamp01((t - 0.25) / 0.35));
        vis.base.scale.set(bs, bs * bs, bs);
        vis.turret.scale.set(bs * TS, bs * TS, bs * TS);
        if (t >= T_EJECT) evt = 'done';
      }
    }
    // recoil punch + shutter + LED
    vis.recoil *= Math.exp(-11 * dt);
    if (vis.recoil < 0.001) vis.recoil = 0;
    vis.shutterK = Math.max(0, vis.shutterK - dt * 3.2);
    const r = vis.recoil;
    f.position.set(0, FLOPPY_Y + offY, -0.065 * r);
    f.rotation.set(-0.12 * r, spinY, 0);
    const s = Math.max(0.001, sc);
    f.scale.set(FS * s * (1 + 0.06 * r), FS * s * (1 - 0.05 * r), FS * s);
    vis.shutter.position.x = SHUT_X + SHUT_SLIDE * Math.min(1, vis.shutterK * 1.8);
    vis.ring.rotation.z = time * 1.6;
    const rs = 1 + 0.35 * r;
    vis.ring.scale.set(rs, rs, rs);
    vis.groundRing.rotation.y = time * 0.45 + vis.ledPhase;
    if (vis.headK !== vis.headTarget) {
      const d = vis.headTarget - vis.headK;
      vis.headK = Math.abs(d) < 1e-4 ? vis.headTarget : vis.headK + d * (1 - Math.exp(-10 * dt));
      vis.head.scale.setScalar(vis.headK);
    }

    // LED: fast flicker while active, rare idle blinks (drive activity)
    vis.idleLedT -= dt;
    if (vis.idleLedT < 0) { vis.idleLedT = 2 + Math.random() * 4; if (vis.ledT <= 0) vis.ledT = 0.12; }
    if (vis.ledT > 0) {
      vis.ledT -= dt;
      vis.ledColor.copy(((time * 34) | 0) % 3 !== vis.ledPhase ? LED_ON : LED_OFF);
    } else {
      vis.ledColor.copy(vis.heatK > 0.05 ? LED_AMBER : LED_OFF);
    }

    // body paint (per instance): v3 glow, selection pulse, fire flash, overheat tint
    let e = vis.glow + r * 0.35;
    if (vis.selected) e += 0.2 + 0.14 * Math.sin(time * 7);
    vis.emissive.copy(vis.baseColor).multiplyScalar(e);
    vis.tint.setRGB(1, 1, 1);
    if (vis.heatK > 0) {
      const hk = vis.heatK * (0.75 + 0.25 * Math.sin(time * 9));
      vis.tint.lerp(HEAT_TINT, vis.heatK);
      vis.emissive.r += 0.4 * hk;
      vis.emissive.g += 0.05 * hk;
    }
    return evt;
  }

  // shared animated materials (v3 holographic labels, outline pulse): once per step
  const _hsl = new THREE.Color();
  function updateShared(time) {
    for (let i = 0; i < TOWER_TYPES.length; i++) {
      const m = labelMats[`${TOWER_TYPES[i]}:3`];
      if (m) m.emissive.copy(_hsl.setHSL((time * 0.12 + i * 0.3) % 1, 0.7, 0.72));
    }
    M.outline.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(time * 7));
  }

  // ---------------------------------------------------------------- DEFRAG fragment cubes (one InstancedMesh)
  const CUBE_CAP = 512;
  const cubeGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const cubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const cubes = new THREE.InstancedMesh(cubeGeo, cubeMat, CUBE_CAP);
  cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CUBE_CAP * 3), 3);
  cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cubes.instanceColor.setUsage(THREE.DynamicDrawUsage);
  cubes.count = 0;
  cubes.frustumCulled = false;
  cubes.name = 'defragCubes';
  group.add(cubes);
  const FRAG = [0xff3b30, 0x2ef2ff, 0xffffff, 0x2f6bff, 0x39ff6a, 0xff3b30, 0x2ef2ff, 0x2f6bff, 0xffffff, 0xff3b30, 0x2f6bff, 0x2ef2ff, 0x39ff6a, 0xffffff, 0x2ef2ff, 0xff3b30]
    .map((h) => new THREE.Color(h).multiplyScalar(1.3));
  const GRID_COL = new THREE.Color(PALETTE.defrag).multiplyScalar(1.7);
  const _p0 = new THREE.Vector3();
  const _p1 = new THREE.Vector3();
  const _q0 = new THREE.Quaternion();
  const _q1 = new THREE.Quaternion();
  const _cs = new THREE.Vector3();
  const _cc = new THREE.Color();

  function drawCubes(tw, time, n) {
    const vis = tw.vis;
    if (vis.type !== 'defrag' || vis.anim === 'eject') return n;
    const count = 4 + 4 * vis.level;
    const rows = count / 4;
    let grow = 1;
    if (vis.anim === 'insert') grow = clamp01((vis.animT - 0.5) / 0.3);
    const pt = vis.pulseT;
    let gk = pt < 0.07 ? pt / 0.07 : pt < 0.24 ? 1 : 1 - clamp01((pt - 0.24) / 0.32);
    gk = gk * gk * (3 - 2 * gk);
    const yaw = vis.yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const px = tw.pos.x, pz = tw.pos.z;
    for (let i = 0; i < count && n < CUBE_CAP; i++) {
      const ph = i * 2.399 + tw.id * 0.7;
      // scattered (fragmented) orbit
      const a = time * 1.3 + (i / count) * TAU + 0.35 * Math.sin(time * 0.7 + ph);
      const rad = 0.58 + 0.07 * Math.sin(time * 1.9 + ph);
      _p0.set(px + Math.cos(a) * rad, 0.66 + 0.24 * Math.sin(time * 1.25 + ph), pz + Math.sin(a) * rad);
      _e.set(time * 2.1 + ph, time * 1.4 + ph * 0.5, 0);
      _q0.setFromEuler(_e);
      // defragmented grid hovering over the disk, aligned with the turret
      const col = i % 4, row = (i / 4) | 0;
      const lx = (col - 1.5) * 0.085;
      const ly = 1.3 + row * 0.085 - (rows - 2) * 0.04;
      const lz = -0.1;
      _p1.set(px + lx * cy + lz * sy, ly, pz - lx * sy + lz * cy);
      _e.set(0, yaw, 0);
      _q1.setFromEuler(_e);
      _p0.lerp(_p1, gk);
      _q0.slerp(_q1, gk);
      const sc = grow * (0.85 + 0.25 * gk);
      _cs.set(sc, sc, sc);
      _m4.compose(_p0, _q0, _cs);
      cubes.setMatrixAt(n, _m4);
      _cc.copy(FRAG[i % FRAG.length]).lerp(GRID_COL, gk);
      cubes.setColorAt(n, _cc);
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- sync proxies -> instanced meshes (once per step)
  function push(m, matrix, color = null, emissive = null) {
    const i = m.userData.n;
    if (i >= CAP) return;
    m.setMatrixAt(i, matrix);
    if (color && m.instanceColor) m.setColorAt(i, color);
    if (emissive && m.userData.emissive) m.userData.emissive.setXYZ(i, emissive.r, emissive.g, emissive.b);
    m.userData.n = i + 1;
  }

  function drawTower(vis) {
    vis.root.updateMatrixWorld(true);
    const lv = vis.level;
    const bw = vis.base.matrixWorld;
    push(P.base, bw);
    for (let i = 0; i < lv; i++) {
      _pm.makeTranslation(i * PIP_DX, 0, 0).premultiply(bw);
      push(P.pips, _pm, PIP_COLOR[vis.type]);
    }
    push(P.turntable, vis.turret.matrixWorld);
    push(P.turret, vis.head.matrixWorld);
    push(P.led, vis.cradle.matrixWorld, vis.ledColor);
    const fm = vis.floppy.matrixWorld;
    push(P.body[vis.type], fm, vis.tint, vis.emissive);
    push(P.ink, _im.multiplyMatrices(fm, INK_LOCAL));
    push(P.details, fm);
    push(P.label[vis.type][lv - 1], fm);
    push(lv >= 2 ? P.gold : P.metal, vis.shutter.matrixWorld);
    if (lv >= 2) {
      const bm = vis.backup.matrixWorld;
      push(P.backupBody[vis.type], bm);
      push(P.backupInk, _im.multiplyMatrices(bm, INK_LOCAL_BACKUP));
      push(P.backupDetails, bm);
      push(P.backupLabel, bm);
      push(P.trim, vis.cradle.matrixWorld);
    }
    if (lv >= 3) {
      push(P.antenna, vis.cradle.matrixWorld, GLOW[vis.type]);
      push(P.ring, vis.ring.matrixWorld, GLOW[vis.type]);
      push(P.groundRing, vis.groundRing.matrixWorld, BASE_COLOR[vis.type]);
    }
  }

  function sync(list, dying, time) {
    for (let i = 0; i < parts.length; i++) parts[i].userData.n = 0;
    let nc = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.vis) continue;
      drawTower(t.vis);
      nc = drawCubes(t, time, nc);
    }
    if (dying) for (let i = 0; i < dying.length; i++) if (dying[i].vis) drawTower(dying[i].vis);
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i];
      const n = m.userData.n;
      m.count = n;
      m.visible = warm || n > 0;
      if (n > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        if (m.userData.emissive) m.userData.emissive.needsUpdate = true;
      }
    }
    cubes.count = nc;
    cubes.visible = warm || nc > 0;
    if (nc) {
      cubes.instanceMatrix.needsUpdate = true;
      cubes.instanceColor.needsUpdate = true;
    }
    if (selectedVis) {
      outline.matrix.multiplyMatrices(selectedVis.floppy.matrixWorld, OUT_LOCAL);
      outline.matrixWorldNeedsUpdate = true;
      outline.visible = true;
    } else {
      outline.visible = warm;
      if (warm) { outline.matrix.makeScale(1e-5, 1e-5, 1e-5); outline.matrixWorldNeedsUpdate = true; }
    }
  }

  function clear() {
    for (let i = 0; i < parts.length; i++) { parts[i].count = 0; parts[i].visible = warm; parts[i].userData.n = 0; }
    cubes.count = 0;
    cubes.visible = warm;
    outline.visible = warm;
    selectedVis = null;
  }

  // ---------------------------------------------------------------- shader warm-up (no hitch on the first build/upgrade)
  // Every material a floppy can ever use (all 9 labels, the backup disk, v3 antenna/rings, outlines) exists from the
  // start and is attached to the scene. Until the scene has been rendered once for real, every part stays VISIBLE with
  // zero instances (no draws, no fill cost): the global renderer warm-up compiles them with the rest of the scene, and
  // the first real frame compiles any variant it missed (post render target, shadow depth pass, final light setup)
  // behind the boot screen instead of on the player's first click. renderer.compile() alone is not enough here: it
  // compiles for the canvas target (tone mapping + sRGB output) while the post chain renders the scene into a linear
  // render target, and it never builds the shadow-depth programs.
  let warm = true;
  let warmEnding = false;
  function endWarm() {
    if (!warm) return;
    warm = false;
    for (let i = 0; i < parts.length; i++) parts[i].visible = parts[i].count > 0;
    cubes.visible = cubes.count > 0;
    outline.visible = !!selectedVis;
  }
  for (const m of parts) m.visible = true;
  cubes.visible = true;
  outline.visible = true;
  // Hide the parts again on the NEXT animation frame, not right after this render: a warm-up may render the scene
  // several times in one task (e.g. once per quality variant, with and without the shadow-depth pass).
  P.base.onAfterRender = () => {
    if (warmEnding) return;
    warmEnding = true;
    delete P.base.onAfterRender;   // back to the prototype no-op
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(endWarm);
    else setTimeout(endWarm, 0);
  };

  return {
    G, M, P, group, cubes, outline,
    build, setLevel, muzzle, top, setSelected, disposeVis, animate, startAnim, updateShared, sync, clear,
    T_INSERT, T_UPGRADE, T_EJECT,
    dispose() {
      for (const t of textures) t.dispose();
    },
  };
}
