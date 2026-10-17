// Pixel-art icons and the ANSI-style title, generated at runtime on a canvas (Compo: no image files).
import { PALETTE } from '../config.js';

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

function shade(color, f) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const m = (c) => Math.max(0, Math.min(255, Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f)));
  return hex((m(r) << 16) | (m(g) << 8) | m(b));
}

// 12x12 sprites. B = base colour, b = base dark, H = base light, others fixed.
const SPRITES = {
  floppy: [
    'BBBMMMMMMMH.',
    'BBBMMKKMMMBH',
    'BBBMMKKMMMBB',
    'BBBMMKKMMMBB',
    'BBBmmmmmmmBB',
    'BBBBBBBBBBBB',
    'BBWWWWWWWWBB',
    'BBWLLLLLLWBB',
    'BBWWWWWWWWBB',
    'BBWLLLLWWWBB',
    'BBWWWWWWWWBB',
    'KBWWWWWWWWBb',
  ],
  worm: [
    '............',
    '........HBB.',
    '.......HBBBB',
    '.......BEPBB',
    '...HB..BBBBB',
    '..HBBB..BBB.',
    '.HBBBBBBBBb.',
    'HBBbBBBbBb..',
    'BBbbBbBbb...',
    'Bbb..bb.....',
    '.b..........',
    '............',
  ],
  trojan: [
    '...HB.......',
    '..HBBB......',
    '.HBEBBB.....',
    'HBBBBBBB....',
    'BBb.BBBB....',
    '....BBBBBBH.',
    '....BBBBBBBB',
    '....BbbbbbbB',
    '....B.B..B.B',
    '...MMMMMMMMM',
    '...mKm...mKm',
    '............',
  ],
  macro: [
    '.WWWWWWWdd..',
    '.WWWWWWWWdd.',
    '.WWWWWWWWWW.',
    '.WBWWWWWBWW.',
    '.WBWWWWWBWW.',
    '.WBWWBWWBWW.',
    '.WBWBWBWBWW.',
    '.WBBWWWBBWW.',
    '.WBWWWWWBWW.',
    '.WWWWWWWWWW.',
    '.WLLLLLLLWW.',
    '.WWWWWWWWWW.',
  ],
  heart: [
    '............',
    '.BBB...BBB..',
    'BHHBB.BBBBB.',
    'BHBBBBBBBBB.',
    'BBBBBBBBBBB.',
    'BBBBBBBBBBb.',
    '.BBBBBBBBb..',
    '..BBBBBBb...',
    '...BBBBb....',
    '....BBb.....',
    '.....b......',
    '............',
  ],
  fan: [
    '.MMMMMMMMMM.',
    'MmKKKKKKKKmM',
    'MKKBBKKKKKKM',
    'MKKBBBKKBBKM',
    'MKKKBBKBBBKM',
    'MKKKKMMBBKKM',
    'MKKBBMMKKKKM',
    'MKBBBKBBKKKM',
    'MKBBKKBBBKKM',
    'MKKKKKKBBKKM',
    'MmKKKKKKKKmM',
    '.MMMMMMMMMM.',
  ],
  award: [
    '....BBBB....',
    '..BBHHHHBB..',
    '.BHHBBBBHHB.',
    '.BHBBWWBBHB.',
    'BHBBWWWWBBHB',
    'BHBBWWWWBBHB',
    '.BHBBWWBBHB.',
    '.BHHBBBBHHB.',
    '..BBHHHHBB..',
    '...BBBBBB...',
    '...RR..RR...',
    '..RR....RR..',
  ],
  chip: [
    '.M.M.M.M.M..',
    'KKKKKKKKKKK.',
    'KkkkkkkkkkK.',
    'KkBBBBBBBkK.',
    'KkBHHHHHBkK.',
    'KkBHBBBHBkK.',
    'KkBHBBBHBkK.',
    'KkBHHHHHBkK.',
    'KkBBBBBBBkK.',
    'KKKKKKKKKKK.',
    '.M.M.M.M.M..',
    '............',
  ],
};

const FIXED = {
  M: '#b9c0c6', m: '#6b7178', K: '#101214', k: '#2a2d31', W: '#f1efe4', L: '#8f9aab',
  E: '#ffffff', P: '#000000', d: '#9b9b92', R: '#e8402f',
};

const cache = new Map();

// Returns a data URL for sprite `name` tinted with `color` (three.js hex number).
export function spriteURL(name, color = PALETTE.phosphor, scale = 4) {
  const key = `${name}|${color}|${scale}`;
  let url = cache.get(key);
  if (url) return url;
  const rows = SPRITES[name] || SPRITES.chip;
  const c = document.createElement('canvas');
  c.width = rows[0].length * scale;
  c.height = rows.length * scale;
  const g = c.getContext('2d');
  const map = { ...FIXED, B: hex(color), b: shade(color, 0.6), H: shade(color, 1.45) };
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = map[ch] || hex(color);
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function spriteImg(name, color, cls = 'spr') {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.draggable = false;
  img.src = spriteURL(name, color);
  return img;
}

// Sprite + colour for an enemy type (enemies module may refine colours; these match config.PALETTE).
export function enemyLook(type) {
  switch (type) {
    case 'worm': return { sprite: 'worm', color: PALETTE.worm };
    case 'trojan': return { sprite: 'trojan', color: PALETTE.trojan };
    case 'macro': return { sprite: 'macro', color: 0x1d6bff };
    case 'macro_mini': return { sprite: 'macro', color: PALETTE.macro };
    case 'boss_melissa': return { sprite: 'macro', color: PALETTE.boss };
    case 'boss_iloveyou': return { sprite: 'heart', color: 0xff4fa3 };
    default: return { sprite: 'chip', color: PALETTE.phosphor };
  }
}

// ---------------------------------------------------------------------------------------------
// ANSI block title ("FLOPPY DEFENSE"): 5x7 glyphs, extruded shadow, phosphor gradient.
// ---------------------------------------------------------------------------------------------
const GLYPHS = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

export function drawTitle(canvas, text = 'FLOPPY DEFENSE', px = 8) {
  const chars = text.split('');
  let cols = 0;
  for (const ch of chars) cols += (GLYPHS[ch] || GLYPHS[' '])[0].length + 1;
  cols -= 1;
  const depth = 2;
  const W = (cols + depth) * px;
  const H = (7 + depth) * px;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const cells = [];
  let cx = 0;
  for (const ch of chars) {
    const gl = GLYPHS[ch] || GLYPHS[' '];
    for (let y = 0; y < 7; y++) for (let x = 0; x < gl[y].length; x++) if (gl[y][x] === '#') cells.push(cx + x, y);
    cx += gl[0].length + 1;
  }
  // Extrusion (dithered dark green, like ANSI shade blocks)
  for (let d = depth; d >= 1; d--) {
    for (let i = 0; i < cells.length; i += 2) {
      const x = (cells[i] + d) * px, y = (cells[i + 1] + d) * px;
      g.fillStyle = d === depth ? '#03200c' : '#0a4a1e';
      g.fillRect(x, y, px, px);
    }
  }
  // Face with vertical phosphor gradient + per-block bevel
  const grad = g.createLinearGradient(0, 0, 0, 7 * px);
  grad.addColorStop(0, '#d9ffe3');
  grad.addColorStop(0.35, '#6dff93');
  grad.addColorStop(0.7, '#39ff6a');
  grad.addColorStop(1, '#1d9a42');
  for (let i = 0; i < cells.length; i += 2) {
    const x = cells[i] * px, y = cells[i + 1] * px;
    g.fillStyle = grad;
    g.fillRect(x, y, px, px);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(x, y, px, 1);
    g.fillStyle = 'rgba(0,40,10,0.35)';
    g.fillRect(x, y + px - 1, px, 1);
    g.fillRect(x + px - 1, y, 1, px);
  }
  return canvas;
}
