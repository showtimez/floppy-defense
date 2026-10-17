import { GAME } from '../config.js';

// The single mutable game-state object. Owned by main.js (flow); other modules may READ it freely
// and must only WRITE the fields documented as theirs in docs/CONTRACTS.md.
export function createGameState() {
  return {
    phase: 'boot',          // 'boot' | 'menu' | 'prep' | 'wave' | 'paused' | 'gameover' | 'victory'
    prevPhase: null,        // phase to resume after 'paused'
    mode: 'campaign',       // 'campaign' | 'endless'
    wave: 0,                // current/last started wave (1-based; 0 before the first wave)
    totalWaves: GAME.TOTAL_WAVES,
    kb: GAME.START_KB,      // written ONLY by economy.js
    cpu: GAME.CPU_MAX,      // CPU integrity %, written ONLY by main.js
    speed: 1,               // 1 | 2
    prepTimer: 0,           // seconds left in prep
    prepDuration: GAME.PREP_TIME,
    time: 0,                // simulated seconds since new game (scaled by speed, frozen when paused)
    selected: null,         // { kind: 'slot', slot } | { kind: 'tower', tower } | null
    endlessFresh: false,    // true for an endless run started from the menu (waves 1-10 generated too)
    lkg: null,              // { wave } once a 'Last Known Good Configuration' snapshot exists (BSOD RESTORE)
    prepHold: false,        // true while the first-game wave-1 countdown waits for the first floppy
    stats: createStats(),
  };
}

export function createStats() {
  return {
    kills: 0,
    leaks: 0,
    kbEarned: 0,
    kbSpent: 0,
    towersBuilt: 0,
    upgrades: 0,
    bossKills: 0,
    damageDealt: 0,
    fanClicks: 0,
    overheats: 0,
    perfectWaves: 0,
    restores: 0,            // Last Known Good restores used this run (score x0.8 each)
  };
}

export function resetGameState(game, mode = 'campaign') {
  Object.assign(game, createGameState(), { mode, phase: game.phase });
  return game;
}
