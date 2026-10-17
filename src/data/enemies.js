// Virus definitions (CONTRACTS §5.4 / §9 baseline balance). Tune numbers here.
//  hp, speed (units/s), reward (KB), cpuDamage (% CPU integrity on leak), radius (hit circle on XZ),
//  y (logical centre height, projectiles aim here), barY (hp-bar height), barW (hp-bar width), barSegs (DOS blocks),
//  model (enemyModels rig id), scale (model scale), slowResist (0 = full slow, 0.5 = slow effect halved),
//  vs: damage multiplier per floppy type ({ antivirus: 0.6 } = scans do 60 %),
//  split: on death spawn `count` × `into` (Macro), splitAt: boss hp thresholds that spawn `count` × `type` (Melissa),
//  bossSpawn: boss periodically summons `count` × `type` every `every` s (ILOVEYOU); allPorts: every other batch enters
//    through the other COM port,
//  leakMin: bosses only - CPU damage on leak = cpuDamage × (leakMin + (1 - leakMin) × hp/maxHp), so chip damage counts.
import { PALETTE } from '../config.js';

export const ENEMIES = {
  worm: {
    name: 'WORM.EXE',
    hp: 26, speed: 2.4, reward: 4, cpuDamage: 4,
    radius: 0.28, y: 0.28, barY: 0.98, barW: 0.55, barSegs: 6,
    color: PALETTE.worm, model: 'worm', scale: 1.5,
    desc: { en: 'Fast, fragile, comes in swarms.', it: 'Veloce, fragile, arriva a sciami.' },
  },
  trojan: {
    name: 'TROJAN.EXE',
    hp: 150, speed: 0.85, reward: 15, cpuDamage: 12,
    radius: 0.44, y: 0.5, barY: 1.96, barW: 0.8, barSegs: 10,
    color: PALETTE.trojan, model: 'trojan', scale: 1.45,
    vs: { antivirus: 0.6, firewall: 1.5 }, // wooden: shrugs off scans, burns well
    desc: { en: 'Wooden horse: shrugs off scans, burns well.', it: 'Cavallo di legno: resiste alle scansioni, brucia bene.' },
  },
  macro: {
    name: 'MACRO.DOC',
    hp: 60, speed: 1.4, reward: 7, cpuDamage: 7,
    radius: 0.35, y: 0.52, barY: 1.34, barW: 0.62, barSegs: 8,
    color: PALETTE.macro, model: 'macro', scale: 1.5,
    split: { into: 'macro_mini', count: 2, spread: 0.3 },
    desc: { en: 'Splits in two when deleted.', it: 'Si divide in due quando lo elimini.' },
  },
  macro_mini: {
    name: 'MACRO.DOC',
    hp: 22, speed: 1.9, reward: 3, cpuDamage: 3,
    radius: 0.24, y: 0.42, barY: 1.06, barW: 0.44, barSegs: 5,
    color: PALETTE.macro, model: 'macro_mini', scale: 1.0,
    desc: { en: 'A copy of a copy.', it: 'La copia di una copia.' },
  },
  boss_melissa: {
    name: 'MELISSA.DOC',
    hp: 1150, speed: 0.55, reward: 150, cpuDamage: 40,
    radius: 0.85, y: 0.75, barY: 2.0, barW: 1.7, barSegs: 20,
    color: 0x3d7bff, model: 'melissa', scale: 1, boss: true, slowResist: 0.3, leakMin: 0.4,
    splitAt: { thresholds: [0.66, 0.33], type: 'macro', count: 3, spread: 0.45 },
    desc: { en: 'Mass-mails macros to everyone in your address book.', it: 'Spedisce macro a tutta la rubrica.' },
  },
  boss_iloveyou: {
    name: 'ILOVEYOU.VBS',
    hp: 4200, speed: 0.45, reward: 400, cpuDamage: 45,
    radius: 0.95, y: 0.8, barY: 1.85, barW: 2.0, barSegs: 24,
    color: 0xff3c8e, model: 'iloveyou', scale: 1, boss: true, slowResist: 0.4, leakMin: 0.4,
    bossSpawn: { type: 'worm', every: 3.5, count: 2, reward: 3, warn: 0.7, allPorts: true },
    desc: { en: 'Kindly check the attached LOVE-LETTER-FOR-YOU.TXT', it: 'Apri l\'allegato LOVE-LETTER-FOR-YOU.TXT' },
  },
};

export const ENEMY_TYPES = Object.keys(ENEMIES);

// Effective hit points of one enemy of `type` including everything it splits/summons into (used for wave threat).
export function effectiveHp(type, depth = 0) {
  const d = ENEMIES[type];
  if (!d || depth > 4) return 0;
  let hp = d.hp;
  if (d.split) hp += d.split.count * effectiveHp(d.split.into, depth + 1);
  if (d.splitAt) hp += d.splitAt.thresholds.length * d.splitAt.count * effectiveHp(d.splitAt.type, depth + 1);
  if (d.bossSpawn) {
    // rough: summons during the time it takes to cross ~45 units of path
    const lifetime = 45 / d.speed;
    hp += Math.floor(lifetime / d.bossSpawn.every) * d.bossSpawn.count * effectiveHp(d.bossSpawn.type, depth + 1) * 0.5;
  }
  return hp;
}
