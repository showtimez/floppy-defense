// Original tracker-style songs. 16 steps per bar. Channels:
//   bass  : 16 tokens per bar, relative to the bar's chord: R root, O octave up, F fifth, f fifth below, 3 third,
//           7 seventh, N approach (a semitone under the next bar's root), '.' hold, '_' rest
//   arp   : 16 tokens, chord-tone index stacked upward across octaves, '.' rest
//   comp / stab : 16 chars, 'x' plays the chord (until the next hit), '.' nothing
//   pad   : true -> the chord held for the whole bar
//   lead  : { res: steps per token, bars: ['E5 . G5 .', ...] } notes, '.' hold, '_' rest
//   drums : lanes of 16 (or 32...) chars, 'x' hit, 'X' accent. k kick, s snare, h hat, o open hat, c crash, p shaker,
//           m tom, t floppy head tick, g floppy seek grind
// Section keys: chords[], bass, arp, comp, stab, pad, lead, drums, fill (drum part for the section's last bar), crash,
//   minLevel (skipped while the play() level is lower: later waves unlock extra sections).
// inst: { kind: 'fm', preset } | { kind: 'pulse', wave }, vol, oct (base octave for chord tones), send (echo), pan,
//       gate (note length as a fraction of a step for arps), pri (1 = dropped first under voice pressure).

export const TRACKS = {
  // C:\> FLOPPY.EXE - mysterious, slow, arpeggiated
  menu: {
    bpm: 88,
    echo: { beats: 0.75, fb: 0.42, wet: 0.55, lp: 2400 },
    inst: {
      arp: { kind: 'pulse', wave: 'p12', vol: 0.05, oct: 4, gate: 0.7, send: 0.7, pan: 0.25, pri: 1 },
      bass: { kind: 'fm', preset: 'sub', vol: 0.2, oct: 2 },
      pad: { kind: 'fm', preset: 'pad', vol: 0.03, oct: 3, pri: 1, send: 0.3 },
      lead: { kind: 'fm', preset: 'bell', vol: 0.14, send: 0.7, pan: -0.2 },
      drums: { vol: 0.32 },
    },
    parts: {
      arp: { A: '0 2 1 3 2 4 3 5 4 6 3 5 2 4 1 3' },
      bass: { A: 'R . . . . . . . . . . . R . O .' },
      drums: { A: { t: '....x.......x...' }, F: { t: '....x.......x...', g: '........x.......' } },
      lead: {
        M1: { res: 2, bars: [
          'E5 . . . D5 E5 G5 .', 'A5 . . . . . G5 E5', 'F5 . E5 . D5 . C5 .', 'B4 . . . . . _ .',
          'E5 . . . D5 E5 A5 .', 'C6 . . . B5 . A5 .', 'A5 . . . F5 . D5 .', 'G#5 . . . . . _ .',
        ] },
      },
    },
    song: [
      { chords: ['Am9', 'Fmaj7', 'Dm9', 'E7sus4', 'Am9', 'Fmaj7', 'Bbmaj7', 'E7'], arp: 'A', bass: 'A', pad: true, drums: 'A', fill: 'F' },
      { chords: ['Am9', 'Fmaj7', 'Dm9', 'E7sus4', 'Am9', 'Fmaj7', 'Bbmaj7', 'E7'], arp: 'A', bass: 'A', pad: true, drums: 'A', lead: 'M1', fill: 'F' },
    ],
  },

  // preparation: chill lo-fi comp over the PC's own hum
  prep: {
    bpm: 90,
    swing: 0.14,
    echo: { beats: 0.5, fb: 0.3, wet: 0.4, lp: 2200 },
    bed: { hum: 0.05, fan: 0.06, ticks: true },
    inst: {
      comp: { kind: 'fm', preset: 'keys', vol: 0.055, oct: 4, send: 0.25, pri: 2 },
      bass: { kind: 'fm', preset: 'sub', vol: 0.17, oct: 2 },
      lead: { kind: 'fm', preset: 'bell', vol: 0.1, send: 0.6, pan: 0.2 },
      drums: { vol: 0.22 },
    },
    parts: {
      comp: { A: 'x.....x.....x...' },
      bass: { A: 'R . . . . . . . R . . F . . . .' },
      drums: { A: { k: 'x.........x.....', t: '....x.......x...', p: '..x...x...x...x.' } },
      lead: { P1: { res: 2, bars: ['_ _ _ _ E5 . G5 .', 'A5 . . . . . _ _', '_ _ _ _ F5 . E5 .', 'D5 . . . . . _ _'] } },
    },
    song: [
      { chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'], comp: 'A', bass: 'A', drums: 'A' },
      { chords: ['Fmaj7', 'Em7', 'Dm7', 'G7sus4'], comp: 'A', bass: 'A', drums: 'A', lead: 'P1' },
    ],
  },

  // the wave: driving FM bass, drums, PC-speaker lead
  wave: {
    bpm: 136,
    echo: { beats: 0.75, fb: 0.25, wet: 0.28, lp: 2600 },
    inst: {
      bass: { kind: 'fm', preset: 'bass', vol: 0.17, oct: 2 },
      arp: { kind: 'pulse', wave: 'p25', vol: 0.06, oct: 4, gate: 0.5, send: 0.45, pan: -0.3, pri: 1 },
      lead: { kind: 'pulse', wave: 'p50', vol: 0.12, send: 0.3, pan: 0.1 },
      stab: { kind: 'fm', preset: 'brass', vol: 0.05, oct: 4, pri: 2, pan: 0.25 },
      drums: { vol: 0.36 },
    },
    parts: {
      bass: {
        A: 'R . R . O . R . R . R . O . F .',
        B: 'R . R O . R R . R . R O . R F N',
        C: 'R . . . . . . . R . . . . . . .',
      },
      arp: { A: '0 1 2 3 2 1 0 1 2 3 2 1 0 1 2 3' },
      stab: { S: 'x.........x.....' },
      drums: {
        A: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
        B: { k: 'x.....x.x.x.....', s: '....X.......X...', h: 'X.x.X.x.X.x.X.x.', o: '..............x.' },
        F: { k: 'x.......x.......', s: '....X...x.x.XxXX', g: 'x...............', h: 'x.x.x.x.........' },
        C: { k: 'x.......x.......', g: '....x.......x...', t: 'x.xxx.xxx.xxx.xx' },
      },
      lead: {
        L1: { res: 2, bars: [
          'E5 . G5 . B5 . A5 G5', 'F#5 . E5 . D5 . E5 .', 'E5 . G5 . C6 . B5 A5', 'B5 . A5 . F#5 . D5 .',
          'E5 . G5 . B5 . E6 .', 'D6 . B5 . G5 . A5 B5', 'C6 . B5 . G5 . E5 .', 'D#5 . F#5 . A5 . B5 .',
        ] },
        L2: { res: 2, bars: [
          'B5 . . B5 . . A5 B5', 'G5 . E5 . . . E5 F#5', 'G5 . . G5 . . F#5 G5', 'A5 . F#5 . . . D5 .',
          'B5 . . B5 . . D6 B5', 'E6 . D6 . B5 . G5 .', 'C6 . . E6 . . D6 C6', 'B5 . . . . . _ .',
        ] },
        // the late-game theme (waves 6+): climbs over the subdominant, lands on the dominant
        L3: { res: 2, bars: [
          'E6 . . D6 C6 . B5 A5', 'G5 . . . C6 . E6 .', 'D6 . B5 . G5 . A5 B5', 'D#6 . . . F#6 . B5 .',
          'E6 . . D6 C6 . B5 A5', 'G5 . E5 . G5 . C6 .', 'B5 . D6 . G6 . F#6 E6', 'D#6 . F#6 . B5 . . .',
        ] },
      },
    },
    // minLevel: the section is skipped while the play() `level` (the wave number) is lower
    song: [
      { chords: ['Em', 'Em', 'C', 'D'], bass: 'A', drums: 'A', arp: 'A', fill: 'F', crash: true },
      { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B7'], bass: 'A', drums: 'B', arp: 'A', lead: 'L1', stab: 'S', fill: 'F', crash: true },
      { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B7'], bass: 'B', drums: 'B', arp: 'A', lead: 'L2', stab: 'S', fill: 'F', crash: true },
      { chords: ['Am', 'C', 'G', 'B7', 'Am', 'C', 'G', 'B7'], bass: 'B', drums: 'B', arp: 'A', lead: 'L3', stab: 'S', fill: 'F', crash: true, minLevel: 6 },
      { chords: ['C', 'D', 'B7', 'B7'], bass: 'C', drums: 'C', arp: 'A' },
    ],
  },

  // boss: faster, harmonic minor, intense
  boss: {
    bpm: 164,
    echo: { beats: 0.5, fb: 0.2, wet: 0.22, lp: 2800 },
    inst: {
      bass: { kind: 'fm', preset: 'slap', vol: 0.16, oct: 2 },
      arp: { kind: 'pulse', wave: 'p12', vol: 0.05, oct: 5, gate: 0.5, send: 0.35, pan: 0.3, pri: 1 },
      lead: { kind: 'pulse', wave: 'p25', vol: 0.15, send: 0.25, pan: -0.1 },
      stab: { kind: 'fm', preset: 'brass', vol: 0.045, oct: 4, pri: 2 },
      drums: { vol: 0.32 },
    },
    parts: {
      bass: { A: 'R . R R O . R R R . R R O . F O' },
      arp: { A: '0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3' },
      stab: { S: 'x..x..x.........' },
      drums: {
        A: { k: 'x...x...x...x...', s: '....X.......X...', h: 'x.xxx.xxx.xxx.xx' },
        B: { k: 'x...x...x...x.xx', s: '....X..x....X.x.', h: 'xxxxxxxxxxxxxxxx', o: '......x.......x.' },
        F: { k: 'x...x...x.x.x.x.', s: '....X...XxXxXXXX', g: 'x...............' },
      },
      lead: {
        B1: { res: 2, bars: [
          'D5 D5 A5 . G5 F5 E5 F5', 'D5 . . . F5 . A#5 .', 'G5 G5 D6 . C6 A#5 A5 A#5', 'A5 . . . C#6 . E6 .',
          'F6 . E6 . D6 . A5 .', 'A#5 . A5 . F5 . D5 .', 'G5 . A#5 . D6 . G6 .', 'E6 . C#6 . A5 . G5 .',
        ] },
        B2: { res: 1, bars: [
          'D5 . D5 . C#5 . D5 . F5 . D5 . C#5 . C5 .', 'A#4 . A#4 . A4 . A#4 . D5 . A#4 . A4 . G4 .',
          'G4 . G4 . F#4 . G4 . A#4 . D5 . G5 . F5 .', 'E5 . E5 . C#5 . E5 . A5 . G5 . E5 . C#5 .',
        ] },
      },
    },
    song: [
      { chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A7'], bass: 'A', drums: 'A', arp: 'A', stab: 'S', fill: 'F', crash: true },
      { chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A7'], bass: 'A', drums: 'B', arp: 'A', lead: 'B1', stab: 'S', fill: 'F', crash: true },
      { chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A7'], bass: 'A', drums: 'B', arp: 'A', lead: 'B2', fill: 'F', crash: true },
    ],
  },

  // victory: a short triumphant loop
  victory: {
    bpm: 120,
    echo: { beats: 0.75, fb: 0.3, wet: 0.3, lp: 3000 },
    inst: {
      bass: { kind: 'fm', preset: 'bass', vol: 0.17, oct: 2 },
      comp: { kind: 'fm', preset: 'brass', vol: 0.04, oct: 4, pri: 2 },
      arp: { kind: 'pulse', wave: 'p12', vol: 0.025, oct: 5, gate: 0.5, send: 0.5, pan: 0.3, pri: 1 },
      lead: { kind: 'pulse', wave: 'p50', vol: 0.08, send: 0.35 },
      drums: { vol: 0.36 },
    },
    parts: {
      bass: { A: 'R . . . O . . . R . . . O . F .' },
      comp: { A: 'x..x..x...x.x...' },
      arp: { A: '0 1 2 3 4 3 2 1 0 1 2 3 4 3 2 1' },
      drums: { A: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' } },
      lead: {
        V1: { res: 2, bars: [
          'G4 . C5 . E5 . G5 .', 'A5 . . . G5 . E5 .', 'F5 . A5 . C6 . A5 .', 'G5 . . . D5 . G5 .',
          'E5 . G5 . C6 . E6 .', 'F6 . E6 . D6 . C6 .', 'D6 . . . B5 . G5 .', 'C6 . . . . . _ .',
        ] },
      },
    },
    song: [
      { chords: ['C', 'Am', 'F', 'G', 'C', 'F', 'G', 'C'], bass: 'A', comp: 'A', arp: 'A', drums: 'A', lead: 'V1', crash: true },
    ],
  },

  // game over: sparse, sad, slightly detuned (dying hardware)
  gameover: {
    bpm: 66,
    wobble: 14,
    echo: { beats: 1, fb: 0.45, wet: 0.55, lp: 1800 },
    inst: {
      arp: { kind: 'fm', preset: 'bell', vol: 0.065, oct: 4, gate: 4, send: 0.6, pan: 0.2, pri: 1 },
      pad: { kind: 'fm', preset: 'pad', vol: 0.04, oct: 3, pri: 1 },
      bass: { kind: 'fm', preset: 'sub', vol: 0.17, oct: 2 },
      lead: { kind: 'pulse', wave: 'p50', vol: 0.05, send: 0.6, pan: -0.15 },
    },
    parts: {
      arp: { A: '0 . 1 . 2 . 4 . 2 . 1 . _ . . .' },
      bass: { A: 'R . . . . . . . . . . . . . . .' },
      lead: { G1: { res: 2, bars: ['E5 . . . C5 . . .', 'A4 . . . . . . .', 'F4 . A4 . D5 . . .', 'B4 . . . G#4 . . .'] } },
    },
    song: [
      { chords: ['Am', 'Fmaj7', 'Dm6', 'E7'], arp: 'A', pad: true, bass: 'A' },
      { chords: ['Am', 'Fmaj7', 'Dm6', 'E7'], arp: 'A', pad: true, bass: 'A', lead: 'G1' },
    ],
  },
};
