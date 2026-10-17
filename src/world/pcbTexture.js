// Runtime-generated PCB textures (Compo-safe: everything drawn with Canvas2D).
//  - albedo: green solder mask, copper pours, routed traces (45-degree bends), vias, pads, silkscreen
//  - surf:   packed surface map  R = height (bump), G = roughness, B = metalness
import * as THREE from 'three';
import { createRng } from '../core/rng.js';

// style -> [albedo css, height 0..1, roughness 0..1, metalness 0..1]
const STYLES = {
  mask: ['#0d3a26', 0.40, 0.42, 0],
  pour: ['#104a2f', 0.47, 0.38, 0],
  gap: ['#0b3221', 0.38, 0.45, 0],
  trace: ['#1d6b43', 0.56, 0.32, 0],
  traceHi: ['#2a8553', 0.58, 0.30, 0],
  halo: ['#03120a', 0.30, 0.55, 0],
  haloEdge: ['#1a6440', 0.50, 0.40, 0],
  pad: ['#cfc8b2', 0.66, 0.28, 0.85],
  gold: ['#d8ad55', 0.66, 0.26, 1],
  hole: ['#040504', 0.05, 0.9, 0],
  silk: ['#e6e8d6', 0.55, 0.82, 0],
  silkDim: ['#b9c2ad', 0.53, 0.82, 0],
  smd: ['#141414', 0.75, 0.55, 0],
  smdTan: ['#9a7a4e', 0.72, 0.6, 0],
  sticker: ['#f1efe6', 0.6, 0.7, 0],
  stickerGreen: ['#46c46a', 0.6, 0.7, 0],
  black: ['#0a0a0a', 0.6, 0.7, 0],
};

function surfCss(st) {
  const s = STYLES[st];
  return `rgb(${Math.round(s[1] * 255)},${Math.round(s[2] * 255)},${Math.round(s[3] * 255)})`;
}

// Draw into both canvases at once (albedo + surface), in world units.
function createPainter(cA, cB, S) {
  const a = cA.getContext('2d');
  const b = cB.getContext('2d');
  const both = [a, b];
  const X = (x) => (x + 12) * S;
  const Z = (z) => (z + 7.5) * S;
  function style(st, alpha = 1) {
    a.fillStyle = a.strokeStyle = STYLES[st][0];
    b.fillStyle = b.strokeStyle = surfCss(st);
    a.globalAlpha = alpha;
    b.globalAlpha = alpha;
  }
  return {
    a, b, X, Z, S, style,
    rect(st, x, z, w, d, alpha = 1) {
      style(st, alpha);
      for (const c of both) c.fillRect(X(x - w / 2), Z(z - d / 2), w * S, d * S);
    },
    strokeRect(st, x, z, w, d, lw) {
      style(st);
      for (const c of both) { c.lineWidth = lw * S; c.strokeRect(X(x - w / 2), Z(z - d / 2), w * S, d * S); }
    },
    circle(st, x, z, r, alpha = 1) {
      style(st, alpha);
      for (const c of both) { c.beginPath(); c.arc(X(x), Z(z), r * S, 0, Math.PI * 2); c.fill(); }
    },
    ring(st, x, z, r, lw) {
      style(st);
      for (const c of both) { c.lineWidth = lw * S; c.beginPath(); c.arc(X(x), Z(z), r * S, 0, Math.PI * 2); c.stroke(); }
    },
    arc(st, x, z, r, a0, a1, lw) {
      style(st);
      for (const c of both) { c.lineWidth = lw * S; c.beginPath(); c.arc(X(x), Z(z), r * S, a0, a1); c.stroke(); }
    },
    line(st, pts, lw, cap = 'round') {
      if (pts.length < 2) return;
      style(st);
      for (const c of both) {
        c.lineWidth = lw * S;
        c.lineCap = cap;
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(X(pts[0][0]), Z(pts[0][1]));
        for (let i = 1; i < pts.length; i++) c.lineTo(X(pts[i][0]), Z(pts[i][1]));
        c.stroke();
      }
    },
    poly(st, pts, alpha = 1) {
      style(st, alpha);
      for (const c of both) {
        c.beginPath();
        c.moveTo(X(pts[0][0]), Z(pts[0][1]));
        for (let i = 1; i < pts.length; i++) c.lineTo(X(pts[i][0]), Z(pts[i][1]));
        c.closePath();
        c.fill();
      }
    },
    text(st, str, x, z, size, { rot = 0, align = 'center', font = 'sans', weight = 'bold' } = {}) {
      style(st);
      const fam = font === 'mono' ? '"Courier New", Courier, monospace' : '"Arial Narrow", Arial, Helvetica, sans-serif';
      for (const c of both) {
        c.save();
        c.translate(X(x), Z(z));
        if (rot) c.rotate((rot * Math.PI) / 180);
        c.font = `${weight} ${Math.max(4, size * S * 1.32)}px ${fam}`;
        c.textAlign = align;
        c.textBaseline = 'middle';
        c.fillText(str, 0, 0);
        c.restore();
      }
    },
    alpha(v) { a.globalAlpha = v; b.globalAlpha = v; },
  };
}

// Occupancy grid used to route decorative traces and place tiny parts without hitting gameplay areas.
function createGrid(step) {
  const w = Math.round(24 / step), h = Math.round(15 / step);
  const g = new Int32Array(w * h);
  const ci = (x) => Math.floor((x + 12) / step);
  const ri = (z) => Math.floor((z + 7.5) / step);
  return {
    w, h, step, g,
    ci, ri,
    cx: (i) => (i + 0.5) * step - 12,
    rz: (j) => (j + 0.5) * step - 7.5,
    get(i, j) { return i < 0 || j < 0 || i >= w || j >= h ? -1 : g[j * w + i]; },
    set(i, j, v) { if (i >= 0 && j >= 0 && i < w && j < h) g[j * w + i] = v; },
    blockRect(x, z, hw, hd, v = -1) {
      for (let j = ri(z - hd); j <= ri(z + hd); j++) for (let i = ci(x - hw); i <= ci(x + hw); i++) this.set(i, j, v);
    },
    blockSeg(x0, z0, x1, z1, r, v = -1) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / (step * 0.5)));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
        this.blockRect(x, z, r, r, v);
      }
    },
    rectFree(x, z, hw, hd) {
      for (let j = ri(z - hd); j <= ri(z + hd); j++) for (let i = ci(x - hw); i <= ci(x + hw); i++) if (this.get(i, j) !== 0) return false;
      return true;
    },
  };
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

// Component footprints (half sizes) in world units, used for blocking + silkscreen.
export function footprint(cp) {
  switch (cp.type) {
    case 'ram': return [cp.len / 2 + 0.25, 0.95];
    case 'chipset': return [cp.size / 2 + 0.12, cp.size / 2 + 0.12];
    case 'qfp': return [cp.size / 2 + 0.14, cp.size / 2 + 0.14];
    case 'vrm': return [2.1, 0.55];
    case 'bios': return [0.86, 0.36];
    case 'battery': return [0.48, 0.48];
    case 'isa': return [cp.len / 2 + 0.05, 0.22];
    case 'din': return [0.62, 0.62];
    case 'power': return [0.55, 0.75];
    case 'crystal': return [0.4, 0.2];
    case 'dip': return cp.rot ? [0.22, cp.len / 2 + 0.05] : [cp.len / 2 + 0.05, 0.22];
    case 'fanHeader': return [0.25, 0.15];
    case 'jumper': return cp.rot ? [0.12, cp.n * 0.065 + 0.05] : [cp.n * 0.065 + 0.05, 0.12];
    case 'cap': return [cp.rad + 0.06, cp.rad + 0.06];
    default: return [0.3, 0.3];
  }
}

export function createPcbTextures(layout, { size = 2048 } = {}) {
  const rng = createRng(1996);
  const W = size, H = Math.round((size * 15) / 24);
  const S = W / 24;
  const cA = document.createElement('canvas');
  const cB = document.createElement('canvas');
  cA.width = cB.width = W;
  cA.height = cB.height = H;
  const P = createPainter(cA, cB, S);
  const { paths, slots, comps, cpu, fan, ports } = layout;

  // ---- 1. base mask + mottling --------------------------------------------------------------
  P.rect('mask', 0, 0, 24, 15);
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-12, 12), z = rng.range(-7.5, 7.5), r = rng.range(2, 6) * S;
    const g = P.a.createRadialGradient(P.X(x), P.Z(z), 0, P.X(x), P.Z(z), r);
    const light = rng.chance(0.5);
    g.addColorStop(0, light ? 'rgba(40,120,80,0.10)' : 'rgba(0,10,5,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    P.a.globalAlpha = 1;
    P.a.fillStyle = g;
    P.a.fillRect(0, 0, W, H);
  }

  // ---- 2. copper pours (lighter, slightly raised planes under the mask) ---------------------------
  const pours = [
    [[-11.7, -7.2], [-6.6, -7.2], [-6.6, -5.2], [-8.0, -3.8], [-11.7, -3.8]],
    [[-11.7, 1.4], [-8.4, 1.4], [-8.4, 7.2], [-11.7, 7.2]],
    [[0.2, 4.0], [11.7, 4.0], [11.7, 7.2], [0.2, 7.2]],
    [[2.6, -1.6], [3.8, -2.8], [8.6, -2.8], [8.6, 2.8], [3.8, 2.8], [2.6, 1.6]],
    [[-4.6, 2.4], [-1.8, 2.4], [-1.8, 7.2], [-4.6, 7.2]],
    [[9.2, -2.6], [11.7, -2.6], [11.7, 2.6], [9.2, 2.6]],
  ];
  for (const p of pours) P.poly('pour', p);
  // hatch texture inside pours (classic 90s cross-hatched planes, very subtle)
  P.a.save();
  P.a.globalAlpha = 0.08;
  P.a.strokeStyle = '#000';
  P.a.lineWidth = Math.max(1, S * 0.02);
  for (let k = -40; k < 60; k++) {
    P.a.beginPath();
    P.a.moveTo(P.X(-12 + k * 0.5), P.Z(-7.5));
    P.a.lineTo(P.X(-12 + k * 0.5 - 15), P.Z(7.5));
    P.a.stroke();
  }
  P.a.restore();
  // mask back over the non-pour area for the hatch: re-fill gaps is overkill; hatch stays faint everywhere.

  // ---- occupancy grid -------------------------------------------------------------------------------
  const G = createGrid(0.125);
  G.blockRect(0, -7.5, 12, 0.22); G.blockRect(0, 7.5, 12, 0.22);
  G.blockRect(-12, 0, 0.22, 7.5); G.blockRect(12, 0, 0.22, 7.5);
  for (const p of paths) {
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i];
      G.blockSeg(a.x, a.z, b.x, b.z, 0.62);
    }
  }
  for (const s of slots) G.blockRect(s.pos.x, s.pos.z, 0.52, 0.52);
  G.blockRect(cpu.pos.x, cpu.pos.z, cpu.size / 2 + 0.1, cpu.size / 2 + 0.1);
  G.blockRect(fan.pos.x, fan.pos.z, fan.size / 2 + 0.05, fan.size / 2 + 0.05);
  for (const pt of ports) G.blockRect(pt.pos.x + 0.2, pt.pos.z, 0.6, 1.15);
  for (const cp of comps) {
    const [hw, hd] = footprint(cp);
    G.blockRect(cp.x, cp.z, hw, hd);
  }

  // ---- 3. routed decorative traces ------------------------------------------------------------------
  const traces = [];
  // A cell is free for walker `id` when empty and none of its 4-neighbours belongs to another trace or to an
  // older part of the same trace (no self-crossing loops); only the last two own cells may touch it.
  const age = new Int32Array(G.w * G.h);
  let curStep = 0;
  function free(i, j, id) {
    if (G.get(i, j) !== 0) return false;
    for (let k = 0; k < 8; k += 2) {
      const ni = i + DIRS[k][0], nj = j + DIRS[k][1];
      const n = G.get(ni, nj);
      if (n === 0) continue;
      if (n === id && age[nj * G.w + ni] >= curStep - 2) continue;
      return false;
    }
    return true;
  }
  function mark(i, j, id) {
    G.set(i, j, id);
    if (i >= 0 && j >= 0 && i < G.w && j < G.h) age[j * G.w + i] = curStep;
  }
  let nextId = 1;
  function walk(i, j, dir, maxLen, opts = {}) {
    const id = nextId++;
    curStep = 0;
    if (!free(i, j, id)) return null;
    const pts = [[i, j]];
    mark(i, j, id);
    let d = dir, steps = 0, straight = 0, turned = false;
    while (steps < maxLen) {
      const diag = d % 2 === 1;
      if (straight > 2 && rng.chance(diag ? 0.35 : opts.turn ?? 0.05)) {
        d = (d + (rng.chance(0.5) ? 1 : 7)) % 8;
        if (diag) d = d % 2 === 0 ? d : (d + 1) % 8;
        straight = 0;
        turned = true;
      }
      let moved = false;
      for (const dd of [0, 1, 7, 2, 6]) {
        const nd = (d + dd) % 8;
        const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
        if (!free(ni, nj, id)) continue;
        if (nd % 2 === 1 && (!free(i + DIRS[nd][0], j, id) || !free(i, j + DIRS[nd][1], id))) continue;
        if (nd !== d || turned) { pts.push([i, j]); straight = 0; }
        turned = false;
        d = nd; i = ni; j = nj; moved = true;
        break;
      }
      if (!moved) break;
      curStep = steps + 1;
      mark(i, j, id);
      steps++; straight++;
    }
    pts.push([i, j]);
    if (steps < (opts.min ?? 4)) return null;
    const tr = { pts: pts.map(([a, b]) => [G.cx(a), G.rz(b)]), w: opts.w ?? 0.045, via: opts.via ?? rng.chance(0.75), start: opts.start };
    traces.push(tr);
    return tr;
  }

  // fan-out from chips: parallel traces leaving every edge
  const chipish = comps.filter((c) => ['qfp', 'chipset', 'bios', 'dip', 'ram', 'isa', 'vrm', 'crystal'].includes(c.type));
  chipish.push({ type: 'cpuFan', x: cpu.pos.x, z: cpu.pos.z, hw: cpu.size / 2 + 0.1 });
  for (const cp of chipish) {
    let hw, hd;
    if (cp.type === 'cpuFan') { hw = hd = cp.hw; } else { [hw, hd] = footprint(cp); }
    const pitch = 0.25;
    const sides = [
      [0, 1, hw, hd], [4, -1, hw, hd], // east / west edges walk along z
      [2, 1, hd, hw], [6, -1, hd, hw], // south / north edges walk along x
    ];
    for (const [dir, sgn, h1, h2] of sides) {
      const alongZ = dir === 0 || dir === 4;
      const n = Math.floor((h2 * 2 - 0.2) / pitch);
      for (let k = 0; k < n; k++) {
        if (!rng.chance(0.7)) continue;
        const t = -h2 + 0.1 + pitch * (k + 0.5);
        const x = alongZ ? cp.x + sgn * (h1 + 0.13) : cp.x + t;
        const z = alongZ ? cp.z + t : cp.z + sgn * (h1 + 0.13);
        walk(G.ci(x), G.ri(z), dir, rng.int(6, 40), { turn: 0.04, start: 'pad' });
      }
    }
  }
  // free walkers filling the rest of the board
  for (let n = 0; n < 900; n++) {
    const i = rng.int(2, G.w - 3), j = rng.int(2, G.h - 3);
    walk(i, j, rng.int(0, 3) * 2, rng.int(8, 70), { turn: 0.06, min: 8, w: rng.chance(0.15) ? 0.08 : 0.045 });
  }

  for (const tr of traces) P.line('gap', tr.pts, tr.w + 0.07);
  for (const tr of traces) P.line(tr.w > 0.06 ? 'traceHi' : 'trace', tr.pts, tr.w);
  for (const tr of traces) {
    const e = tr.pts[tr.pts.length - 1];
    if (tr.via) { P.circle('pad', e[0], e[1], 0.062); P.circle('hole', e[0], e[1], 0.028); }
    if (tr.start === 'pad') {
      const s = tr.pts[0];
      P.rect('pad', s[0], s[1], 0.09, 0.09);
    }
  }

  // ---- 4. virus path clearance, edge glow line and via fence ------------------------------------------
  const pathPts = paths.map((p) => p.points.map((v) => [v.x, v.z]));
  for (const pts of pathPts) P.line('haloEdge', pts, 1.16, 'butt');
  for (const pts of pathPts) P.line('halo', pts, 1.02, 'butt');
  for (const p of paths) {
    const L = p.length;
    for (let d = 0.6; d < L - 0.4; d += 0.62) {
      const { x, z, dx, dz } = sampleXZ(p, d);
      for (const sgn of [-1, 1]) {
        const vx = x - dz * 0.6 * sgn, vz = z + dx * 0.6 * sgn;
        if (G.get(G.ci(vx), G.ri(vz)) === -1 && nearSlot(slots, vx, vz)) continue;
        P.circle('gold', vx, vz, 0.058);
        P.circle('hole', vx, vz, 0.025);
      }
    }
  }

  // ---- 5. component footprints ----------------------------------------------------------------------
  for (const cp of comps) drawFootprint(P, cp, rng);
  // CPU socket outline with pin-1 chamfer
  {
    const h = cpu.size / 2 + 0.14, x = cpu.pos.x, z = cpu.pos.z, c = 0.4;
    P.line('silk', [[x - h + c, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h], [x - h, z - h + c], [x - h + c, z - h]], 0.035);
    P.circle('silk', x - h - 0.12, z - h - 0.12, 0.06);
  }
  // fan footprint: square + mounting holes
  {
    const h = fan.size / 2 + 0.08, x = fan.pos.x, z = fan.pos.z;
    P.strokeRect('silk', x, z, h * 2, h * 2, 0.03);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.circle('gold', x + sx * (h - 0.18), z + sz * (h - 0.18), 0.1);
      P.circle('hole', x + sx * (h - 0.18), z + sz * (h - 0.18), 0.05);
    }
  }

  // ---- 6. scattered SMD resistors / capacitors in free space -------------------------------------------
  let placed = 0;
  for (let n = 0; n < 2600 && placed < 170; n++) {
    const x = rng.range(-11.6, 11.6), z = rng.range(-7.1, 7.1);
    const horiz = rng.chance(0.5);
    const hw = horiz ? 0.13 : 0.07, hd = horiz ? 0.07 : 0.13;
    if (!G.rectFree(x, z, hw + 0.05, hd + 0.05)) continue;
    G.blockRect(x, z, hw + 0.03, hd + 0.03);
    const tan = rng.chance(0.4);
    const ox = horiz ? 0.085 : 0, oz = horiz ? 0 : 0.085;
    P.rect('pad', x - ox, z - oz, 0.065, 0.065);
    P.rect('pad', x + ox, z + oz, 0.065, 0.065);
    P.rect(tan ? 'smdTan' : 'smd', x, z, horiz ? 0.11 : 0.09, horiz ? 0.09 : 0.11);
    if (rng.chance(0.25)) P.text('silkDim', `${tan ? 'C' : 'R'}${rng.int(1, 99)}`, x + (horiz ? 0 : 0.2), z + (horiz ? -0.16 : 0), 0.07, { weight: 'normal' });
    placed++;
  }
  // resistor networks (SIP) and test points
  for (let n = 0; n < 400 && placed < 200; n++) {
    const x = rng.range(-11, 11), z = rng.range(-7, 7);
    if (!G.rectFree(x, z, 0.42, 0.12)) continue;
    G.blockRect(x, z, 0.4, 0.1);
    for (let k = 0; k < 8; k++) P.circle('pad', x - 0.35 + k * 0.1, z, 0.032);
    P.rect('smd', x, z - 0.0, 0.8, 0.06, 0.0);
    P.strokeRect('silk', x, z, 0.86, 0.15, 0.015);
    P.text('silkDim', `RN${rng.int(1, 9)}`, x - 0.56, z, 0.07, { weight: 'normal' });
    placed++;
  }
  for (let n = 0; n < 400; n++) {
    const x = rng.range(-11, 11), z = rng.range(-7, 7);
    if (!G.rectFree(x, z, 0.12, 0.12)) continue;
    G.blockRect(x, z, 0.1, 0.1);
    P.ring('silk', x, z, 0.08, 0.015);
    P.circle('pad', x, z, 0.05);
    if (n % 3 === 0) P.text('silkDim', `TP${n % 40}`, x, z + 0.17, 0.06, { weight: 'normal' });
    if (++placed > 230) break;
  }

  // ---- 7. drive-bay slot footprints + drive letters ------------------------------------------------------
  for (const s of slots) {
    const x = s.pos.x, z = s.pos.z, h = 0.5;
    P.line('silk', [[x - h, z - h + 0.14], [x - h, z - h], [x - h + 0.14, z - h]], 0.03, 'butt');
    P.line('silk', [[x + h - 0.14, z - h], [x + h, z - h], [x + h, z - h + 0.14]], 0.03, 'butt');
    P.line('silk', [[x + h, z + h - 0.14], [x + h, z + h], [x + h - 0.14, z + h]], 0.03, 'butt');
    P.line('silk', [[x - h + 0.14, z + h], [x - h, z + h], [x - h, z + h - 0.14]], 0.03, 'butt');
    const letter = `${String.fromCharCode(65 + s.id)}:`;
    // pick the label position with the most free board around it
    const cands = [[0, 0.68], [0, -0.68], [0.7, 0], [-0.7, 0], [0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]];
    let best = null;
    for (const [ox, oz] of cands) {
      const lx = x + ox, lz = z + oz;
      if (lx < -11.7 || lx > 11.7 || lz < -7.3 || lz > 7.3) continue;
      if (G.rectFree(lx, lz, 0.16, 0.1)) { best = [lx, lz]; break; }
      if (!best && !insidePath(paths, lx, lz, 0.55)) best = [lx, lz];
    }
    if (best) {
      G.blockRect(best[0], best[1], 0.17, 0.11);
      P.text('silk', letter, best[0], best[1], 0.16, { font: 'mono' });
    }
  }

  // ---- 8. silkscreen texts + stickers ---------------------------------------------------------------
  for (const s of layout.silk) {
    P.text('silk', s.text, s.x, s.z, s.size, { rot: s.rot || 0, align: s.align || 'center', font: s.font || (s.size < 0.13 ? 'sans' : 'sans') });
  }
  // QC sticker + barcode
  {
    const x = 1.75, z = 7.05;
    P.rect('sticker', x, z, 1.25, 0.42);
    for (let k = 0; k < 34; k++) {
      const w = rng.chance(0.4) ? 0.024 : 0.012;
      P.rect('black', x - 0.55 + k * 0.03, z - 0.04, w, 0.22);
    }
    P.text('black', 'S/N 0042-FD-1996', x, z + 0.15, 0.065, { font: 'mono', weight: 'normal' });
    P.circle('stickerGreen', -0.75, 7.05, 0.2);
    P.text('black', 'QC', -0.75, 7.05, 0.12);
    P.text('silk', 'PASSED', -0.75, 6.73, 0.07);
  }

  // ---- 9. mounting holes ---------------------------------------------------------------------------
  for (const [x, z] of layout.screws) {
    P.circle('gold', x, z, 0.3);
    P.circle('hole', x, z, 0.15);
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * Math.PI * 2;
      P.circle('hole', x + Math.cos(an) * 0.23, z + Math.sin(an) * 0.23, 0.025);
    }
  }

  // ---- 10. fine grain ---------------------------------------------------------------------------------
  const noise = document.createElement('canvas');
  noise.width = noise.height = 128;
  const nctx = noise.getContext('2d');
  const img = nctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rng.next() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);
  for (const [c, alpha] of [[P.a, 0.05], [P.b, 0.07]]) {
    c.save();
    c.globalAlpha = alpha;
    c.globalCompositeOperation = 'overlay';
    c.fillStyle = c.createPattern(noise, 'repeat');
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  // ---- 11. signal map: R = travelling phase along each decorative trace, G = active mask ----------------
  const sigScale = 0.5;
  const cS = document.createElement('canvas');
  cS.width = Math.round(W * sigScale);
  cS.height = Math.round(H * sigScale);
  const sg = cS.getContext('2d');
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, cS.width, cS.height);
  sg.lineCap = 'butt';
  const SX = (x) => (x + 12) * S * sigScale, SZ = (z) => (z + 7.5) * S * sigScale;
  const PERIOD = 3.2;
  for (const tr of traces) {
    if (!rng.chance(0.55)) continue;
    const off = rng.range(0, PERIOD);
    sg.lineWidth = Math.max(1.2, (tr.w + 0.02) * S * sigScale);
    let d = 0;
    for (let i = 1; i < tr.pts.length; i++) {
      const [x0, z0] = tr.pts[i - 1], [x1, z1] = tr.pts[i];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-4) continue;
      // split the run wherever the phase wraps so each piece is a clean linear gradient
      let a0 = 0;
      while (a0 < len - 1e-4) {
        const ph0 = ((off + d + a0) / PERIOD) % 1;
        const a1 = Math.min(len, a0 + (1 - ph0) * PERIOD - 1e-4);
        const ph1 = ph0 + (a1 - a0) / PERIOD;
        const px0 = SX(x0 + ((x1 - x0) * a0) / len), pz0 = SZ(z0 + ((z1 - z0) * a0) / len);
        const px1 = SX(x0 + ((x1 - x0) * a1) / len), pz1 = SZ(z0 + ((z1 - z0) * a1) / len);
        const gr = sg.createLinearGradient(px0, pz0, px1, pz1);
        gr.addColorStop(0, `rgb(${Math.round(ph0 * 255)},255,0)`);
        gr.addColorStop(1, `rgb(${Math.round(Math.min(1, ph1) * 255)},255,0)`);
        sg.strokeStyle = gr;
        sg.beginPath(); sg.moveTo(px0, pz0); sg.lineTo(px1, pz1); sg.stroke();
        a0 = a1 + 2e-4;
      }
      d += len;
    }
  }
  const signal = new THREE.CanvasTexture(cS);
  signal.colorSpace = THREE.NoColorSpace;
  signal.generateMipmaps = false;
  signal.minFilter = THREE.LinearFilter;

  const map = new THREE.CanvasTexture(cA);
  map.colorSpace = THREE.SRGBColorSpace;
  const surf = new THREE.CanvasTexture(cB);
  surf.colorSpace = THREE.NoColorSpace;
  for (const t of [map, surf]) {
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
  }
  return { map, surf, signal, canvas: cA, surfCanvas: cB, signalPeriod: PERIOD };
}

function sampleXZ(p, d) {
  const pts = p.points, cum = p.cum;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
  const dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz };
}

function nearSlot(slots, x, z) {
  for (const s of slots) if (Math.abs(s.pos.x - x) < 0.47 && Math.abs(s.pos.z - z) < 0.47) return true;
  return false;
}

function insidePath(paths, x, z, r) {
  for (const p of paths) {
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < r) return true;
    }
  }
  return false;
}

function drawFootprint(P, cp, rng) {
  const [hw, hd] = footprint(cp);
  const x = cp.x, z = cp.z;
  switch (cp.type) {
    case 'cap': {
      const r = cp.rad + 0.05;
      P.ring('silk', x, z, r, 0.025);
      // polarity: hatched half on the minus side
      for (let k = -3; k <= 3; k++) {
        const t = (k / 3.5) * r;
        const hh = Math.sqrt(Math.max(0, r * r - t * t));
        P.line('silk', [[x + t, z + 0.02], [x + t, z + hh * 0.92]], 0.012, 'butt');
      }
      P.text('silk', '+', x - r - 0.08, z - r * 0.6, 0.1);
      break;
    }
    case 'dip':
    case 'bios': {
      const len = cp.type === 'bios' ? 1.6 : cp.len;
      const pins = cp.type === 'bios' ? 16 : cp.pins;
      const vertical = !!cp.rot;
      P.strokeRect('silk', x, z, hw * 2, hd * 2, 0.025);
      if (vertical) P.arc('silk', x, z - hd, 0.08, 0, Math.PI, 0.025);
      else P.arc('silk', x - hw, z, 0.08, -Math.PI / 2, Math.PI / 2, 0.025);
      for (let k = 0; k < pins; k++) {
        const t = -len / 2 + (len / pins) * (k + 0.5);
        if (vertical) { P.rect('pad', x - 0.3, z + t, 0.08, 0.06); P.rect('pad', x + 0.3, z + t, 0.08, 0.06); }
        else { P.rect('pad', x + t, z - (cp.type === 'bios' ? 0.36 : 0.3), 0.06, 0.08); P.rect('pad', x + t, z + (cp.type === 'bios' ? 0.36 : 0.3), 0.06, 0.08); }
      }
      break;
    }
    case 'qfp':
    case 'chipset': {
      P.strokeRect('silk', x, z, hw * 2 + 0.1, hd * 2 + 0.1, 0.025);
      P.circle('silk', x - hw - 0.12, z - hd - 0.12, 0.05);
      const n = 12, half = cp.size / 2;
      for (let k = 0; k < n; k++) {
        const t = -half + 0.12 + ((half * 2 - 0.24) / (n - 1)) * k;
        P.rect('pad', x + t, z - half - 0.09, 0.05, 0.12);
        P.rect('pad', x + t, z + half + 0.09, 0.05, 0.12);
        P.rect('pad', x - half - 0.09, z + t, 0.12, 0.05);
        P.rect('pad', x + half + 0.09, z + t, 0.12, 0.05);
      }
      break;
    }
    case 'ram': {
      for (let k = 0; k < (cp.sticks || 4); k++) {
        const zz = z - 0.46 + k * 0.42;
        P.strokeRect('silk', x, zz, cp.len + 0.3, 0.26, 0.02);
        for (let p = 0; p < 36; p++) P.rect('gold', x - cp.len / 2 + 0.2 + p * (cp.len - 0.4) / 35, zz, 0.05, 0.09);
      }
      break;
    }
    case 'isa':
      P.strokeRect('silk', x, z, hw * 2 + 0.1, hd * 2 + 0.06, 0.02);
      break;
    case 'battery':
      P.ring('silk', x, z, 0.5, 0.025);
      P.text('silk', '+', x + 0.62, z, 0.16);
      break;
    case 'jumper': {
      P.strokeRect('silk', x, z, hw * 2, hd * 2, 0.02);
      break;
    }
    case 'vrm':
      P.strokeRect('silk', x, z, hw * 2, hd * 2, 0.025);
      break;
    case 'crystal':
      P.strokeRect('silk', x, z, hw * 2, hd * 2, 0.02);
      break;
    default:
      P.strokeRect('silk', x, z, hw * 2, hd * 2, 0.02);
  }
  void rng;
}
