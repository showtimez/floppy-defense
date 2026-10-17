// WORLD module: the motherboard battlefield (docs/CONTRACTS.md section 5.3).
// Owns the static board look, the virus paths (data + glowing traces), slots, CPU, fan, heat spots,
// raycast targets and every board-level overlay (hover, selection, range, heat, CPU integrity).
import * as THREE from 'three';
import { BOARD, LAYERS, PALETTE } from '../config.js';
import { MAP } from '../data/map.js';
import { createPcbTextures } from './pcbTexture.js';
import { createLabelAtlas, createDieTexture } from './labels.js';
import { buildBoard, buildSlotSockets, createBoardMaterials, createTurboDisplay } from './board.js';
import { buildTraces, findSharedStart } from './traces.js';
import {
  createRangeDisc, createSlotMarker, createHeatHaze, createHeatGlow, createDieMaterial, createLeds, createPortGlow,
} from './overlays.js';

const HALF_W = (BOARD.W * BOARD.CELL) / 2;
const HALF_H = (BOARD.H * BOARD.CELL) / 2;
const RIM_TOP = 0.34;

const COL_OK = new THREE.Color(PALETTE.phosphor);
const COL_WARN = new THREE.Color(PALETTE.amber);
const COL_BAD = new THREE.Color(PALETTE.danger);
const COL_AMBER = new THREE.Color(PALETTE.amber);
const TOWER_TYPES = ['antivirus', 'firewall', 'defrag'];
const PORT_W = Math.PI * 2 * 1.5; // live-port pulse: 1.5 Hz in prep

// ---------------------------------------------------------------------------------------------
// Layout derivation (pure math, no scene)
// ---------------------------------------------------------------------------------------------
function cellX(c) { return (c + 0.5) * BOARD.CELL - HALF_W; }
function cellZ(r) { return (r + 0.5) * BOARD.CELL - HALF_H; }

function chamferPolyline(pts, ch) {
  if (pts.length < 3 || ch <= 0) return pts.map((p) => p.clone());
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const d0 = new THREE.Vector3().subVectors(p, a), d1 = new THREE.Vector3().subVectors(b, p);
    const l0 = d0.length(), l1 = d1.length();
    d0.divideScalar(l0 || 1); d1.divideScalar(l1 || 1);
    if (Math.abs(d0.dot(d1)) > 0.999) { out.push(p.clone()); continue; }
    const c = Math.min(ch, l0 * 0.45, l1 * 0.45);
    out.push(p.clone().addScaledVector(d0, -c), p.clone().addScaledVector(d1, c));
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

function makePath(def, chamfer) {
  const raw = def.cells.map(([c, r]) => new THREE.Vector3(cellX(c), 0, cellZ(r)));
  const points = chamferPolyline(raw, chamfer);
  const n = points.length;
  const cum = new Float32Array(n);
  const dirX = new Float32Array(Math.max(1, n - 1));
  const dirZ = new Float32Array(Math.max(1, n - 1));
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x, dz = points[i].z - points[i - 1].z;
    const l = Math.hypot(dx, dz);
    cum[i] = cum[i - 1] + l;
    dirX[i - 1] = l > 0 ? dx / l : 1;
    dirZ[i - 1] = l > 0 ? dz / l : 0;
  }
  return { id: def.id, name: def.name || def.id, points, length: cum[n - 1], cum, dirX, dirZ };
}

function deriveLayout(data) {
  const paths = data.paths.map((p) => makePath(p, data.chamfer ?? 0));
  const slots = data.slots.map(([c, r], id) => ({
    id, c, r,
    pos: new THREE.Vector3(cellX(c), 0, cellZ(r)),
    tower: null,
    letter: String.fromCharCode(65 + (id % 26)),
    name: `${String.fromCharCode(65 + (id % 26))}:`,
  }));
  const cpu = { pos: new THREE.Vector3(cellX(data.cpu.c), 0, cellZ(data.cpu.r)), radius: data.cpu.radius, size: data.cpu.size };
  const fan = { pos: new THREE.Vector3(cellX(data.fan.c), 0, cellZ(data.fan.r)), radius: data.fan.radius, size: data.fan.size };
  const ports = paths.map((p) => ({ id: p.id, name: p.name, pos: p.points[0].clone() }));
  const heatSpots = data.heatSpots.map((h) => ({ id: h.id, name: h.name, pos: new THREE.Vector3(cellX(h.c), 0, cellZ(h.r)), radius: h.radius }));
  const comps = data.components.map((cp) => ({ ...cp, x: cellX(cp.c), z: cellZ(cp.r) }));
  const silk = data.silk.map((s) => ({ ...s, x: cellX(s.c), z: cellZ(s.r) }));
  const screws = [[-11.55, -7.05], [11.6, -5.0], [-11.55, 7.05], [11.55, 7.05], [-1.4, -7.1], [0.45, 7.1]];
  const merge = data.mergePad ? new THREE.Vector3(cellX(data.mergePad[0]), 0, cellZ(data.mergePad[1])) : null;
  return { paths, slots, cpu, fan, ports, heatSpots, comps, silk, screws, merge };
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------
export function createMap(ctx) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const L = deriveLayout(MAP);
  const events = ctx.events;
  const scene = ctx.view?.scene || new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const hiQ = !(ctx.view?.isMobile) && ctx.view?.quality !== 'low';

  // ---- static board -----------------------------------------------------------------------------
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const tA = now();
  const atlas = createLabelAtlas();
  const tB = now();
  const pcb = createPcbTextures(L, { size: hiQ ? 2048 : 1024 });
  const tC = now();
  const mats = createBoardMaterials(atlas, hiQ ? 'high' : 'low');
  const board = buildBoard(ctx, L, atlas, pcb, mats);
  const tD = now();
  for (const m of board.meshes) root.add(m);

  // ---- virus traces -------------------------------------------------------------------------------
  const shared = findSharedStart(L.paths);
  const traces = buildTraces(L.paths, shared);
  root.add(traces.mesh);
  const TU = traces.uniforms;

  // merge pad (solder pad where the two streams meet) + pulsing ring
  let mergeRing = null;
  if (L.merge) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.56, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9ad55, roughness: 0.3, metalness: 0.5, emissive: 0x2a1c06 }));
    pad.position.set(L.merge.x, 0.014, L.merge.z);
    pad.receiveShadow = true;
    root.add(pad);
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2);
    mergeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COL_OK.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mergeRing.position.set(L.merge.x, 0.02, L.merge.z);
    mergeRing.renderOrder = 4;
    root.add(mergeRing);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    hole.position.set(L.merge.x, 0.016, L.merge.z);
    root.add(hole);
  }

  // ---- slot sockets -----------------------------------------------------------------------------------
  const sockets = buildSlotSockets(L.slots);
  root.add(sockets);

  // ---- BIOS holographic sticker -------------------------------------------------------------------------
  let holoMat = null;
  if (board.refs.biosSticker) {
    const st = board.refs.biosSticker, rg = atlas.regions.bios;
    holoMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: atlas.texture }, uRegion: { value: new THREE.Vector4(rg.u0, rg.v0, rg.u1, rg.v1) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D uMap; uniform vec4 uRegion; uniform float uTime; varying vec2 vUv; varying vec3 vW;
vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main(){
  vec2 auv = mix(uRegion.xy, uRegion.zw, vUv);
  vec3 t = texture2D(uMap, auv).rgb;
  float ink = 1.0 - dot(t, vec3(0.333));
  vec3 view = normalize(cameraPosition - vW);
  float h = fract(vUv.x * 0.9 + vUv.y * 0.6 + uTime * 0.07 + view.x * 0.8 + view.z * 0.5);
  vec3 rb = mix(vec3(0.85), hue(h), 0.55);
  float sparkle = step(0.985, fract(sin(dot(floor(vUv * vec2(60.0, 28.0)), vec2(12.9898, 78.233)) + floor(uTime * 3.0)) * 43758.5453));
  vec3 col = mix(rb + sparkle * 0.6, vec3(0.04), ink * 0.92);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(st.w, st.d).rotateX(-Math.PI / 2), holoMat);
    holo.position.set(st.x, st.y, st.z);
    root.add(holo);
  }

  // ---- CPU die + rim glow ---------------------------------------------------------------------------------
  const chip = board.refs.cpuChip;
  const dieMat = createDieMaterial(createDieTexture(256));
  const dieSize = chip.size * (232 / 512);
  const die = new THREE.Mesh(new THREE.PlaneGeometry(dieSize, dieSize).rotateX(-Math.PI / 2), dieMat);
  die.position.set(chip.x, chip.top + 0.004, chip.z);
  die.name = 'world:cpuDie';
  root.add(die);
  const rimMat = new THREE.MeshBasicMaterial({ color: COL_OK.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const parts = [];
    const h = chip.size / 2 + 0.01, t = 0.24;
    for (const [w, d, x, z] of [[2 * h + 2 * t, t, 0, -h - t / 2], [2 * h + 2 * t, t, 0, h + t / 2], [t, 2 * h, -h - t / 2, 0], [t, 2 * h, h + t / 2, 0]]) {
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      g.translate(x, 0, z);
      parts.push(g);
    }
    const geo = mergePlanes(parts);
    const rimMesh = new THREE.Mesh(geo, rimMat);
    rimMesh.position.set(chip.x, 0.296, chip.z);
    rimMesh.renderOrder = 4;
    root.add(rimMesh);
  }

  // ---- LEDs ----------------------------------------------------------------------------------------------
  const ledDefs = [];
  for (const s of L.slots) ledDefs.push({ kind: 'slot', slot: s, x: s.pos.x - 0.28, y: 0.165, z: s.pos.z + 0.33 });
  L.ports.forEach((p, i) => ledDefs.push({ kind: 'rx', port: i, x: -11.05, y: 0.03, z: p.pos.z + (p.pos.z < 0 ? -1.62 : 1.62) }));
  ledDefs.push({ kind: 'power', x: -1.45, y: RIM_TOP + 0.03, z: 8.12 });
  ledDefs.push({ kind: 'hdd', x: -0.95, y: RIM_TOP + 0.03, z: 8.12 });
  ledDefs.push({ kind: 'turbo', x: 3.35, y: RIM_TOP + 0.03, z: 8.12 });
  const leds = createLeds(ledDefs.length);
  {
    const m = new THREE.Matrix4();
    ledDefs.forEach((d, i) => {
      m.makeTranslation(d.x, d.y, d.z);
      leds.body.setMatrixAt(i, m);
      m.makeTranslation(d.x, d.y + 0.04, d.z);
      leds.halo.setMatrixAt(i, m);
      leds.body.setColorAt(i, COL_OK);
      leds.halo.setColorAt(i, COL_OK);
    });
    leds.body.instanceMatrix.needsUpdate = true;
    leds.halo.instanceMatrix.needsUpdate = true;
  }
  root.add(leds.body, leds.halo);

  // ---- port flashes (virus emerging from the serial connector) -------------------------------------------------
  // colour = virus colour x spawn flash + amber x live-port glow (additive; hidden when both are ~0)
  const portFlashCols = L.ports.map(() => new THREE.Color(PALETTE.worm));
  const portFlashes = L.ports.map((p) => {
    const mat = new THREE.MeshBasicMaterial({ map: leds.halo.material.map, color: new THREE.Color(0, 0, 0), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), mat);
    mesh.position.set(p.pos.x + 0.9, 0.05, p.pos.z);
    mesh.renderOrder = 7;
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  });

  // ---- live ports: DB-9 shell + COM label glow on the port(s) the next / current wave uses ------------------
  const portGlow = createPortGlow(L.ports, L.silk);
  root.add(portGlow.mesh);
  const portMask = new Uint8Array(L.ports.length);
  const portKey = { n: -1, mode: null };
  // Ports wave n spawns on (same rules as waves.spawnOne). Recomputed only when the wave number / mode changes.
  const refreshPortMask = (n) => {
    const mode = ctx.game?.mode ?? null;
    if (n === portKey.n && mode === portKey.mode) return;
    portKey.n = n;
    portKey.mode = mode;
    portMask.fill(0);
    if (!(n >= 1)) return;
    let def = null;
    try { def = ctx.waves?.def?.(n) || null; } catch (err) { def = null; }
    const groups = def?.groups;
    if (!Array.isArray(groups)) return;
    const np = portMask.length;
    for (const gr of groups) {
      const p = gr?.path;
      if (p === 'both' || p === 'rand' || (p === 'alt' && (gr.count ?? 2) > 1)) { portMask.fill(1); break; }
      const k = p === 'alt' ? 0 : Math.floor(Number(p) || 0);
      if (k >= 0 && np > 0) portMask[k % np] = 1;
    }
  };

  // ---- turbo display (front panel) ---------------------------------------------------------------------------
  const turbo = createTurboDisplay();
  turbo.mesh.position.set(6.2, RIM_TOP + 0.014, 8.12);
  root.add(turbo.mesh);

  // ---- overlays -----------------------------------------------------------------------------------------------
  const hover = createSlotMarker(PALETTE.phosphor);
  const selected = createSlotMarker(PALETTE.phosphor, { brackets: true });
  const fanAlert = createSlotMarker(PALETTE.amber, { brackets: true });
  fanAlert.group.position.copy(L.fan.pos);
  fanAlert.group.scale.setScalar((L.fan.size / 2 + 0.12) / 0.66);
  root.add(hover.group, selected.group, fanAlert.group);
  const range = createRangeDisc();
  root.add(range);

  const heat = {};
  for (const spot of L.heatSpots) {
    const haze = createHeatHaze(spot.radius);
    haze.position.set(spot.pos.x, 0.025, spot.pos.z);
    root.add(haze);
    const glows = (board.heatParts[spot.id] || []).map((p) => {
      const gm = createHeatGlow(p.w, p.d);
      gm.position.set(p.x, p.y, p.z);
      root.add(gm);
      return gm;
    });
    heat[spot.id] = { spot, haze, glows, level: 0, target: 0, over: 0, overTarget: 0 };
  }

  // ---- pick meshes (LAYERS.PICK only; never rendered by the main camera) -----------------------------------
  const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const pickRoot = new THREE.Group();
  pickRoot.name = 'world:pick';
  const pickMeshes = [];
  const slotGeo = new THREE.BoxGeometry(0.98, 1.15, 0.98).translate(0, 0.575, 0);
  const slotHits = L.slots.map((s) => {
    const m = new THREE.Mesh(slotGeo, pickMat);
    m.position.copy(s.pos);
    m.userData = { kind: 'slot', slotId: s.id };
    pickMeshes.push(m);
    return { kind: 'slot', slot: s };
  });
  {
    const fm = new THREE.Mesh(new THREE.CylinderGeometry(L.fan.radius, L.fan.radius, 1.0, 16).translate(0, 0.5, 0), pickMat);
    fm.position.copy(L.fan.pos);
    fm.userData = { kind: 'fan' };
    pickMeshes.push(fm);
    const cm = new THREE.Mesh(new THREE.BoxGeometry(L.cpu.size + 0.1, 0.6, L.cpu.size + 0.1).translate(0, 0.3, 0), pickMat);
    cm.position.copy(L.cpu.pos);
    cm.userData = { kind: 'cpu' };
    pickMeshes.push(cm);
  }
  for (const m of pickMeshes) {
    m.layers.set(LAYERS.PICK);
    m.castShadow = false;
    m.receiveShadow = false;
    m.updateMatrixWorld(true);
    pickRoot.add(m);
  }
  root.add(pickRoot);
  const FAN_HIT = { kind: 'fan' };
  const CPU_HIT = { kind: 'cpu' };
  const hits = [];

  // ---- dynamic state -------------------------------------------------------------------------------------------
  const st = {
    hoverSlot: null,
    selSlot: null,
    rangeTarget: 0,
    rangeShown: false,
    fanTarget: 1,
    fanSpeed: 1,
    fanAngle: 0,
    cpuFrac: 1,
    cpuShown: 1,
    cpuHit: 0,
    flow: 1.3,
    flowT: 0,
    pulse: 0,
    hdd: 0,
    shownSpeed: 1,
    slotFlash: new Float32Array(L.slots.length),
    rxFlash: new Float32Array(L.ports.length),
    portAmt: new Float32Array(L.ports.length),        // smoothed live-port glow per port
    portHold: 0,                                       // 1 after prep/wave: keep the steady glow while paused
    sockK: new Float32Array(L.slots.length).fill(1),  // smoothed drive-bay tint
    sockW: new Float32Array(L.slots.length).fill(1),  // last tint written to sockets.instanceColor
    minCost: 0,
  };
  // cheapest floppy (KB): threshold for "an empty bay is affordable" (prep breathing)
  const cheapestCost = () => {
    if (st.minCost > 0) return st.minCost;
    let m = Infinity;
    try {
      for (const ty of TOWER_TYPES) { const c = ctx.towers?.getDef?.(ty, 1)?.cost; if (c > 0 && c < m) m = c; }
    } catch (err) { /* towers stub */ }
    st.minCost = Number.isFinite(m) ? m : 64;
    return st.minCost;
  };
  const tmpCol = new THREE.Color();
  const tmpCol2 = new THREE.Color();
  const tmpCol3 = new THREE.Color();
  const integrityColor = (f, out) => {
    if (f > 0.6) return out.copy(COL_WARN).lerp(COL_OK, (f - 0.6) / 0.4);
    if (f > 0.3) return out.copy(COL_BAD).lerp(COL_WARN, (f - 0.3) / 0.3);
    return out.copy(COL_BAD);
  };

  // ---- events --------------------------------------------------------------------------------------------------
  events?.on?.('enemy:spawn', ({ enemy } = {}) => {
    const i = enemy?.pathIndex ?? 0;
    if (i < 0 || i >= st.rxFlash.length) return;
    st.rxFlash[i] = enemy?.isBoss ? 1.6 : 1;
    const col = enemy?.color ?? enemy?.def?.color;
    if (col != null) { try { portFlashCols[i].set(col); } catch (err) { /* bad colour */ } }
  });
  events?.on?.('boss:spawn', () => { st.pulse = 1.4; });
  events?.on?.('tower:fire', ({ tower } = {}) => {
    const id = tower?.slot?.id;
    if (id != null && id < st.slotFlash.length) st.slotFlash[id] = 1;
  });
  events?.on?.('enemy:killed', () => { st.hdd = 1; });
  events?.on?.('tower:placed', ({ tower } = {}) => {
    const id = tower?.slot?.id;
    if (id != null && id < st.slotFlash.length) st.slotFlash[id] = 1.6;
  });
  events?.on?.('cpu:damage', () => map.pulseCpuHit());
  events?.on?.('wave:start', () => { st.pulse = 1; });
  events?.on?.('game:new', () => { portKey.n = -1; });
  events?.on?.('speed:change', ({ speed } = {}) => turbo.draw((speed ?? 1) > 1 ? '66' : '33'));

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------
  const map = {
    grid: { w: BOARD.W, h: BOARD.H, cell: BOARD.CELL },
    paths: L.paths,
    slots: L.slots,
    cpu: { pos: L.cpu.pos, radius: L.cpu.radius },
    fan: { pos: L.fan.pos, radius: L.fan.radius },
    ports: L.ports,
    heatSpots: L.heatSpots,
    root,
    data: MAP,
    // read by the render module to frame the board + rim + serial connectors
    viewBounds: { minX: -12.6, maxX: 12.6, minZ: -7.9, maxZ: 7.9 },
    // read-only: 1 per port the next wave (prep) / current wave (wave) spawns on; refreshed by update()
    livePorts: portMask,

    cellToWorld(c, r, out = new THREE.Vector3()) {
      return out.set(cellX(c), 0, cellZ(r));
    },

    worldToCell(x, z) {
      const c = Math.floor((x + HALF_W) / BOARD.CELL);
      const r = Math.floor((z + HALF_H) / BOARD.CELL);
      if (c < 0 || r < 0 || c >= BOARD.W || r >= BOARD.H) return null;
      return { c, r };
    },

    // Position at `dist` along path `pathIndex` (clamped). Zero allocations; binary search on cumulative lengths.
    samplePath(pathIndex, dist, outPos, outDir) {
      const p = L.paths[pathIndex] || L.paths[0];
      if (!outPos) outPos = new THREE.Vector3();
      if (!p) return outPos.set(0, 0, 0);
      const cum = p.cum, n = cum.length;
      const d = dist > 0 ? (dist < p.length ? dist : p.length) : 0;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const a = p.points[lo], b = p.points[hi];
      const seg = cum[hi] - cum[lo];
      const t = seg > 0 ? (d - cum[lo]) / seg : 0;
      outPos.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
      if (outDir) outDir.set(p.dirX[lo], 0, p.dirZ[lo]);
      return outPos;
    },

    pick(raycaster) {
      if (!raycaster) return null;
      raycaster.layers?.enable?.(LAYERS.PICK);
      hits.length = 0;
      raycaster.intersectObjects(pickMeshes, false, hits);
      for (let i = 0; i < hits.length; i++) {
        const u = hits[i].object.userData;
        if (u.kind === 'slot') return slotHits[u.slotId] || null;
        if (u.kind === 'fan') return FAN_HIT;
        if (u.kind === 'cpu') return CPU_HIT;
      }
      return null;
    },

    setHover(slot, color) {
      st.hoverSlot = slot || null;
      if (!slot) { hover.group.visible = false; return; }
      hover.group.position.set(slot.pos.x, 0, slot.pos.z);
      hover.material.color.set(color ?? PALETTE.phosphor).multiplyScalar(2.0);
      if (hover.fill) hover.fill.material.color.set(color ?? PALETTE.phosphor);
      hover.group.visible = st.selSlot !== slot;
    },

    setSelected(slot, color) {
      st.selSlot = slot || null;
      if (!slot) { selected.group.visible = false; if (st.hoverSlot) hover.group.visible = true; return; }
      selected.group.position.set(slot.pos.x, 0, slot.pos.z);
      selected.material.color.set(color ?? PALETTE.phosphor).multiplyScalar(2.2);
      selected.group.visible = true;
      if (st.hoverSlot === slot) hover.group.visible = false;
    },

    showRange(pos, radius = 3, color = PALETTE.phosphor) {
      if (!pos) { st.rangeTarget = 0; return; }
      const r = Math.max(0.2, radius || 0.2);
      range.position.set(pos.x, 0.03, pos.z);
      range.scale.set(r, 1, r);
      range.material.uniforms.uRadius.value = r;
      range.material.uniforms.uColor.value.set(color ?? PALETTE.phosphor);
      if (!st.rangeShown) range.material.uniforms.uOpacity.value = 0;
      st.rangeTarget = 1;
      st.rangeShown = true;
      range.visible = true;
    },

    setHeatVisual(spotId, level = 0, overheated = false) {
      const h = heat[spotId];
      if (!h) return;
      h.target = Math.max(0, Math.min(1, level || 0));
      h.overTarget = overheated ? 1 : 0;
    },

    setFanSpeed(mult = 1) {
      st.fanTarget = Math.max(0, Math.min(12, Number(mult) || 0));
    },

    setCpuIntegrity(frac = 1) {
      st.cpuFrac = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 1));
    },

    pulseCpuHit() {
      st.cpuHit = 1;
    },

    update(dt = 0.016, t = 0) {
      if (!(dt > 0)) dt = 0.016;
      if (dt > 0.1) dt = 0.1;
      const phase = ctx.game?.phase;
      const inWave = phase === 'wave';
      const k = 1 - Math.exp(-dt * 3);

      // CPU integrity (smoothed for a nice colour slide)
      st.cpuShown += (st.cpuFrac - st.cpuShown) * (1 - Math.exp(-dt * 5));
      const f = st.cpuShown;
      st.cpuHit = Math.max(0, st.cpuHit - dt * 2.2);
      integrityColor(f, tmpCol);
      const danger = Math.max(0, Math.min(1, (0.5 - f) / 0.4));

      // data flow along the traces
      st.flow += ((inWave ? 3.8 : phase === 'paused' ? 0.5 : 1.3) - st.flow) * k;
      const spacing = TU.uSpacing.value;
      st.flowT = (st.flowT + dt * st.flow) % (spacing * 100);
      st.pulse = Math.max(0, st.pulse - dt * 1.4);
      TU.uTime.value = st.flowT;
      TU.uBeat.value = (t * 2.6) % (Math.PI * 200);
      TU.uDanger.value = danger;
      TU.uPulse.value = Math.min(1.5, st.pulse * st.pulse);
      TU.uIntensity.value = (inWave ? 1.5 : 1.0) + st.cpuHit * 0.8;
      TU.uFlowColor.value.copy(COL_OK).lerp(COL_BAD, danger);
      const SG = board.refs.pcbSignal;
      if (SG) {
        SG.uSigT.value = (SG.uSigT.value + (dt * st.flow * 0.55) / (pcb.signalPeriod || 3.2)) % 1000;
        SG.uSigAmt.value = (inWave ? 1.0 : 0.55) * (1 + danger * 0.5);
        SG.uSigCol.value.copy(TU.uFlowColor.value);
      }
      if (mergeRing) {
        mergeRing.material.color.copy(TU.uFlowColor.value).multiplyScalar(0.6 + 0.5 * Math.sin(t * 4) * 0.5 + (inWave ? 0.5 : 0));
        const sc = 1 + 0.12 * Math.sin(t * 3);
        mergeRing.scale.set(sc, 1, sc);
      }

      // CPU die
      const U = dieMat.uniforms;
      U.uTime.value = t % 1000;
      U.uColor.value.copy(tmpCol);
      U.uCrack.value = f < 0.3 ? Math.min(1, (0.3 - f) / 0.27) : 0;
      U.uHit.value = st.cpuHit;
      let flick = 1;
      if (f < 0.3) {
        const n = Math.sin(t * 37.3) * Math.sin(t * 91.7 + 1.3);
        flick = n > 0.55 ? 0.25 : n < -0.8 ? 1.5 : 1;
      }
      U.uFlicker.value = flick;
      U.uIntensity.value = 0.85 + 0.35 * (1 - f) + st.cpuHit;
      rimMat.color.copy(tmpCol).lerp(COL_BAD, st.cpuHit).multiplyScalar(((0.32 + 0.12 * Math.sin(t * 2.2)) * flick + st.cpuHit * 1.2) * (1 + danger));

      // fan
      st.fanSpeed += (st.fanTarget - st.fanSpeed) * (1 - Math.exp(-dt * 3.5));
      st.fanAngle = (st.fanAngle + dt * st.fanSpeed * 6.5) % (Math.PI * 2000);
      if (board.refs.fanRotor) board.refs.fanRotor.rotation.y = -st.fanAngle;
      if (board.refs.fanBlur) {
        board.refs.fanBlur.uniforms.uAmt.value = Math.max(0, Math.min(0.85, (st.fanSpeed - 2.2) / 4));
        board.refs.fanBlur.uniforms.uAng.value = -st.fanAngle * 0.37;
      }
      const ha = ctx.heat?.active;
      const heatOn = !!(ha && (phase === 'prep' || phase === 'wave'));
      fanAlert.group.visible = heatOn;
      if (heatOn) {
        const over = ha.overheated ? 1 : 0;
        const p = 0.5 + 0.5 * Math.sin(t * (over ? 12 : 6));
        fanAlert.material.color.copy(over ? COL_BAD : COL_WARN).multiplyScalar(0.8 + p * 1.8);
        fanAlert.brackets.scale.setScalar(1 + 0.07 * p);
      }

      // heat visuals
      for (const id in heat) {
        const h = heat[id];
        h.level += (h.target - h.level) * (1 - Math.exp(-dt * 4));
        h.over += (h.overTarget - h.over) * (1 - Math.exp(-dt * 5));
        const vis = h.level > 0.01;
        h.haze.visible = vis;
        if (vis) {
          const u = h.haze.material.uniforms;
          u.uLevel.value = h.level; u.uOver.value = h.over; u.uTime.value = t % 1000;
        }
        for (const g of h.glows) {
          g.visible = vis;
          if (vis) { const u = g.material.uniforms; u.uLevel.value = h.level; u.uOver.value = h.over; u.uTime.value = t % 1000; }
        }
      }

      // markers
      if (selected.group.visible) {
        const p = 0.5 + 0.5 * Math.sin(t * 5);
        selected.brackets.scale.setScalar(1 + 0.08 * p);
        selected.material.opacity = 0.75 + 0.25 * p;
      }
      if (hover.group.visible) hover.material.opacity = 0.82 + 0.18 * Math.sin(t * 4);
      {
        const u = range.material.uniforms;
        u.uTime.value = t % 1000;
        u.uOpacity.value += (st.rangeTarget - u.uOpacity.value) * (1 - Math.exp(-dt * 14));
        if (st.rangeTarget === 0 && u.uOpacity.value < 0.02) { range.visible = false; st.rangeShown = false; }
      }
      if (holoMat) holoMat.uniforms.uTime.value = t % 1000;

      // LEDs
      const prep = phase === 'prep';
      for (let i = 0; i < st.slotFlash.length; i++) st.slotFlash[i] = Math.max(0, st.slotFlash[i] - dt * 9);
      for (let i = 0; i < st.rxFlash.length; i++) st.rxFlash[i] = Math.max(0, st.rxFlash[i] - dt * 3.2);
      st.hdd = Math.max(0, st.hdd - dt * 6);

      // live serial ports: amber pulse on the port(s) the NEXT wave uses (prep), steady dim glow during the wave
      let liveMode = 0;
      if (prep) { refreshPortMask((ctx.game?.wave ?? 0) + 1); liveMode = 1; st.portHold = 1; }
      else if (inWave) { refreshPortMask(ctx.game?.wave ?? 0); liveMode = 2; st.portHold = 1; }
      else if (phase === 'paused' && st.portHold) liveMode = 2;
      else st.portHold = 0;
      {
        const pulse = 0.5 + 0.5 * Math.sin(t * PORT_W);
        const kp = 1 - Math.exp(-dt * 16);
        let on = false;
        for (let i = 0; i < st.portAmt.length; i++) {
          const target = !liveMode || !portMask[i] ? 0 : liveMode === 1 ? 0.25 + 0.95 * pulse : 0.32;
          let a = st.portAmt[i] + (target - st.portAmt[i]) * kp;
          if (a < 0.002) a = 0; else on = true;
          st.portAmt[i] = a;
          if (i < 4) portGlow.amt.setComponent(i, a);
        }
        portGlow.mesh.visible = on;
      }

      // drive bays: recede during waves, breathe in prep while a floppy is affordable, pop on hover / selection
      const afford = prep && (ctx.game?.kb ?? 0) >= cheapestCost();
      {
        const ks = 1 - Math.exp(-dt * 14);
        let dirty = false;
        for (let i = 0; i < L.slots.length; i++) {
          const s = L.slots[i];
          let target;
          if (s === st.hoverSlot || s === st.selSlot) target = 1.4;
          else if (s.tower) target = 0.6;
          else if (inWave) target = 0.55;
          else if (prep) target = afford ? 1.05 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.4 + s.id * 0.7)) : 0.8;
          else target = 0.9;
          const v = (st.sockK[i] += (target - st.sockK[i]) * ks);
          if (Math.abs(v - st.sockW[i]) > 0.01) {
            st.sockW[i] = v;
            sockets.setColorAt(i, tmpCol2.setScalar(v));
            dirty = true;
          }
        }
        if (dirty && sockets.instanceColor) sockets.instanceColor.needsUpdate = true;
      }

      for (let i = 0; i < ledDefs.length; i++) {
        const d = ledDefs[i];
        let r = 0, g = 0, b = 0, glow = 0;
        if (d.kind === 'slot') {
          const s = d.slot;
          const fl = st.slotFlash[s.id];
          if (s.tower) {
            r = 0.3 + fl * 1.2; g = 2.0 + fl * 1.2; b = 0.45 + fl * 1.0; glow = 0.55 + fl * 0.6;
          } else {
            const breathe = afford ? 0.5 + 0.5 * Math.sin(t * 2.4 + s.id * 0.7) : 0.3; // in sync with the bay tint
            r = 0.04; g = 0.22 + 0.35 * breathe; b = 0.07; glow = 0.08 + 0.16 * breathe;
            if (st.hoverSlot === s || st.selSlot === s) { g += 0.9; glow += 0.3; }
          }
        } else if (d.kind === 'rx') {
          const fl = st.rxFlash[d.port];
          const a = st.portAmt[d.port];
          r = 0.25 + fl * 2.4 + a * 1.9; g = 0.1 + fl * 1.1 + a * 0.85; b = 0.0; glow = 0.08 + fl * 1.1 + a * 0.9;
        } else if (d.kind === 'power') {
          r = 0.3; g = 2.0; b = 0.4; glow = 0.5;
        } else if (d.kind === 'hdd') {
          const busy = inWave ? (Math.sin(t * 31) * Math.sin(t * 17) > 0.2 ? 1 : 0.15) : 0.1;
          const v = Math.max(busy * 0.7, st.hdd);
          r = 0.2 + 2.2 * v; g = 0.1 + 1.1 * v; b = 0; glow = 0.08 + 0.6 * v;
        } else if (d.kind === 'turbo') {
          const spd = ctx.game?.speed ?? 1;
          const on = spd > 1;
          if (spd !== st.shownSpeed) { st.shownSpeed = spd; turbo.draw(on ? '66' : '33'); }
          r = on ? 2.0 : 0.2; g = on ? 1.6 : 0.16; b = 0.05; glow = on ? 0.6 : 0.05;
        }
        tmpCol2.setRGB(r, g, b);
        leds.body.setColorAt(i, tmpCol2);
        tmpCol2.multiplyScalar(glow * 0.45);
        leds.halo.setColorAt(i, tmpCol2);
      }
      if (leds.body.instanceColor) leds.body.instanceColor.needsUpdate = true;
      if (leds.halo.instanceColor) leds.halo.instanceColor.needsUpdate = true;
      for (let i = 0; i < portFlashes.length; i++) {
        const fl = st.rxFlash[i];
        const fa = Math.min(1, fl * fl * 0.9);  // virus emerging
        const ga = st.portAmt[i] * 0.3;         // live-port glow on the trace entry
        const pm = portFlashes[i];
        pm.visible = fa + ga > 0.003;
        if (pm.visible) pm.material.color.copy(portFlashCols[i]).multiplyScalar(fa).add(tmpCol3.copy(COL_AMBER).multiplyScalar(ga));
      }
    },

    reset() {
      map.setHover(null);
      map.setSelected(null);
      st.rangeTarget = 0;
      range.visible = false;
      st.rangeShown = false;
      range.material.uniforms.uOpacity.value = 0;
      for (const id in heat) {
        const h = heat[id];
        h.target = h.level = h.over = h.overTarget = 0;
        h.haze.visible = false;
        for (const g of h.glows) g.visible = false;
      }
      st.fanTarget = 1;
      st.cpuFrac = 1;
      st.cpuShown = 1;
      st.cpuHit = 0;
      st.pulse = 0;
      st.hdd = 0;
      st.slotFlash.fill(0);
      st.rxFlash.fill(0);
      st.portAmt.fill(0);
      st.portHold = 0;
      st.minCost = 0;
      portKey.n = -1;
      portGlow.mesh.visible = false;
      for (const pm of portFlashes) pm.visible = false;
      for (const s of L.slots) s.tower = null;
      turbo.draw('33');
      st.shownSpeed = 1;
    },
  };

  map.buildMs = Math.round(now() - t0);
  map.timings = { atlas: Math.round(tB - tA), pcb: Math.round(tC - tB), board: Math.round(tD - tC) };
  return map;
}

function mergePlanes(list) {
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
