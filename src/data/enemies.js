// Virus definitions (CONTRACTS §5.4 / §9 baseline balance). Tune numbers here.
//  hp, speed (units/s), reward (KB), cpuDamage (% CPU integrity on leak), radius (hit circle on XZ),
//  y (logical centre height, projectiles aim here), barY (hp-bar height), barW (hp-bar width), barSegs (DOS blocks),
//  model (enemyModels rig id), scale (model scale), slowResist (0 = full slow, 0.5 = slow effect halved),
//  vs: damage multiplier per floppy type ({ antivirus: 0.6 } = scans do 60 %),
//  split: on death spawn `count` × `into` (Macro), splitAt: boss hp thresholds that spawn `count` × `type` (Melissa),
//  bossSpawn: boss periodically summons `count` × `type` every `every` s (ILOVEYOU); allPorts: every other batch enters
//    through the other COM port,
//  leakMin: bosses only - CPU damage on leak = cpuDamage × (leakMin + (1 - leakMin) × hp/maxHp), so chip damage counts.
//  split.reward / splitAt.reward: optional base KB per child (default = the child's own reward), scaled by the parent's
//    rewardMul like bossSpawn.reward.
//  dormant: { wakeAt, speedMul, color } starts asleep (slow, greyed `color`); wakes on its first hit that does not kill it
//    or once it has covered `wakeAt` of its path, then speed ×speedMul and it takes its real `color` (Michelangelo).
//  armor: flat damage removed from every hit BEFORE the vs multiplier (never below 1 per hit; hits < 1 pass unchanged),
//    so fast weak shots and burn ticks lose most of their damage, heavy hits barely notice (CIH).
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
  michelangelo: {
    name: 'MICHELANGELO.COM',
    hp: 140, speed: 0.55, reward: 14, cpuDamage: 10,
    radius: 0.4, y: 0.45, barY: 1.4, barW: 0.7, barSegs: 9,
    color: 0xa64dff, model: 'michelangelo', scale: 1.6,
    dormant: { wakeAt: 0.45, speedMul: 3.4, color: 0x8b9099 }, // asleep ≈ 0.55 u/s, awake ≈ 1.87 u/s
    desc: {
      en: 'Sleeps until March 6. Scratch it (or let it get halfway) and it sprints: kill it in one burst.',
      it: 'Dorme fino al 6 marzo. Se lo graffi (o arriva a metà strada) scatta: abbattilo in un colpo solo.',
    },
  },
  happy99: {
    name: 'HAPPY99.EXE',
    hp: 90, speed: 1.6, reward: 10, cpuDamage: 8,
    radius: 0.32, y: 0.5, barY: 1.2, barW: 0.6, barSegs: 7,
    color: 0xffb000, model: 'happy99', scale: 1.75,
    split: { into: 'worm', count: 3, spread: 0.35, reward: 1 },
    desc: { en: 'Happy New Year 1999! Bursts into 3 worms when deleted.', it: 'Buon 1999! Esplode in 3 worm quando lo elimini.' },
  },
  cih: {
    name: 'CIH.EXE',
    hp: 320, speed: 0.75, reward: 26, cpuDamage: 15,
    radius: 0.5, y: 0.42, barY: 1.05, barW: 0.95, barSegs: 12,
    color: 0xb4ff1e, model: 'cih', scale: 1.6,
    armor: 5, vs: { firewall: 1.2 },
    desc: {
      en: 'Chernobyl: armoured BIOS killer. Every hit loses 5 damage: use heavy hitters.',
      it: 'Chernobyl: killer del BIOS corazzato. Ogni colpo perde 5 danni: usa colpi pesanti.',
    },
  },
  boss_y2k: {
    name: 'Y2K.BUG',
    hp: 9000, speed: 0.4, reward: 800, cpuDamage: 60,
    radius: 1.05, y: 0.9, barY: 2.55, barW: 2.2, barSegs: 26,
    color: 0xff5a1f, model: 'y2k', scale: 1.25, boss: true, slowResist: 0.5, leakMin: 0.4,
    splitAt: { thresholds: [0.75, 0.5, 0.25], type: 'cih', count: 2, spread: 0.5 },
    bossSpawn: { type: 'happy99', every: 4, count: 1, reward: 3, warn: 0.7, allPorts: true },
    desc: {
      en: 'Boss. At midnight 1999 becomes 1900: drops CIH chips as it breaks and fires HAPPY99 rockets.',
      it: 'Boss. A mezzanotte il 1999 diventa 1900: perde chip CIH quando si rompe e lancia razzi HAPPY99.',
    },
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
