// DOS-style glyph atlas generated at runtime: each character is rasterised small with a system monospace
// font, thresholded to hard pixels, given a 1-pixel black outline, then blown up 3x into the atlas so the
// floating labels read as chunky VGA text. No font files.
import * as THREE from 'three';

const EXTRA = '°█▲▼♥×►';

export function createGlyphAtlas() {
  const chars = [];
  for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
  for (const ch of EXTRA) chars.push(ch);
  const cols = 16;
  const rows = Math.ceil(chars.length / cols);
  const cw = 10, chh = 16; // low-res cell (VGA-ish 9x16 + outline room)
  const S = 3; // upscale
  const W = cols * cw, H = rows * chh;

  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const g = small.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '13px "Lucida Console", Consolas, "Courier New", monospace';
  // faux-bold (double strike, like VGA's 2-pixel vertical strokes)
  chars.forEach((ch, i) => {
    const x = (i % cols) * cw + cw / 2 - 0.5;
    const y = Math.floor(i / cols) * chh + chh / 2 + 1;
    g.fillText(ch, x, y);
    g.fillText(ch, x + 1, y);
  });
  const src = g.getImageData(0, 0, W, H).data;
  const fill = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) fill[i] = src[i * 4 + 3] > 110 ? 1 : 0;

  const big = document.createElement('canvas');
  big.width = W * S;
  big.height = H * S;
  const bg = big.getContext('2d');
  const img = bg.createImageData(W * S, H * S);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0; // 0 empty, 1 outline, 2 fill
      if (fill[y * W + x]) v = 2;
      else {
        const cx = Math.floor(x / cw), cy = Math.floor(y / chh);
        for (let oy = -1; oy <= 1 && !v; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (Math.floor(nx / cw) !== cx || Math.floor(ny / chh) !== cy) continue;
            if (fill[ny * W + nx]) { v = 1; break; }
          }
        }
      }
      if (!v) continue;
      const c = v === 2 ? 255 : 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const o = ((y * S + sy) * W * S + (x * S + sx)) * 4;
          d[o] = c; d[o + 1] = c; d[o + 2] = c; d[o + 3] = 255;
        }
      }
    }
  }
  bg.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(big);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;

  const lut = new Int16Array(256).fill(chars.indexOf('?'));
  const extra = new Map();
  chars.forEach((ch, i) => {
    const code = ch.charCodeAt(0);
    if (code < 256) lut[code] = i;
    else extra.set(code, i);
  });
  // lower-case renders fine, but upper-case reads more "DOS"
  return {
    texture,
    cols,
    rows,
    aspect: cw / chh,
    index(code) {
      if (code < 256) return lut[code];
      return extra.get(code) ?? lut[63];
    },
  };
}
