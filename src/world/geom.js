// Low-poly part builder: primitives are baked (transform + vertex colour) into material buckets and merged,
// so the whole static board renders in a handful of draw calls.
// Pattern adapted from ZelariFPS/src/render/utilModels.js (push into buckets -> vertex colours -> merge).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

// Normalise a geometry so every bucket member has position/normal/uv/color and no index.
function normalise(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
  }
  if (!g.attributes.color || color !== undefined) {
    _c.set(color ?? 0xffffff);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  g.groups.length = 0;
  return g;
}

export function createBuilder() {
  const buckets = new Map();

  // Add any geometry (consumed / cloned) with a transform and a flat vertex colour.
  function add(key, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = normalise(geo.clone(), color);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(g);
    return g;
  }

  // Axis-aligned box resting on y0 (bottom at y0) unless centred = true.
  function box(key, color, w, h, d, x, y0, z, ry = 0) {
    return add(key, BOX, color, x, y0 + h / 2, z, 0, ry, 0, w, h, d);
  }

  function cyl(key, color, rTop, rBot, h, x, y0, z, seg = 10, rx = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
    const out = add(key, g, color, x, y0 + h / 2, z, rx, 0, rz);
    g.dispose();
    return out;
  }

  // Flat textured quad facing +Y whose UVs map to an atlas region {u0,v0,u1,v1}.
  function label(key, region, w, d, x, y, z, ry = 0, color = 0xffffff) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, region.u0 + uv.getX(i) * (region.u1 - region.u0), region.v0 + uv.getY(i) * (region.v1 - region.v0));
    }
    const out = add(key, g, color, x, y, z, 0, ry, 0);
    g.dispose();
    return out;
  }

  // Merge each bucket into one mesh. materials: { key: Material }.
  function build(materials, { castShadow = true, receiveShadow = false } = {}) {
    const meshes = [];
    for (const [key, list] of buckets) {
      const mat = materials[key];
      if (!mat || !list.length) continue;
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `board:${key}`;
      mesh.castShadow = castShadow && mat.userData.noShadow !== true;
      mesh.receiveShadow = receiveShadow || mat.userData.receive === true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    buckets.clear();
    return meshes;
  }

  return { add, box, cyl, label, build, buckets };
}

export const BOX = new THREE.BoxGeometry(1, 1, 1);

// Rounded-rectangle / trapezoid helpers for ExtrudeGeometry shapes (XY plane).
export function roundedRectShape(w, h, r) {
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

// D-sub trapezoid (wide side at +y) with rounded corners, as a Path (usable for shapes and holes).
export function trapezoidPath(wTop, wBot, h, r, PathCtor = THREE.Shape) {
  const p = new PathCtor();
  const pts = [[-wBot / 2, -h / 2], [wBot / 2, -h / 2], [wTop / 2, h / 2], [-wTop / 2, h / 2]];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i + n - 1) % n];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[(i + 1) % n];
    const l1 = Math.hypot(ax - bx, ay - by), l2 = Math.hypot(cx - bx, cy - by);
    const p1x = bx + (ax - bx) / l1 * r, p1y = by + (ay - by) / l1 * r;
    const p2x = bx + (cx - bx) / l2 * r, p2y = by + (cy - by) / l2 * r;
    if (i === 0) p.moveTo(p1x, p1y); else p.lineTo(p1x, p1y);
    p.quadraticCurveTo(bx, by, p2x, p2y);
  }
  p.closePath();
  return p;
}
