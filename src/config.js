// Global constants shared by every module. Treat as READ-ONLY outside of the integration step.
// Gameplay numbers specific to a module live in that module's data file (src/data/*.js|json).

export const GAME = {
  TITLE: 'FLOPPY DEFENSE',
  VERSION: '1.0',
  TOTAL_WAVES: 10,          // campaign length; bosses on waves 5 and 10
  START_KB: 200,            // starting memory
  CPU_MAX: 100,             // CPU integrity %
  PREP_TIME: 15,            // seconds of preparation between waves
  FIRST_PREP_TIME: 25,      // longer prep before wave 1
  SELL_REFUND: 0.7,         // fraction of invested KB refunded on sell
  EARLY_CALL_KB_PER_SEC: 1, // bonus KB per remaining prep second when calling the wave early
  SPEEDS: [1, 2],           // game speed toggle values
  FIXED_DT: 1 / 60,         // simulation step
};

// World layout: X to the right, Z towards the bottom of the screen, Y up. Board plane is y = 0.
// The board is a grid of BOARD.W x BOARD.H cells of size BOARD.CELL, centred on the origin.
// Cell (c, r) centre = ((c + 0.5) * CELL - W*CELL/2, 0, (r + 0.5) * CELL - H*CELL/2).
export const BOARD = {
  W: 24,
  H: 15,
  CELL: 1,
};

// Palette: beige 90s PC + phosphor green. Hex numbers for three.js, strings for CSS.
export const PALETTE = {
  pcb: 0x0d3a26,
  pcbLight: 0x14583a,
  pcbDark: 0x082618,
  silkscreen: 0xe6e8d6,
  copper: 0xc89b45,
  gold: 0xe0b85a,
  phosphor: 0x39ff6a,
  phosphorDim: 0x1f9e44,
  amber: 0xffb000,
  danger: 0xff3b30,
  beige: 0xd8cfb4,
  beigeDark: 0xb3a888,
  plastic: 0x1c1c1f,
  chip: 0x222226,
  metal: 0xa7adb3,
  bsod: 0x0000aa,
  // floppy turrets
  antivirus: 0x2f6bff,
  firewall: 0xff3030,
  defrag: 0xffd21f,
  // viruses (suggested; enemies module may refine)
  worm: 0xff2bd6,
  trojan: 0xff8a1f,
  macro: 0x2ef2ff,
  boss: 0xff1744,
};

export const CSS = {
  phosphor: '#39ff6a',
  amber: '#ffb000',
  danger: '#ff3b30',
  beige: '#d8cfb4',
  bsod: '#0000aa',
};

// Render layers / render order hints
export const LAYERS = {
  DEFAULT: 0,
  PICK: 1, // invisible hit-meshes for raycasting live on this layer only
};
