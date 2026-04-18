import type { ChordEvent } from '../types/song';

/**
 * Chromatic scale using sharps.
 * Index 0 = C, 1 = C#, ... 11 = B
 */
const SHARP_NOTES = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

/**
 * Map flat names → sharp equivalents for normalization.
 */
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Fb: 'E',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
};

/**
 * Parse a chord string into root note + suffix.
 * Supports: C, C#, Db, F#m, Bbmaj7, G#dim, Asus4, etc.
 *
 * @returns [rootNote, suffix] or null if unparseable
 */
function parseChord(chord: string): [string, string] | null {
  // Match root: a letter A-G, optionally followed by # or b
  const match = chord.match(/^([A-Ga-g])(#|b)?(.*)$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2] || '';
  const suffix = match[3] || '';

  let root = letter + accidental;

  // Normalize flats to sharps
  if (accidental === 'b' && FLAT_TO_SHARP[root]) {
    root = FLAT_TO_SHARP[root];
  }

  return [root, suffix];
}

/**
 * Transpose a single chord name by the given number of semitones.
 *
 * @param chord - Chord string, e.g. "C#m7", "Bb", "Gsus4"
 * @param semitones - Number of semitones to shift (positive = up, negative = down)
 * @returns Transposed chord string. Returns original if unparseable.
 *
 * @example
 * transposeChord('E', 5)    // 'A'
 * transposeChord('C#m', -2) // 'Bm'
 * transposeChord('Bb', 1)   // 'B'
 */
export function transposeChord(chord: string, semitones: number): string {
  if (semitones === 0) return chord;

  const parsed = parseChord(chord);
  if (!parsed) return chord;

  const [root, suffix] = parsed;
  const idx = SHARP_NOTES.indexOf(root as typeof SHARP_NOTES[number]);
  if (idx === -1) return chord;

  // Circular shift on 12-note ring
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return SHARP_NOTES[newIdx] + suffix;
}

/**
 * Transpose an array of ChordEvents.
 * Returns a new array (original is not mutated).
 */
export function transposeChords(
  chords: ChordEvent[],
  semitones: number,
): ChordEvent[] {
  if (semitones === 0) return chords;
  return chords.map((c) => ({
    ...c,
    chord: transposeChord(c.chord, semitones),
  }));
}
