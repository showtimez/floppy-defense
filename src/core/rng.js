// Seeded RNG (mulberry32). Use for gameplay randomness so runs are reproducible with ?seed=N.
export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    get seed() { return seed; },
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const rng = createRng(params.has('seed') ? Number(params.get('seed')) : undefined);
