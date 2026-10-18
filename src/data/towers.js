// Floppy turret definitions (owned by the towers module). Balance baseline: docs/CONTRACTS.md §9.
// Each level entry is merged over the base by towers.getDef(type, level).
//   cost     KB to buy (level 1) or to upgrade INTO that level (levels 2-3)
//   rate     shots / bursts / pulses per second (before the heat penalty)
//   range    targeting radius; FIREWALL, DEFRAG and FORMAT also use it as their area radius
//   unlockWave (optional, base) the floppy can be built only once that wave is reached (game.wave >= unlockWave - 1,
//            i.e. from the prep phase before it); towers.canPlace() answers { ok: false, reason: 'locked' } before
// Upgrades: v2 ≈ 0.65x base cost (a cheap, tempting first step), v3 ≈ 1.5x base cost; each level ≈ +45 % dps, +12 % range.
import { PALETTE } from '../config.js';

export const TOWER_TYPES = ['antivirus', 'firewall', 'defrag', 'scandisk', 'format'];
export const MAX_LEVEL = 3;
export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

export const TOWERS = {
  antivirus: {
    id: 'antivirus',
    key: 'tower.antivirus',          // i18n: key (name), key + '.desc' (one-line description)
    name: 'ANTIVIRUS.EXE',
    short: 'ANTIVIRUS',
    hotkey: '1',
    color: PALETTE.antivirus,
    attack: 'bolt',                  // homing "scan bolt" projectile
    aims: true,                      // must face the target before firing
    boltColor: 0x5ff3ff,              // cyan scan beam (distinct from the blue floppy body and the frost tint)
    art: { title: 'ANTIVIRUS', ink: '#14205e', note: 'DISK 1 OF 5', doodle: 'shield' },
    levels: [
      { version: 'v1.0', cost: 64, damage: 10, rate: 1.5, range: 3.0, speed: 14, pierce: 0 },
      { version: 'v2.0', cost: 42, damage: 13, rate: 1.7, range: 3.3, speed: 15, pierce: 0 },
      // v3: the bolt keeps flying through 2 more viruses after the first hit
      { version: 'v3.0', cost: 96, damage: 17, rate: 1.9, range: 3.6, speed: 16, pierce: 2, special: 'pierce', boltColor: 0x8fe6ff },
    ],
  },
  firewall: {
    id: 'firewall',
    key: 'tower.firewall',
    name: 'FIREWALL.EXE',
    short: 'FIREWALL',
    hotkey: '2',
    color: PALETTE.firewall,
    attack: 'burst',                 // ring of fire: damages every virus within `range` of the floppy
    aims: false,
    art: { title: 'FIREWALL', ink: '#3a0b0b', note: 'DO NOT COPY!', doodle: 'flame' },
    levels: [
      { version: 'v1.0', cost: 128, damage: 20, rate: 0.85, range: 2.2, burnDps: 0, burnTime: 0 },
      { version: 'v2.0', cost: 84, damage: 28, rate: 0.95, range: 2.45, burnDps: 0, burnTime: 0 },
      // v3: burning viruses take 8 dmg/s for 2 s
      { version: 'v3.0', cost: 192, damage: 36, rate: 1.05, range: 2.7, burnDps: 8, burnTime: 2, special: 'burn' },
    ],
  },
  defrag: {
    id: 'defrag',
    key: 'tower.defrag',
    name: 'DEFRAG.EXE',
    short: 'DEFRAG',
    hotkey: '3',
    color: PALETTE.defrag,
    attack: 'pulse',                 // slows every virus within `range` on each pulse
    aims: false,
    art: { title: 'DEFRAG', ink: '#3b2a00', note: 'C:\\ 97% FRAG', doodle: 'blocks' },
    levels: [
      { version: 'v1.0', cost: 96, damage: 0, rate: 1 / 0.6, range: 2.6, slow: 0.5, slowTime: 1.0 },
      { version: 'v2.0', cost: 62, damage: 0, rate: 1 / 0.55, range: 3.0, slow: 0.38, slowTime: 1.15 },
      // v3: pulses also deal 8 damage
      { version: 'v3.0', cost: 144, damage: 8, rate: 1 / 0.5, range: 3.2, slow: 0.35, slowTime: 1.3, special: 'damage' },
    ],
  },
  // Late-game floppies (unlocked from wave 11): reuse the bolt / burst code paths with heavier numbers.
  scandisk: {
    id: 'scandisk',
    key: 'tower.scandisk',
    name: 'SCANDISK.EXE',
    short: 'SCANDISK',
    hotkey: '4',
    color: 0x2fd36a,
    attack: 'bolt',                  // long-range heavy "surface scan" sniper bolt
    aims: true,
    boltColor: 0x7dff9a,
    unlockWave: 11,
    art: { title: 'SCANDISK', ink: '#0b3a1c', note: 'DISK 4 OF 5', doodle: 'target' },
    levels: [
      { version: 'v1.0', cost: 112, damage: 34, rate: 0.55, range: 4.4, speed: 18, pierce: 0 },
      { version: 'v2.0', cost: 74, damage: 48, rate: 0.6, range: 4.7, speed: 19, pierce: 0 },
      // v3: the bolt keeps flying through 1 more virus after the first hit
      { version: 'v3.0', cost: 168, damage: 66, rate: 0.65, range: 5.0, speed: 20, pierce: 1, special: 'pierce', boltColor: 0xc4ffd2 },
    ],
  },
  format: {
    id: 'format',
    key: 'tower.format',
    name: 'FORMAT.COM',
    short: 'FORMAT C:',
    hotkey: '5',
    color: 0xa35cff,
    attack: 'burst',                 // slow devastating blast: damages every virus within `range` of the floppy
    aims: false,
    burstColor: 0xd9b8ff,            // purple wipe (towers.js / projectiles.js recolour the FIREWALL burst with it)
    unlockWave: 11,
    art: { title: 'FORMAT C:', ink: '#2a0b4a', note: 'DISK 5 OF 5', doodle: 'bomb' },
    levels: [
      { version: 'v1.0', cost: 200, damage: 70, rate: 0.3, range: 2.0, burnDps: 0, burnTime: 0 },
      { version: 'v2.0', cost: 130, damage: 95, rate: 0.33, range: 2.2, burnDps: 0, burnTime: 0 },
      { version: 'v3.0', cost: 300, damage: 130, rate: 0.36, range: 2.4, burnDps: 0, burnTime: 0 },
    ],
  },
};
