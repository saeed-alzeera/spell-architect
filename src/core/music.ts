// Score data for the music system (see docs/music.md). Every piece is a short, simplified arrangement written from
// memory around well-known public-domain music; none is a faithful transcription:
//   main    Beethoven, Piano Sonata No. 14 "Moonlight", 1st mvt (triplet ostinato, C# minor)
//   editor  Satie, Gymnopédie No. 1 (D major, 3/4)
//   combat  Beethoven, "Moonlight", 3rd mvt (rising arpeggios and chord stabs, C# minor)
//   elite   the same, harder, with the opening of Bach's Toccata in D minor (BWV 565) transposed into C# minor
//   boss    Grieg, "In the Hall of the Mountain King" (transposed B minor -> C# minor, accelerating)
// Pitches are MIDI note numbers (60 = middle C, 61 = C#4).

export type Mood = 'main' | 'editor' | 'combat' | 'elite' | 'boss';

export interface Note {
  /** Start step within the bar. */
  s: number;
  /** MIDI pitch. */
  n: number;
  /** Length in steps. */
  d: number;
  /** Loudness 0..1. */
  v: number;
  /** 'pf' piano (default), 'pad' soft sustained sine. */
  k?: 'pf' | 'pad';
}

export interface Piece {
  /** Steps per bar. */
  steps: number;
  /** Steps per beat: a mood change lands on a beat boundary. */
  beat: number;
  /** Seconds per step; `bar` counts bars since the piece began, so a piece can speed up. */
  step(bar: number): number;
  /** The notes of one bar (`bar` counts bars since the piece began; every piece is an 8-bar form). */
  bar(bar: number): Note[];
  /** Sustain-pedal factor: how long a key's sound outlasts its written length. */
  pedal: number;
  /** Timing/loudness looseness, for a played rather than sequenced feel. */
  human: number;
  /** Present only for pieces with a drum kit: the minimum "heat" (0..1) the kit plays at. */
  drums?: number;
}

const pf = (s: number, n: number, d: number, v: number): Note => ({ s, n, d, v });
const pad = (s: number, n: number, d: number, v: number): Note => ({ s, n, d, v, k: 'pad' });

/* ---------------------------- main: Moonlight, 1st movement ---------------------------- */

// Twelve triplet eighths per bar over an octave bass; the melody floats on top (bars 4-7, and 0-3 on every second pass).
const MOON: { bass: number; tri: number[] }[] = [
  { bass: 37, tri: [56, 61, 64] }, // C#m
  { bass: 35, tri: [56, 61, 64] }, // C#m/B
  { bass: 33, tri: [56, 61, 64] }, // C#m/A
  { bass: 30, tri: [57, 61, 66] }, // F#m
  { bass: 32, tri: [56, 61, 64] }, // C#m/G#
  { bass: 32, tri: [54, 60, 63] }, // G#7
  { bass: 37, tri: [56, 61, 64] }, // C#m
  { bass: 37, tri: [56, 61, 64] }, // C#m
];
const MOON_ECHO = [68, 71, 73, 69];
const MOON_MELODY: Note[][] = [
  [], [], [], [],
  [pf(0, 68, 6, 0.5), pf(6, 73, 3, 0.45), pf(9, 76, 3, 0.45)],
  [pf(0, 75, 6, 0.5), pf(6, 72, 6, 0.45)],
  [pf(0, 73, 6, 0.5), pf(6, 71, 3, 0.4), pf(9, 68, 3, 0.4)],
  [pf(0, 68, 12, 0.5)],
];

const main: Piece = {
  steps: 12, beat: 3, pedal: 2.6, human: 0.012,
  step: () => 0.32,
  bar(bar) {
    const i = bar % 8;
    const { bass, tri } = MOON[i];
    const out: Note[] = [pf(0, bass, 12, 0.55), pf(0, bass + 12, 12, 0.32), pad(0, tri[0], 12, 0.05), pad(0, tri[2], 12, 0.04)];
    for (let s = 0; s < 12; s++) out.push(pf(s, tri[s % 3], 2, s % 3 === 0 ? 0.26 : 0.2));
    if (i < 4 && Math.floor(bar / 8) % 2 === 1) out.push(pf(0, MOON_ECHO[i], 12, 0.4));
    return out.concat(MOON_MELODY[i]);
  },
};

/* ---------------------------- editor: Gymnopédie No. 1 ---------------------------- */

// Bass on the first beat, chord on the second, in 3/4 at eighth-note steps; very slow, lots of pedal.
const GYM: { bass: number; ch: number[] }[] = [
  { bass: 43, ch: [59, 62, 66] }, // Gmaj7
  { bass: 38, ch: [57, 61, 66] }, // Dmaj7
  { bass: 43, ch: [59, 62, 66] },
  { bass: 38, ch: [57, 61, 66] },
  { bass: 43, ch: [59, 62, 66] },
  { bass: 38, ch: [57, 61, 66] },
  { bass: 40, ch: [55, 59, 62] }, // Em7
  { bass: 38, ch: [57, 61, 66] },
];
const GYM_ECHO = [74, 73, 71, 73];
const GYM_MELODY: Note[][] = [
  [], [], [], [],
  [pf(0, 78, 6, 0.36)],
  [pf(0, 81, 2, 0.34), pf(2, 79, 2, 0.3), pf(4, 78, 2, 0.3)],
  [pf(0, 76, 4, 0.34), pf(4, 74, 2, 0.3)],
  [pf(0, 73, 6, 0.34)],
];

const editor: Piece = {
  steps: 6, beat: 2, pedal: 3, human: 0.02,
  step: () => 0.45,
  bar(bar) {
    const i = bar % 8;
    const { bass, ch } = GYM[i];
    const out: Note[] = [pf(0, bass, 3, 0.4), ...ch.map((n) => pf(2, n, 4, 0.2))];
    if (i < 4 && Math.floor(bar / 8) % 2 === 1) out.push(pf(0, GYM_ECHO[i], 6, 0.26));
    return out.concat(GYM_MELODY[i]);
  },
};

/* ---------------------------- combat / elite: Moonlight, 3rd movement ---------------------------- */

// Sixteen steps per bar. Two rising arpeggio rolls, then (some bars) two chord stabs. rb = arpeggio base, iv = chord.
interface Harm { rb: number; iv: number[]; bass: number }
const CSM: Harm = { rb: 49, iv: [0, 3, 7], bass: 37 };
const GS: Harm = { rb: 44, iv: [0, 4, 7], bass: 32 };
const A: Harm = { rb: 45, iv: [0, 4, 7], bass: 33 };
const FSM: Harm = { rb: 42, iv: [0, 3, 7], bass: 30 };

const roll = (h: Harm, k: number) => h.rb + h.iv[k % 3] + 12 * Math.floor(k / 3);
const stab = (h: Harm, s: number, v: number): Note[] => [h.rb + 12, h.rb + 12 + h.iv[1], h.rb + 12 + h.iv[2], h.rb + 24].map((n) => pf(s, n, 1, v));

const COMBAT_HARM = [CSM, GS, CSM, GS, A, FSM, GS, CSM];
const combat: Piece = {
  steps: 16, beat: 4, pedal: 1.2, human: 0.006, drums: 0.3,
  step: () => 0.134,
  bar(bar) {
    const h = COMBAT_HARM[bar % 8];
    const out: Note[] = [pf(0, h.bass, 6, 0.5), pf(0, h.bass + 12, 6, 0.3), pf(8, h.bass + 12, 6, 0.3)];
    for (let s = 0; s < 12; s++) out.push(pf(s, roll(h, s % 6) + (s >= 6 ? 12 : 0), 2, s % 6 === 0 ? 0.3 : 0.22));
    if (bar % 2 === 1) out.push(...stab(h, 12, 0.34), ...stab(h, 14, 0.42));
    return out;
  },
};

// Bach's Toccata opening (A G A . G F E D C# D in D minor), moved down a semitone so it sits in C# minor, in octaves.
const TOCCATA: [number, number][] = [[0, 80], [1, 78], [2, 80], [6, 78], [7, 76], [8, 75], [9, 73], [10, 72], [11, 73]];
const ELITE_HARM = [CSM, A, FSM, GS, CSM, A, GS, CSM];
const elite: Piece = {
  steps: 16, beat: 4, pedal: 1.4, human: 0.005, drums: 0.6,
  step: () => 0.122,
  bar(bar) {
    const i = bar % 8;
    const h = ELITE_HARM[i];
    const out: Note[] = [];
    for (const s of [0, 4, 8, 12]) out.push(pf(s, h.bass, 3, 0.52), pf(s, h.bass + 12, 3, 0.34));
    if (i % 4 === 0) {
      for (const [s, n] of TOCCATA) out.push(pf(s, n, s === 2 || s === 11 ? 4 : 1, 0.5), pf(s, n - 12, s === 2 || s === 11 ? 4 : 1, 0.42));
      out.push(...stab(h, 12, 0.5), ...stab(h, 14, 0.5));
      return out;
    }
    for (let s = 0; s < 12; s++) out.push(pf(s, roll(h, s % 6) + (s >= 6 ? 12 : 0), 2, s % 6 === 0 ? 0.34 : 0.25));
    out.push(...stab(h, 12, 0.42), ...stab(h, 14, 0.5));
    return out;
  },
};

/* ---------------------------- boss: In the Hall of the Mountain King ---------------------------- */

// The theme in semitones above the tonic: B C# D E F# D F# / F C# F / E C E (Grieg's B minor, here C# minor), two
// notes of the theme per eighth, a bar for each pair of groups. It speeds up for as long as the fight lasts.
const MK_A = [0, 2, 3, 5, 7, 3, 7];
const MK_B = [6, 2, 6];
const MK_C = [5, 1, 5];

const boss: Piece = {
  steps: 16, beat: 4, pedal: 0.9, human: 0.003, drums: 0.85,
  step: (bar) => Math.max(0.092, 0.135 - 0.0016 * bar),
  bar(bar) {
    const i = bar % 8;
    const up = i >= 4 || bar >= 8;
    const out: Note[] = [];
    for (let s = 0; s < 16; s += 2) out.push(pf(s, 37, 1, 0.34));
    out.push(pf(0, 25, 8, 0.4));
    const put = (offs: number[], s0: number) => offs.forEach((o, k) => {
      out.push(pf(s0 + 2 * k, 49 + o, 1.5, 0.7));
      if (up) out.push(pf(s0 + 2 * k, 61 + o, 1.5, 0.55));
    });
    if (i % 2 === 0) { put(MK_A, 0); out.push(...[61, 64, 67].map((n) => pf(14, n, 1, 0.55))); }
    else { put(MK_B, 0); put(MK_C, 8); }
    return out;
  },
};

export const PIECES: Record<Mood, Piece> = { main, editor, combat, elite, boss };
