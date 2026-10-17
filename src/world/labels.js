// Label atlas: every printed surface on the board (CPU top, chip markings, stickers, connector faces)
// drawn once into a single CanvasTexture so all labelled parts share one material / draw call.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';

const A = 1024;

// Atlas regions in pixels [x, y, w, h].
const REGIONS = {
  cpuTop: [0, 0, 512, 512],
  socketTop: [512, 0, 512, 512],
  vgaTop: [0, 512, 256, 256],
  bios: [256, 512, 256, 128],
  battery: [256, 640, 128, 128],
  fanHub: [384, 640, 128, 128],
  dip0: [512, 512, 256, 64],
  dip1: [512, 576, 256, 64],
  db9: [768, 512, 256, 128],
  din: [768, 640, 128, 128],
  simmChip: [896, 640, 128, 64],
  mosfet: [896, 704, 128, 64],
  crystal: [512, 640, 256, 64],
  isaTop: [512, 704, 256, 64],
  pciTop: [0, 768, 256, 64],
  fanFrame: [256, 768, 256, 256],
  powerTop: [512, 768, 256, 128],
  warn: [768, 768, 256, 128],
  badge: [768, 896, 256, 64],
  plain: [1000, 1000, 16, 16],
};

const MONO = '"Courier New", Courier, monospace';
const SANS = 'Arial, Helvetica, sans-serif';

function uvRegion([x, y, w, h], inset = 0.5) {
  return { u0: (x + inset) / A, u1: (x + w - inset) / A, v0: 1 - (y + h - inset) / A, v1: 1 - (y + inset) / A };
}

export function createLabelAtlas() {
  const rng = createRng(486);
  const cv = document.createElement('canvas');
  cv.width = cv.height = A;
  const g = cv.getContext('2d');
  g.fillStyle = '#202024';
  g.fillRect(0, 0, A, A);

  const at = (name, fn) => {
    const [x, y, w, h] = REGIONS[name];
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.translate(x, y);
    fn(w, h);
    g.restore();
  };
  const text = (s, x, y, size, color = '#111', { font = SANS, weight = 'bold', align = 'center', base = 'middle' } = {}) => {
    g.fillStyle = color;
    g.font = `${weight} ${size}px ${font}`;
    g.textAlign = align;
    g.textBaseline = base;
    g.fillText(s, x, y);
  };
  const speckle = (w, h, n, a, col = '#000') => {
    g.globalAlpha = a;
    g.fillStyle = col;
    for (let i = 0; i < n; i++) g.fillRect(rng.range(0, w), rng.range(0, h), 1.2, 1.2);
    g.globalAlpha = 1;
  };

  // ---- CPU top: ceramic package, gold die lid frame, parody markings -------------------------------
  at('cpuTop', (w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#d9d4c7');
    grad.addColorStop(1, '#bdb7a8');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    speckle(w, h, 3000, 0.12);
    // pin-1 corner chamfer mark
    g.fillStyle = '#9a9384';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(60, 0); g.lineTo(0, 60); g.closePath(); g.fill();
    g.fillStyle = '#6e695e';
    g.beginPath(); g.arc(70, 70, 9, 0, Math.PI * 2); g.fill();
    // gold lid frame around the die window (window itself covered by the die shader quad)
    const d = 232;
    g.fillStyle = '#b8913e';
    g.fillRect(w / 2 - d / 2 - 14, h / 2 - d / 2 - 14, d + 28, d + 28);
    g.fillStyle = '#e8c56a';
    g.fillRect(w / 2 - d / 2 - 8, h / 2 - d / 2 - 8, d + 16, d + 16);
    g.fillStyle = '#1a1a1a';
    g.fillRect(w / 2 - d / 2, h / 2 - d / 2, d, d);
    // markings
    text('FLOPPY', w / 2, 52, 50, '#141414', { font: SANS, weight: '900' });
    text('486', w / 2 + 140, 52, 38, '#7a1010', { font: SANS, weight: '900' });
    text('DX4-100', w / 2, h - 58, 44, '#141414', { font: SANS, weight: '900' });
    text('©1995 FLOPPY CORP.  MALAYSIA', w / 2, h - 22, 17, '#2a2a2a', { font: MONO });
    g.save();
    g.translate(30, h / 2); g.rotate(-Math.PI / 2);
    text('A80486DX4-100  SK096', 0, 0, 18, '#2a2a2a', { font: MONO });
    g.restore();
    g.save();
    g.translate(w - 30, h / 2); g.rotate(Math.PI / 2);
    text('i-BUG™  INSIDE  L5280131', 0, 0, 18, '#2a2a2a', { font: MONO });
    g.restore();
    text('3.3V  25x4', 110, 100, 16, '#3a3a3a', { font: MONO, weight: 'normal' });
  });

  // ---- ZIF socket top: pin-hole grid -----------------------------------------------------------------
  at('socketTop', (w, h) => {
    g.fillStyle = '#e9e2cc';
    g.fillRect(0, 0, w, h);
    speckle(w, h, 1500, 0.08);
    const n = 19, pitch = w / (n + 1);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const ring = Math.min(i, j, n - 1 - i, n - 1 - j);
      if (ring > 3) continue;
      const x = pitch * (i + 1), y = pitch * (j + 1);
      g.fillStyle = '#6e6656';
      g.beginPath(); g.arc(x, y, pitch * 0.32, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d9a640';
      g.beginPath(); g.arc(x, y, pitch * 0.17, 0, Math.PI * 2); g.fill();
    }
    text('ZIF', 34, 20, 16, '#8a826e', { font: SANS });
  });

  // ---- VGA chip top ------------------------------------------------------------------------------------
  at('vgaTop', (w, h) => {
    g.fillStyle = '#1b1b1e';
    g.fillRect(0, 0, w, h);
    speckle(w, h, 800, 0.15, '#444');
    g.fillStyle = '#333';
    g.beginPath(); g.arc(28, 28, 9, 0, Math.PI * 2); g.fill();
    // fake logo: three stripes
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ['#c0392b', '#2e86de', '#27ae60'][i];
      g.fillRect(w / 2 - 48 + i * 34, 52, 26, 26);
    }
    text('S-VGA 9440', w / 2, 118, 30, '#d6d6d6', { font: SANS, weight: '900' });
    text('1MB VRAM  PCI', w / 2, 152, 20, '#b0b0b0', { font: MONO });
    text('TAIWAN 9612', w / 2, 186, 18, '#9a9a9a', { font: MONO, weight: 'normal' });
    text('FLOPPY GFX', w / 2, 216, 18, '#9a9a9a', { font: MONO, weight: 'normal' });
  });

  // ---- BIOS holographic sticker (text layer; rainbow is animated in the holo shader) --------------------
  at('bios', (w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
    text('BIOS', w / 2, 40, 44, '#111', { font: SANS, weight: '900' });
    text('AMY® PNP v4.51', w / 2, 80, 20, '#222', { font: MONO });
    text('©1996 FLOPPY', w / 2, 106, 16, '#333', { font: MONO, weight: 'normal' });
  });

  // ---- CMOS coin battery top -----------------------------------------------------------------------------
  at('battery', (w, h) => {
    const grad = g.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    grad.addColorStop(0, '#f4f6f8');
    grad.addColorStop(1, '#9aa1a8');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7d848b'; g.lineWidth = 3;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2); g.stroke();
    text('+', w / 2, 30, 30, '#4c5258');
    text('CR2032', w / 2, 66, 22, '#4c5258', { font: SANS });
    text('3V', w / 2, 94, 18, '#4c5258', { font: SANS });
  });

  // ---- fan hub sticker ---------------------------------------------------------------------------------------
  at('fanHub', (w, h) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c230';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2c230';
    for (let i = 0; i < 3; i++) {
      g.save(); g.translate(w / 2, h / 2); g.rotate((i * Math.PI * 2) / 3);
      g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(26, -30, 40, -6); g.lineTo(6, 4); g.closePath(); g.fill();
      g.restore();
    }
    text('12V', w / 2, h / 2 + 2, 16, '#111', { font: SANS, weight: '900' });
  });

  // ---- DIP chip tops ----------------------------------------------------------------------------------------
  const dip = (name, l1, l2) => at(name, (w, h) => {
    g.fillStyle = '#1b1b1e'; g.fillRect(0, 0, w, h);
    speckle(w, h, 300, 0.2, '#555');
    g.fillStyle = '#2c2c30'; g.beginPath(); g.arc(0, h / 2, 12, -Math.PI / 2, Math.PI / 2); g.fill();
    text(l1, w / 2 + 6, h * 0.38, 24, '#d0d0d0', { font: SANS, weight: '900' });
    text(l2, w / 2 + 6, h * 0.76, 15, '#a0a0a0', { font: MONO, weight: 'normal' });
  });
  dip('dip0', 'SND-16', 'OPL3 9547');
  dip('dip1', 'U12', '74LS245');

  // ---- DB-9 face: trapezoid insert with 5+4 gold sockets ------------------------------------------------------
  at('db9', (w, h) => {
    g.fillStyle = '#121214'; g.fillRect(0, 0, w, h);
    const pin = (x, y) => {
      g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e2b453'; g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill();
    };
    for (let i = 0; i < 5; i++) pin(w / 2 + (i - 2) * 40, h * 0.34);
    for (let i = 0; i < 4; i++) pin(w / 2 + (i - 1.5) * 40, h * 0.7);
  });

  // ---- keyboard DIN face -------------------------------------------------------------------------------------------
  at('din', (w, h) => {
    g.fillStyle = '#141416'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#060606'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 5; i++) {
      const an = Math.PI * (0.15 + i * 0.175) + Math.PI;
      const x = w / 2 + Math.cos(an) * 30, y = h / 2 - Math.sin(an) * 30;
      g.fillStyle = '#e2b453'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2a2a2e'; g.fillRect(w / 2 - 6, h / 2 + 22, 12, 22);
  });

  // ---- SIMM memory chip, MOSFET, crystal, ISA/PCI tops, fan frame, power, warning -----------------------------------------
  at('simmChip', (w, h) => {
    g.fillStyle = '#18181b'; g.fillRect(0, 0, w, h);
    text('KM44C', w / 2, h * 0.38, 20, '#bbb', { font: SANS, weight: '900' });
    text('-60', w / 2, h * 0.75, 16, '#999', { font: MONO });
  });
  at('mosfet', (w, h) => {
    g.fillStyle = '#18181b'; g.fillRect(0, 0, w, h);
    text('IRF', w / 2, h * 0.4, 22, '#bbb', { font: SANS, weight: '900' });
    text('Z44N', w / 2, h * 0.78, 15, '#999', { font: MONO });
  });
  at('crystal', (w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f5f7f9'); grad.addColorStop(0.5, '#b6bcc2'); grad.addColorStop(1, '#e8ecef');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    text('14.318 MHz', w / 2, h / 2, 26, '#3a3f44', { font: MONO });
  });
  at('isaTop', (w, h) => {
    g.fillStyle = '#121214'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000'; g.fillRect(8, h / 2 - 7, w - 16, 14);
    g.fillStyle = '#c99a3c';
    for (let x = 12; x < w - 12; x += 6) { g.fillRect(x, h / 2 - 5, 2, 3); g.fillRect(x, h / 2 + 2, 2, 3); }
    g.fillStyle = '#121214'; g.fillRect(w * 0.62, h / 2 - 8, 6, 16);
  });
  at('pciTop', (w, h) => {
    g.fillStyle = '#f0ece0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a'; g.fillRect(8, h / 2 - 6, w - 16, 12);
    g.fillStyle = '#c99a3c';
    for (let x = 12; x < w - 12; x += 5) { g.fillRect(x, h / 2 - 4, 2, 2); g.fillRect(x, h / 2 + 2, 2, 2); }
    g.fillStyle = '#f0ece0'; g.fillRect(w * 0.3, h / 2 - 7, 6, 14);
  });
  at('fanFrame', (w, h) => {
    g.fillStyle = '#1e1e22'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2c2c32'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
  });
  at('powerTop', (w, h) => {
    g.fillStyle = '#efe9d8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = '#c8c0a8';
      g.fillRect(10 + i * 40, 12, 32, h - 24);
      g.fillStyle = '#7d7563';
      g.fillRect(20 + i * 40, h / 2 - 10, 12, 20);
    }
  });
  at('warn', (w, h) => {
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    for (let i = -4; i < 12; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 - 16, h); g.lineTo(i * 32 - 32, h); g.closePath(); g.fill(); }
    g.fillStyle = '#f2c230'; g.fillRect(20, 30, w - 40, h - 60);
    text('WARNING', w / 2, h / 2 - 12, 30, '#111', { font: SANS, weight: '900' });
    text('HOT SURFACE', w / 2, h / 2 + 18, 20, '#111', { font: SANS, weight: '900' });
  });
  at('plain', (w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
  at('badge', (w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#e9ecef'); grad.addColorStop(0.5, '#9aa1a8'); grad.addColorStop(1, '#d5d9dd');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6c737a'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
    text('FLOPPY', 70, h / 2, 26, '#1b2a6b', { font: SANS, weight: '900' });
    text('486 DX4', 168, h / 2 - 8, 17, '#7a1010', { font: SANS, weight: '900' });
    text('TURBO PC', 168, h / 2 + 12, 13, '#333', { font: MONO });
  });

  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const regions = {};
  for (const k of Object.keys(REGIONS)) regions[k] = uvRegion(REGIONS[k]);
  return { texture, regions, canvas: cv };
}

// Die texture for the CPU core shader: R = circuit pattern brightness, G = crack reveal threshold (0 = none),
// B = edge/frame mask.
export function createDieTexture(size = 256) {
  const rng = createRng(4860);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(0,0,0)';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  // functional blocks (red channel)
  const block = (x, y, w, h, v) => { g.fillStyle = `rgb(${v},0,0)`; g.fillRect(x, y, w, h); };
  const m = size * 0.08;
  block(m, m, size - 2 * m, size - 2 * m, 28);
  // cache arrays: fine grids
  for (const [bx, by, bw, bh] of [[m + 6, m + 6, size * 0.38, size * 0.3], [size * 0.52, m + 6, size * 0.38, size * 0.3]]) {
    for (let y = by; y < by + bh; y += 4) block(bx, y, bw, 2, 60);
    for (let x = bx; x < bx + bw; x += 6) block(x, by, 1, bh, 40);
  }
  // ALU / FPU blocks
  for (let i = 0; i < 9; i++) {
    const x = rng.range(m + 8, size * 0.7), y = rng.range(size * 0.45, size * 0.8);
    block(x, y, rng.range(12, 40), rng.range(10, 30), 45 + rng.int(0, 50));
  }
  // buses
  for (let i = 0; i < 14; i++) {
    const y = rng.range(m + 4, size - m - 4);
    block(m + 4, y, size - 2 * m - 8, 1.5, 70);
  }
  for (let i = 0; i < 10; i++) {
    const x = rng.range(m + 4, size - m - 4);
    block(x, m + 4, 1.5, size - 2 * m - 8, 70);
  }
  // pad ring
  for (let k = 0; k < 40; k++) {
    const t = m + 6 + ((size - 2 * m - 12) * k) / 39;
    block(t, m - 4, 3, 5, 150); block(t, size - m - 1, 3, 5, 150);
    block(m - 4, t, 5, 3, 150); block(size - m - 1, t, 5, 3, 150);
  }
  // core hot spot
  const rg = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size * 0.32);
  rg.addColorStop(0, 'rgba(110,0,0,1)');
  rg.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  // frame mask (blue)
  g.fillStyle = 'rgb(0,0,255)';
  g.fillRect(0, 0, size, m * 0.55); g.fillRect(0, size - m * 0.55, size, m * 0.55);
  g.fillRect(0, 0, m * 0.55, size); g.fillRect(size - m * 0.55, 0, m * 0.55, size);

  // cracks (green channel = reveal threshold 0.15..1, lower thresholds appear first)
  g.globalCompositeOperation = 'source-over';
  const crack = (x, y, ang, len, thr, depth) => {
    g.strokeStyle = `rgb(0,${Math.round(thr * 255)},0)`;
    g.lineWidth = Math.max(2, 4.6 - depth * 1.2);
    g.lineCap = 'round';
    let cx = x, cy = y;
    for (let s = 0; s < len; s++) {
      const nx = cx + Math.cos(ang) * 7, ny = cy + Math.sin(ang) * 7;
      g.globalCompositeOperation = 'lighten';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
      cx = nx; cy = ny;
      ang += rng.range(-0.5, 0.5);
      // branches reveal later: stored value is (1 - threshold), so subtract
      if (depth < 2 && rng.chance(0.12)) crack(cx, cy, ang + rng.range(-1.2, 1.2), len - s - 2, Math.max(0.03, thr - 0.15), depth + 1);
    }
  };
  // Store (1 - threshold) so `lighten` keeps the earliest reveal where cracks overlap (shader uses 1 - G).
  const crackInv = (x, y, ang, len, thr) => crack(x, y, ang, len, 1 - thr, 0);
  crackInv(size * 0.5, size * 0.5, rng.range(0, 6.28), 22, 0.15);
  crackInv(size * 0.5, size * 0.5, rng.range(0, 6.28), 18, 0.3);
  crackInv(size * 0.2, size * 0.25, 0.6, 20, 0.45);
  crackInv(size * 0.8, size * 0.7, 3.6, 20, 0.55);
  crackInv(size * 0.15, size * 0.8, -0.5, 18, 0.65);
  crackInv(size * 0.85, size * 0.2, 2.4, 18, 0.75);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false; // keep crack thresholds exact (mips would average them away)
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
