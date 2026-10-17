// Level data for the motherboard battlefield (pure data, no three.js).
// Coordinates are in CELL units: (c, r) with cell centre at world (c + 0.5 - 12, 0, r + 0.5 - 7.5).
// Fractional values are allowed (component centres, path start/end inside connectors).
//
//      0123456789012345678901234        legend (rough):  1/2 = COM1/COM2 path   S = floppy slot
//   0  PP.....BBB......RRRRRRR.                           C = CPU  F = fan  R = RAM  N = chipset
//   1  PP11111BBB111111RRRRRRR.                           V = VGA  M = VRM  B = BIOS  I = ISA/PCI
//   2  PP1S.S1BBB1S..S1.S..S...
//   3  .S1.V.1...1.NN.11111111.
//   4  111.V.1.S.1.NN....S...1.
//   5  ...S.S1...1S....CCCC.S1.
//   6  .IIIII11111.FFF.CCCC..1.
//   7  KIIIII..S.S.FFF.CCC====.
//   8  .......22222FFF.CCCC..2.
//   9  ......S2...2....CCCC.S2.
//  10  2222...2.S.2S...S.....2.
//  11  ..S2.S.2...2..222222222.
//  12  ...2...2x..2.S2.S.S.S...
//  13  ...22222...2222..MMM....
//  14  ........................

export const MAP = {
  id: 'mb486',
  name: 'FLOPPY-486 MAINBOARD',
  chamfer: 0.45, // 45-degree PCB-style corner cut applied to every path bend (world units)

  // Two serial ports. Paths wind as length-tuned PCB meanders, pass above/below the CPU and merge on
  // its right side (head-on at the merge pad), then enter the socket. Both ~41.5 units after chamfers.
  paths: [
    {
      id: 'COM1', name: 'COM1',
      cells: [[-0.5, 4], [2, 4], [2, 1], [6, 1], [6, 6], [10, 6], [10, 1], [15, 1], [15, 3], [22, 3], [22, 7], [19.4, 7]],
    },
    {
      id: 'COM2', name: 'COM2',
      cells: [[-0.5, 10], [3, 10], [3, 13], [7, 13], [7, 8], [11, 8], [11, 13], [14, 13], [14, 11], [22, 11], [22, 7], [19.4, 7]],
    },
  ],
  mergePad: [22, 7],

  // Drive-bay slots. id = index; drive letter = 'A' + id (A: and B: guard the two ports).
  slots: [
    [1, 3], [2, 11],                         // A B   port guards
    [3, 2], [5, 2], [3, 5], [5, 5],          // C-F   VGA cluster (COM1 meander #1)
    [6, 9], [5, 11],                         // G H   COM2 meander #1
    [8, 4],                                  // I     centre of COM1 meander #2 (3 walls in range)
    [8, 7], [10, 7],                         // J K   between the branches: hit COM1 and COM2 (2 apart for touch)
    [9, 10],                                 // L     centre of COM2 meander #2
    [11, 2], [11, 5], [14, 2],               // M N O chipset cluster
    [12, 10], [13, 12],                      // P Q
    [17, 2], [20, 2], [18, 4],               // R S T RAM cluster (above the CPU)
    [16, 10],                                // U
    [16, 12], [18, 12], [20, 12],            // V W X VRM cluster (below the CPU)
    [21, 5], [21, 9],                        // Y Z   last line: beside the merge
  ],

  cpu: { c: 17.5, r: 7, size: 4.0, radius: 2.0, label: 'FLOPPY 486', model: 'DX4-100' },
  fan: { c: 13.5, r: 7, size: 2.4, radius: 1.3 },

  // Overheating components: radius = tower fire-rate penalty radius.
  heatSpots: [
    { id: 'ram', name: 'RAM', c: 18.5, r: 1.6, radius: 2.6 },
    { id: 'chipset', name: 'CHIPSET', c: 12.5, r: 3.5, radius: 2.5 },
    { id: 'vga', name: 'VGA', c: 4, r: 3.5, radius: 2.5 },
    { id: 'vrm', name: 'VRM', c: 18, r: 13.2, radius: 2.5 },
  ],

  // Static components. Positions are centres in cell units. `heat` links a part to a heat spot (glow).
  components: [
    { type: 'ram', c: 19.2, r: 0.62, len: 7.0, sticks: 4, heat: 'ram' },
    { type: 'chipset', c: 12.5, r: 3.5, size: 1.5, heat: 'chipset', label: 'FC-430TX', sub: 'NORTHBRIDGE' },
    { type: 'qfp', c: 4, r: 3.5, size: 1.3, heat: 'vga', label: 'S-VGA 9440', sub: '1MB VRAM' },
    { type: 'vrm', c: 18, r: 13.3, n: 5, heat: 'vrm' },
    { type: 'bios', c: 8, r: 1.95 },
    { type: 'battery', c: 8, r: 0.42 },
    { type: 'isa', c: 2.95, r: 6.4, len: 4.5, color: 'black', label: 'ISA1' },
    { type: 'isa', c: 3.2, r: 7.6, len: 3.9, color: 'white', label: 'PCI1' },
    { type: 'din', c: -0.15, r: 7 },
    { type: 'power', c: 0.5, r: 0.85 },
    { type: 'crystal', c: 8.7, r: 12.05, label: '14.318' },
    { type: 'dip', c: 5, r: 12.2, len: 0.95, label: 'SND-16', pins: 8 },
    { type: 'dip', c: 10.4, r: 11.9, len: 0.75, label: 'U12', pins: 7, rot: 1 },
    { type: 'fanHeader', c: 14.7, r: 9.35 },
    { type: 'toroid', c: 14.3, r: 14.0 },
    { type: 'jumper', c: 2.2, r: 8.15, n: 3, label: 'JP1' },
    { type: 'jumper', c: 20.3, r: 8.3, n: 2, label: 'JP2' },
    { type: 'jumper', c: 22.9, r: 5.6, n: 2, label: 'JP3', rot: 1 },
    // electrolytic capacitors: rad, h, col ('blue'|'black'|'purple'|'green')
    { type: 'cap', c: 15.05, r: 4.35, rad: 0.2, h: 0.42, col: 'blue' },
    { type: 'cap', c: 14.35, r: 4.55, rad: 0.17, h: 0.36, col: 'blue' },
    { type: 'cap', c: 20.2, r: 4.25, rad: 0.2, h: 0.44, col: 'purple' },
    { type: 'cap', c: 20.25, r: 9.8, rad: 0.2, h: 0.44, col: 'purple' },
    { type: 'cap', c: 15.0, r: 9.75, rad: 0.18, h: 0.38, col: 'blue' },
    { type: 'cap', c: 15.25, r: 13.25, rad: 0.3, h: 0.7, col: 'black' },
    { type: 'cap', c: 15.4, r: 14.05, rad: 0.24, h: 0.55, col: 'black' },
    { type: 'cap', c: 20.95, r: 13.35, rad: 0.3, h: 0.7, col: 'black' },
    { type: 'cap', c: 21.75, r: 13.2, rad: 0.3, h: 0.7, col: 'black' },
    { type: 'cap', c: 22.75, r: 12.75, rad: 0.34, h: 0.8, col: 'green' },
    { type: 'cap', c: 22.8, r: 13.75, rad: 0.3, h: 0.7, col: 'green' },
    { type: 'cap', c: 23.0, r: 4.6, rad: 0.17, h: 0.36, col: 'blue' },
    { type: 'cap', c: 23.0, r: 9.4, rad: 0.17, h: 0.36, col: 'blue' },
    { type: 'cap', c: 1.95, r: 5.65, rad: 0.2, h: 0.42, col: 'blue' },
    { type: 'cap', c: 0.45, r: 8.95, rad: 0.16, h: 0.34, col: 'purple' },
    { type: 'cap', c: 12.0, r: 9.5, rad: 0.18, h: 0.4, col: 'blue' },
    { type: 'cap', c: 13.25, r: 9.55, rad: 0.18, h: 0.4, col: 'blue' },
    { type: 'cap', c: 8.2, r: 9.25, rad: 0.17, h: 0.36, col: 'purple' },
    { type: 'cap', c: 4.2, r: 9.3, rad: 0.17, h: 0.36, col: 'blue' },
    { type: 'cap', c: 13.6, r: 4.95, rad: 0.15, h: 0.32, col: 'black' },
    { type: 'cap', c: 9.6, r: 13.9, rad: 0.2, h: 0.42, col: 'blue' },
    { type: 'cap', c: 0.4, r: 13.4, rad: 0.24, h: 0.5, col: 'black' },
    { type: 'cap', c: 4.3, r: 0.25, rad: 0.18, h: 0.36, col: 'blue' },
  ],

  // Silkscreen text (cell units). size = cap height in world units; rot in degrees.
  silk: [
    { text: 'COM1', c: 0.85, r: 5.55, size: 0.26 },
    { text: 'COM2', c: 0.85, r: 8.3, size: 0.26 },
    { text: 'CPU', c: 17.5, r: 9.75, size: 0.3 },
    { text: 'SOCKET 3  ZIF-237', c: 16.9, r: 4.64, size: 0.14 },
    { text: 'BIOS', c: 9.1, r: 2.55, size: 0.2 },
    { text: 'CMOS', c: 9.05, r: 0.45, size: 0.16 },
    { text: 'RAM0', c: 23.3, r: 0.16, size: 0.1 },
    { text: 'RAM1', c: 23.3, r: 0.58, size: 0.1 },
    { text: 'RAM2', c: 23.3, r: 1.0, size: 0.1 },
    { text: 'RAM3', c: 23.3, r: 1.42, size: 0.1 },
    { text: 'U12', c: 10.4, r: 12.95, size: 0.16 },
    { text: 'C34', c: 15.05, r: 3.9, size: 0.14 },
    { text: 'C35', c: 20.2, r: 3.8, size: 0.14 },
    { text: 'C36', c: 20.25, r: 10.3, size: 0.14 },
    { text: 'JP1', c: 2.2, r: 8.62, size: 0.14 },
    { text: 'ISA1', c: 1.25, r: 5.98, size: 0.14 },
    { text: 'PCI1', c: 0.6, r: 7.6, size: 0.15 },
    { text: 'VGA', c: 4, r: 4.45, size: 0.16 },
    { text: 'NB', c: 12.5, r: 4.55, size: 0.16 },
    { text: 'VRM', c: 18, r: 14.25, size: 0.2 },
    { text: 'CPU_FAN', c: 14.75, r: 9.85, size: 0.12 },
    { text: 'FAN1', c: 13.5, r: 5.45, size: 0.15 },
    { text: 'PWR', c: 1.45, r: 0.15, size: 0.15 },
    { text: 'KB', c: 0.65, r: 6.95, size: 0.14 },
    { text: 'RX', c: 0.45, r: 2.05, size: 0.11 },
    { text: 'RX', c: 0.45, r: 11.95, size: 0.11 },
    { text: 'SND', c: 5, r: 12.75, size: 0.13 },
    { text: 'X1', c: 8.7, r: 12.6, size: 0.13 },
    { text: '© 1996 FLOPPY CORP.  REV 2.1', c: 6.4, r: 14.35, size: 0.18 },
    { text: 'MADE IN TAIWAN', c: 2.4, r: 14.35, size: 0.18 },
    { text: 'FLOPPY-486 MAINBOARD', c: 12.5, r: 0.0, size: 0.22 },
    { text: 'DO NOT REMOVE CPU WHILE POWERED', c: 16.95, r: 10.3, size: 0.1, align: 'left' },
    { text: 'JP1: 1-2 TURBO  2-3 NORMAL', c: 0.95, r: 9.25, size: 0.085, align: 'left' },
    { text: 'Y2K READY?', c: 22.5, r: 10.2, size: 0.11, rot: -90 },
    { text: 'INSERT DISK 2', c: 9.35, r: 14.35, size: 0.11 },
    { text: 'DATA BUS →', c: 18.6, r: 2.52, size: 0.09 },
  ],
};
