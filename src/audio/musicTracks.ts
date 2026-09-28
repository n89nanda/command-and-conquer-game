/**
 * RIFTFALL score. Every track is data interpreted by the sequencer in music.ts.
 *
 * Notation (spaces and '|' inside pattern strings are ignored, they are only for readability):
 *  - chords:  space separated scale degrees (0 = i, 5 = VI, 2 = III, 6 = VII ...), one bar each,
 *             or "deg:beats". Suffix M = major triad (e.g. 4M = V in harmonic minor).
 *  - drums:   one char per 16th: X=1.0 x=0.8 o=0.5 g=0.3 .=rest. Length 16*n (bars).
 *  - bass/gtr: per 16th: R/X accent root, r/x root, m muted root, o/O octave, f fifth,
 *             2..7 diatonic step above chord root, b/a one/two diatonic steps below, n next chord root,
 *             '-' tie, '.' rest.  (gtr plays diatonic power chords on those roots)
 *  - arp:     per 16th: 0..9 index into [root,3rd,5th,oct,3rd+8va,5th+8va,2oct,3rd+2oct,7th,9th].
 *  - stab:    per 16th: X/x chord hit, '-' tie, '.' rest.
 *  - melody:  tokens "deg:len" (len in 16ths), deg = scale degree from track.leadTonic, '#'/'b' suffix alters.
 *             "_:len" rest.
 *  - section pattern fields: "keyA keyB*3" = per-bar sequence (cycled), "_" = silent bar.
 *             An array means variants chosen by loop pass.
 */

export type Layer = 'drums' | 'perc' | 'bass' | 'gtr' | 'lead' | 'arp' | 'pad' | 'stab' | 'fx';
export const LAYERS: Layer[] = ['drums', 'perc', 'bass', 'gtr', 'lead', 'arp', 'pad', 'stab', 'fx'];

export type LeadInst = 'saw' | 'square' | 'brass' | 'bell';
export type BassStyle = 'drive' | 'acid' | 'soft' | 'sub';

export type V = string | string[];

export interface SectionDef {
  name: string;
  bars: number;
  chords: string;
  drums?: V;
  bass?: V;
  gtr?: V;
  arp?: V;
  stab?: V;
  lead?: V;
  leadInst?: LeadInst;
  leadOct?: number;
  pad?: 'sus' | 'choir' | 'pulse';
  drone?: boolean;
  /** Bars of noise riser at the end of the section. */
  riser?: number;
  /** Reversed cymbal into the next section. */
  revCrash?: boolean;
  /** Crash on downbeat (default true when the section has drums). */
  crash?: boolean;
  /** Big boom impact on downbeat. */
  boom?: boolean;
  /** Disable automatic drum fills. */
  noFill?: boolean;
}

export interface TrackDef {
  title: string;
  bpm: number;
  /** MIDI note of the tonic (reference octave). */
  tonic: number;
  scale: number[];
  bassLow: number;
  gtrLow: number;
  arpLow: number;
  padLow: number;
  stabLow: number;
  leadTonic: number;
  bassStyle: BassStyle;
  leadInst: LeadInst;
  arpWave: OscillatorType;
  swing?: number;
  bassDrive?: number;
  gtrDrive?: number;
  /** Layer level overrides (multiplies defaults). */
  levels?: Partial<Record<Layer, number>>;
  /** Intensity response per layer: [lo, hi, floor] -> gain = floor + (1-floor)*smoothstep(lo,hi,intensity). */
  intensity?: Partial<Record<Layer, [number, number, number?]>>;
  drums: Record<string, Record<string, string>>;
  fills: Record<string, Record<string, string>>;
  bass?: Record<string, string>;
  gtr?: Record<string, string>;
  arp?: Record<string, string>;
  stab?: Record<string, string>;
  mel?: Record<string, string>;
  sections: SectionDef[];
  order: string[];
  /** Index in `order` to loop back to; -1 = one-shot cue (fades out after the last section). */
  loopFrom: number;
  /** Extra allowed pitch classes (semitones from tonic) for the key check, e.g. picardy third. */
  extraPcs?: number[];
}

export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
export const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

// shared drum fills ('_' keeps the underlying groove)
const FILLS: Record<string, Record<string, string>> = {
  snareRoll: { snare: '________x.x.xxXX', kick: '________X.......', hat: '________........', ohat: '________........' },
  toms: {
    tomH: '________Xx......', tomM: '__________Xx....', tomL: '____________XxXX',
    snare: '________........', kick: '________X...X...', hat: '________........', ohat: '________........',
  },
  flam: { snare: '____________XgXX', kick: '____________X...', hat: '____________....' },
  tomSnare: { snare: '________X.x.....', tomH: '____________Xx..', tomL: '______________XX', hat: '________........', ohat: '________........' },
};

export const TRACKS: Record<string, TrackDef> = {
  // ------------------------------------------------------------------ MENU — D minor, epic & moody
  menu: {
    title: 'Riftfall (Main Theme)',
    bpm: 92, tonic: 38, scale: MINOR,
    bassLow: 29, gtrLow: 38, arpLow: 62, padLow: 50, stabLow: 57, leadTonic: 62,
    bassStyle: 'soft', leadInst: 'brass', arpWave: 'triangle', gtrDrive: 5,
    levels: { gtr: 0.8, arp: 0.8 },
    drums: {
      introEpic: { taiko: 'X............... ................ ................ ........x...x...' },
      epic: { kick: 'X.......X.x.....', snare: '........X.......', taiko: '....x.........x.', hat: 'x...x...x...x...' },
      taikoBuild: { taiko: 'x.x.x.x.x.x.x.xx', kick: 'X...X...X...X...', hat: 'x.x.x.x.x.x.x.x.' },
      epicFull: { kick: 'X.....x.X.......', snare: '....X.......X...', taiko: '..x.......x.....', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............o.' },
    },
    fills: FILLS,
    bass: { long: 'R-------R---o---', pulse: 'R.r.R.r.R.r.R.r.', drive: 'R.rrR.rrR.rrR.rn' },
    gtr: { epic: 'X-------X---X---', chug8: 'm.m.m.m.m.m.m.m.', drive: 'X--xX--xX-x-X---' },
    arp: { slow: '0...2...3...2...', a8: '0.3.2.3.0.3.2.4.', a16: '0235320502353205' },
    stab: { hits: 'X.......X.....x.' },
    mel: {
      bell: '4:8 3:4 2:4 | 3:8 2:4 0:4 | 2:8 4:4 6:4 | 6:12 3:4 | 4:8 3:4 2:4 | 3:8 5:4 4:4 | 3:8 2:4 1:4 | 4:16',
      brass: '4:6 3:2 2:4 0:4 | 3:6 2:2 0:8 | 2:6 4:2 6:8 | 6:6 7:2 3:8 | 4:6 3:2 2:4 0:4 | 3:6 5:2 4:8 | 3:6 2:2 1:8 | 4:12 _:4',
      outro: '7:16 | 5:16 | 4:8 3:8 | 4:16 | 7:8 9:8 | 9:16 | 8:8 6#:8 | 4:16',
    },
    sections: [
      { name: 'intro', bars: 8, chords: '0 5 2 6 0 5 3 4M', drums: 'introEpic', lead: 'bell', leadInst: 'bell', leadOct: 1, pad: 'choir', drone: true, boom: true, crash: false, noFill: true, riser: 2 },
      { name: 'theme', bars: 16, chords: '0 5 2 6 0 5 3 4M', drums: 'epic', bass: 'long', gtr: 'epic', lead: 'brass', arp: 'slow', pad: 'sus' },
      { name: 'bridge', bars: 8, chords: '3 3 5 5 6 6 4M 4M', drums: 'taikoBuild', bass: 'pulse', gtr: '_*4 chug8*4', arp: 'a8', pad: 'choir', riser: 2, revCrash: true },
      { name: 'climax', bars: 16, chords: '0 5 2 6 0 5 3 4M', drums: 'epicFull', bass: 'drive', gtr: 'drive', lead: 'brass', leadOct: 1, arp: 'a16', stab: 'hits', pad: 'choir', boom: true },
      { name: 'outro', bars: 8, chords: '0 5 3 4M 0 5 4M 4M', bass: 'long', lead: 'outro', leadInst: 'bell', pad: 'sus', drone: true },
    ],
    order: ['intro', 'theme', 'bridge', 'climax', 'outro'],
    loopFrom: 0,
  },

  // ------------------------------------------------------------------ BRIEFING — C minor, tense pulse
  briefing: {
    title: 'Dossier',
    bpm: 100, tonic: 36, scale: MINOR,
    bassLow: 31, gtrLow: 36, arpLow: 60, padLow: 48, stabLow: 60, leadTonic: 72,
    bassStyle: 'soft', leadInst: 'bell', arpWave: 'triangle',
    levels: { bass: 1.1, lead: 0.8 },
    drums: {
      tick: { tick: 'x...x...x...x...', shaker: '..o...o...o...o.' },
      pulse: { kick: 'x...x...x...x...', tick: 'x.o.x.o.x.o.x.o.', shaker: '..o...o...o...o.', rim: '............x...' },
    },
    fills: { none: {} },
    bass: { m8: 'm.m.m.m.m.m.m.m.', m16: 'm.mmm.mmm.mmm.mm' },
    arp: { sparse: '0.......3.......', a8: '0.2.3.2.0.2.3.2.', a8b: '0.2.3.5.3.2.0.2.' },
    mel: {
      b1: '0:8 _:8 | 1:8 _:4 3:4 | 2:16 | _:16 | 0:8 _:8 | 1:8 3:8 | 6#:16 | 4:16',
      b2: '_:8 2:8 | 3:8 1:8 | 0:16 | _:16 | 2:8 0:8 | 3:8 1:8 | 6#:8 1:8 | 4:16',
    },
    sections: [
      { name: 'A', bars: 8, chords: '0 0 5 5 3 3 4 4', drums: 'tick', bass: 'm8', arp: 'sparse', pad: 'sus', drone: true, noFill: true, crash: false },
      { name: 'B', bars: 8, chords: '5 6 0 0 5 6 4M 4M', drums: 'pulse', bass: 'm16', arp: 'a8', lead: 'b1', pad: 'sus', riser: 2, noFill: true, crash: false },
      { name: 'A2', bars: 8, chords: '0 0 5 5 3 3 4 4', drums: 'pulse', bass: 'm16', arp: 'a8b', pad: 'sus', drone: true, noFill: true, crash: false },
      { name: 'B2', bars: 8, chords: '5 6 0 0 5 6 4M 4M', drums: 'pulse', bass: 'm16', arp: 'a8', lead: 'b2', pad: 'pulse', riser: 2, noFill: true, crash: false },
    ],
    order: ['A', 'B', 'A2', 'B2'],
    loopFrom: 0,
  },

  // ------------------------------------------------------------------ BATTLE 1 — E minor, industrial rock
  battle1: {
    title: 'Iron Tide',
    bpm: 128, tonic: 40, scale: MINOR,
    bassLow: 28, gtrLow: 40, arpLow: 64, padLow: 55, stabLow: 60, leadTonic: 64,
    bassStyle: 'drive', leadInst: 'saw', arpWave: 'square', bassDrive: 3, gtrDrive: 9,
    intensity: { drums: [0.2, 0.45, 0], gtr: [0.4, 0.7, 0], lead: [0.6, 0.85, 0], arp: [0.1, 0.35, 0.25], stab: [0.7, 0.9, 0], bass: [0, 0.3, 0.6] },
    drums: {
      hats: { hat: 'x.o.x.o.x.o.x.o.', shaker: '..o...o...o...o.' },
      rock: { kick: 'X.....x.X.x.....', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.o.' },
      rock2: { kick: 'X.....x.X.x...x.', snare: '....X.......X..o', hat: 'x.o.x.o.x.o.x.o.' },
      build: { kick: 'X...X...X...X...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
      build2: { kick: 'X.X.X.X.X.X.X.X.', snare: 'x...x...x...x...', hat: 'xxxxxxxxxxxxxxxx' },
      drive: { kick: 'X...X...X...X.x.', snare: '....X.......X...', clap: '....x.......x...', hat: 'x...x...x...x...', ohat: '..o...o...o...o.', metal: '...............x ................' },
      half: { kick: 'X.........x.....', snare: '........X.......', hat: 'x...x...x...x...' },
    },
    fills: FILLS,
    bass: {
      pulse8: 'r.r.r.r.r.r.r.r.',
      chug: 'R..r.rR..r.rR.r.',
      chug2: 'R..r.rR..r.r3.b.',
      walk: 'R.r.R.r.R.r.R.r.',
      drive: 'R.rrR.roR.rrR.ro',
      drive2: 'R.rrR.roR.rrR.n.',
      sus: 'R-------R-------',
    },
    gtr: {
      vA: 'X..m.mX..m.mX.m.',
      vB: 'X..m.mX..m.m3.b.',
      vC: 'X..m.mX.X.X.X-X-',
      dropA: 'X--mX--mX-mmX-m.',
      dropB: 'X-.xX-.xX-.xX-xx',
      sus: 'X---------------',
      ch8: 'm.m.m.m.m.m.m.m.',
      ch16: 'mmmmmmmmmmmmmmmm',
    },
    arp: { a8: '0.2.3.2.0.2.3.2.', a16: '0235320502353205' },
    stab: { s: 'X.....X.....X...' },
    mel: {
      hook:
        '7:3 6:1 7:4 4:4 2:4 | 5:3 4:1 5:4 7:4 9:4 | 9:3 8:1 7:4 6:4 4:4 | 6:6 5:2 6:4 3:2 1:2 | ' +
        '7:3 6:1 7:4 11:4 9:4 | 12:6 11:2 9:4 7:4 | 9:4 11:4 13:4 11:4 | 13:8 12:4 11:2 8:2',
      hookB:
        '7:3 6:1 7:4 11:4 9:4 | 12:6 11:2 9:4 7:4 | 9:4 11:4 13:4 11:4 | 13:8 12:4 11:2 8:2 | ' +
        '7:3 6:1 7:4 4:4 2:4 | 5:3 4:1 5:4 7:4 9:4 | 9:3 8:1 7:4 6:4 4:4 | 6:6 5:2 6:4 3:2 1:2',
      brk: '_:8 4:4 5:4 | 6:8 5:4 3:4 | 4:16 | _:16 | _:8 4:4 5:4 | 6:8 8:4 7:4 | 6#:16 | _:16',
    },
    sections: [
      { name: 'intro', bars: 8, chords: '0 5 2 6', drums: 'hats', bass: '_*4 pulse8*4', arp: 'a8', pad: 'sus', riser: 2, revCrash: true, noFill: true, crash: false },
      { name: 'verse', bars: 16, chords: '0 0 5 6', drums: 'rock*7 rock2', bass: 'chug chug2 chug chug', gtr: ['vA vB vA vC', 'vA vB vA vB'], arp: 'a8', pad: 'sus' },
      { name: 'build', bars: 8, chords: '3 5 6 6 3 5 4M 4M', drums: 'build*4 build2*4', bass: 'walk', gtr: 'sus*4 ch8*2 ch16*2', arp: 'a16', pad: 'sus', riser: 4 },
      { name: 'drop', bars: 16, chords: '0 5 2 6', drums: 'drive', bass: 'drive*3 drive2', gtr: 'dropA*3 dropB', lead: ['hook', 'hookB'], arp: 'a16', stab: 's', pad: 'sus', boom: true },
      { name: 'break', bars: 8, chords: '5 6 0 0 5 6 4M 4M', drums: 'half', bass: 'sus', lead: 'brk', leadInst: 'bell', arp: 'a8', pad: 'sus', riser: 2, revCrash: true },
      { name: 'drop2', bars: 16, chords: '0 5 2 6', drums: 'drive', bass: 'drive*3 drive2', gtr: 'dropB*3 dropA', lead: ['hookB', 'hook'], arp: 'a16', stab: 's', pad: 'sus', boom: true },
    ],
    order: ['intro', 'verse', 'build', 'drop', 'break', 'drop2'],
    loopFrom: 1,
  },

  // ------------------------------------------------------------------ BATTLE 2 — A phrygian, acid electro-industrial
  battle2: {
    title: 'Machine Code',
    bpm: 138, tonic: 45, scale: PHRYGIAN,
    bassLow: 33, gtrLow: 45, arpLow: 69, padLow: 57, stabLow: 60, leadTonic: 69,
    bassStyle: 'acid', leadInst: 'square', arpWave: 'sawtooth', bassDrive: 2.5, gtrDrive: 8,
    intensity: { drums: [0.2, 0.45, 0], gtr: [0.55, 0.8, 0], lead: [0.6, 0.85, 0], stab: [0.35, 0.6, 0], arp: [0.1, 0.4, 0.2], bass: [0, 0.3, 0.65] },
    drums: {
      hats: { hat: 'x.oxx.oxx.oxx.ox' },
      break1: { kick: 'X.....X...X.....', snare: '....X.......X...', hat: 'x.oxx.oxx.oxx.ox' },
      break2: { kick: 'X.....X..X....x.', snare: '....X..o....X.o.', hat: 'x.oxx.oxx.oxx.ox' },
      four: { kick: 'X...X...X...X...', clap: '....X.......X...', ohat: '..x...x...x...x.', hat: 'o.o.o.o.o.o.o.o.', metal: '................ ..........x.....' },
      buildB: { kick: 'X...X...X...X...', snare: 'x.x.x.x.x.x.x.x.', hat: 'xxxxxxxxxxxxxxxx' },
      buildC: { kick: 'X.X.X.X.X.X.X.X.', snare: 'xxxxxxxxxxxxxxxx', hat: 'xxxxxxxxxxxxxxxx' },
    },
    fills: { snareRoll: FILLS.snareRoll, flam: FILLS.flam, tomSnare: FILLS.tomSnare },
    bass: {
      simple: 'R.r.R.r.R.r.R.r.',
      acid1: 'RoroRr2rRoroRo2o',
      acid2: 'R.oRr.2.R.oRrob.',
      off: '.r.r.r.r.r.r.r.r',
    },
    gtr: { riff: 'X.m2m.Xm.m2mX.b.', riff2: 'X.m2m.Xm.m2mX---' },
    arp: { a8: '0.2.3.2.0.2.3.2.', a16: '0235023502350235' },
    stab: { st1: 'X..X..X...X..X..', st2: 'X..X..X...X.X-..' },
    mel: {
      motif:
        '7:2 7:2 4:2 7:2 8:2 7:2 4:4 | 8:6 7:2 5:4 3:4 | 6:6 5:2 3:4 1:4 | 2:4 0:8 _:4 | ' +
        '7:2 7:2 4:2 7:2 8:2 7:2 9:4 | 10:6 9:2 8:4 5:4 | 6:4 8:4 10:4 8:4 | 7:12 _:4',
    },
    sections: [
      { name: 'intro', bars: 8, chords: '0 0 1 0', drums: 'hats', bass: 'simple', drone: true, pad: 'sus', riser: 2, revCrash: true, noFill: true, crash: false },
      { name: 'A', bars: 16, chords: '0 0 1 0', drums: 'break1*3 break2', bass: 'acid1', stab: '_*8 st1*8', arp: 'a16', pad: 'sus' },
      { name: 'build', bars: 8, chords: '5 5 6 6 5 5 6 6', drums: 'four*4 buildB*3 buildC', bass: 'off', stab: 'st2', pad: 'sus', riser: 4 },
      { name: 'drop', bars: 16, chords: '0 1 6 0', drums: 'four', bass: 'acid1*3 acid2', gtr: 'riff*3 riff2', stab: 'st1', lead: 'motif', arp: 'a16', pad: 'sus', boom: true },
      { name: 'break', bars: 8, chords: '3 3 5 6', drums: 'break1', bass: 'simple', stab: 'st2', arp: 'a8', pad: 'sus', riser: 2, revCrash: true },
      { name: 'drop2', bars: 16, chords: '0 1 6 0', drums: 'four*3 break2', bass: 'acid2*3 acid1', gtr: 'riff2*3 riff', stab: 'st2', lead: 'motif', leadOct: 0, arp: 'a16', pad: 'sus', boom: true },
    ],
    order: ['intro', 'A', 'build', 'drop', 'break', 'drop2'],
    loopFrom: 1,
  },

  // ------------------------------------------------------------------ BATTLE 3 — G harmonic minor, heavy march
  battle3: {
    title: 'Steel March',
    bpm: 112, tonic: 43, scale: HARMONIC,
    bassLow: 31, gtrLow: 43, arpLow: 67, padLow: 55, stabLow: 55, leadTonic: 67,
    bassStyle: 'drive', leadInst: 'brass', arpWave: 'square', bassDrive: 3.5, gtrDrive: 10,
    intensity: { drums: [0.15, 0.4, 0], gtr: [0.4, 0.65, 0], lead: [0.55, 0.8, 0], arp: [0.75, 0.95, 0], stab: [0.6, 0.85, 0], bass: [0, 0.3, 0.6] },
    drums: {
      intro: { rim: 'X.xxX.x.X.xxX.xx', taiko: 'X............... ................ ................ X.......X.X.X.X.' },
      march: { kick: 'X...X...X...X...', snare2: '....X.......X...', rim: 'o.oo.oo.o.oo.oo.', hat: 'x.x.x.x.x.x.x.x.', metal: '................ ..............x.' },
      stomp: { kick: 'X..xX...X..xX...', snare2: '....X.......X...', taiko: 'x.......x.x.....', hat: 'x.x.x.x.x.x.x.x.', rim: '..o...o...o...o.' },
      roll: { snare: 'goxogoxogoxogoxo', kick: 'X.......X.......', rim: 'x...x...x...x...' },
    },
    fills: { snareRoll: FILLS.snareRoll, toms: FILLS.toms, tomSnare: FILLS.tomSnare },
    bass: { m8: 'R.R.R.R.R.R.R.R.', m8b: 'R.R.R.R.RRR.R.o.', gal: 'R.rrR.rrR.rrR.rr', sus: 'R-------R-------' },
    gtr: { g1: 'X...X...X.X.X...', g2: 'X--.X--.X-X-X---', gal: 'X.mmX.mmX.mmX.mm', sus: 'X---------------' },
    arp: { a16: '0.3.2.3.0.3.2.3.' },
    stab: { s: 'X.......X.X.....' },
    mel: {
      theme:
        '0:3 0:1 4:4 4:3 4:1 7:4 | 5:3 4:1 2:4 4:8 | 3:3 3:1 5:4 7:3 5:1 3:4 | 4:3 6:1 8:4 4:8 | ' +
        '7:3 7:1 9:4 11:4 9:4 | 12:6 11:2 9:8 | 10:3 9:1 7:4 5:4 3:4 | 6:4 8:4 11:8',
    },
    sections: [
      { name: 'intro', bars: 4, chords: '0 0 3 4', drums: 'intro', pad: 'choir', drone: true, boom: true, crash: false, noFill: true, revCrash: true },
      { name: 'A', bars: 16, chords: '0 0 3 4', drums: 'march', bass: 'm8*3 m8b', gtr: 'g1', pad: 'choir', arp: 'a16' },
      { name: 'B', bars: 8, chords: '0 5 3 4', drums: 'stomp', bass: 'gal', gtr: 'gal', pad: 'choir', arp: 'a16', stab: 's', riser: 1 },
      { name: 'drop', bars: 16, chords: '0 0 3 4 0 5 3 4', drums: 'stomp*7 march', bass: 'gal', gtr: 'g2', lead: 'theme', arp: 'a16', stab: 's', pad: 'choir', boom: true },
      { name: 'break', bars: 8, chords: '5 5 3 3 4 4 4 4', drums: 'roll', bass: 'sus', gtr: 'sus', pad: 'choir', riser: 2, revCrash: true },
      { name: 'drop2', bars: 16, chords: '0 0 3 4 0 5 3 4', drums: 'stomp', bass: 'gal', gtr: ['gal', 'g2'], lead: 'theme', arp: 'a16', stab: 's', pad: 'choir', boom: true },
    ],
    order: ['intro', 'A', 'B', 'drop', 'break', 'drop2'],
    loopFrom: 1,
  },

  // ------------------------------------------------------------------ TENSION — B minor, sparse suspense
  tension: {
    title: 'Cold Front',
    bpm: 90, tonic: 35, scale: MINOR,
    bassLow: 28, gtrLow: 35, arpLow: 59, padLow: 50, stabLow: 59, leadTonic: 71,
    bassStyle: 'sub', leadInst: 'bell', arpWave: 'triangle',
    levels: { lead: 0.75, perc: 1.2 },
    intensity: { bass: [0, 0.4, 0.6], arp: [0.2, 0.6, 0.3] },
    drums: {
      heart: { heart: 'X.......X.......', tick: 'o...o...o...o...' },
      heartPulse: { heart: 'X.......X.......', tick: 'o.o.o.o.o.o.o.o.', metal: '................ ................ ................ ........x.......' },
    },
    fills: { none: {} },
    bass: { sus: 'R---------------', pulse8: 'r.r.r.r.r.r.r.r.' },
    arp: { tri: '0..2..3..2..0...' },
    mel: { t: '7:16 | _:16 | 7:8 6:8 | 4:16 | _:16 | _:8 9:8 | 8:16 | 7:16' },
    sections: [
      { name: 'A', bars: 8, chords: '0 0 5 5 0 0 3 3', drums: 'heart', bass: 'sus', lead: 't', pad: 'sus', drone: true, noFill: true, crash: false },
      { name: 'B', bars: 8, chords: '5 5 6 6 3 3 4M 4M', drums: 'heartPulse', bass: 'pulse8', arp: 'tri', pad: 'sus', drone: true, riser: 2, noFill: true, crash: false },
    ],
    order: ['A', 'B'],
    loopFrom: 0,
  },

  // ------------------------------------------------------------------ VICTORY — C minor -> C major fanfare (one-shot)
  victory: {
    title: 'Victory',
    bpm: 116, tonic: 48, scale: MINOR,
    bassLow: 36, gtrLow: 48, arpLow: 72, padLow: 55, stabLow: 60, leadTonic: 60,
    bassStyle: 'soft', leadInst: 'brass', arpWave: 'triangle',
    extraPcs: [4],
    levels: { lead: 1.2, stab: 1.1 },
    drums: {
      fanA: { timp: 'X.......X...x.x.', snare: '............xxxx' },
      fanB: { timp: 'X...............', kick: 'X...............', crash: 'X...............' },
      end: { timp: 'X...............', kick: 'X...............' },
    },
    fills: { none: {} },
    bass: { s: 'R-------R-------', l: 'R---------------' },
    stab: { s: 'X.......X.......', l: 'X---------------' },
    arp: { up: '0.1.2.3.4.5.6...' },
    mel: { fan: '7:2 7:1 7:1 7:4 8:4 8:2 9:2 | 11:8 9#:4 7:4 | 7:2 7:1 7:1 7:4 8:2 9:2 10:4 | 14:16' },
    sections: [
      { name: 'fanfare', bars: 4, chords: '5:2 6:2 0M:4 5:2 6:2 0M:4', drums: 'fanA fanB', bass: 's', stab: 's', lead: 'fan', pad: 'sus', noFill: true, crash: false },
      { name: 'end', bars: 2, chords: '0M:8', drums: 'end _', bass: 'l', stab: 'l _', arp: 'up _', pad: 'sus', boom: true, crash: true, noFill: true },
    ],
    order: ['fanfare', 'end'],
    loopFrom: -1,
  },

  // ------------------------------------------------------------------ DEFEAT — D minor, somber (one-shot)
  defeat: {
    title: 'Defeat',
    bpm: 70, tonic: 38, scale: MINOR,
    bassLow: 26, gtrLow: 38, arpLow: 62, padLow: 50, stabLow: 57, leadTonic: 62,
    bassStyle: 'soft', leadInst: 'bell', arpWave: 'triangle',
    drums: { t: { timp: 'X.......o.......' } },
    fills: { none: {} },
    bass: { l: 'R---------------' },
    mel: { d: '4:8 3:4 2:4 | 3:8 5:8 | 4:8 2:8 | 1:16 | 0:16' },
    sections: [
      { name: 'cue', bars: 5, chords: '0 3 5 4M 0', drums: 't*4 _', bass: 'l', lead: 'd', pad: 'choir', drone: true, boom: true, crash: false, noFill: true },
    ],
    order: ['cue'],
    loopFrom: -1,
  },
};
