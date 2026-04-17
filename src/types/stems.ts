/** Stem track definitions for multi-track mixing (6-stem, matches Demucs htdemucs_6s) */

export const STEM_KEYS = [
  'vocals',
  'guitar',
  'piano',
  'drums',
  'bass',
  'other',
] as const;

export type StemKey = (typeof STEM_KEYS)[number];

export interface StemTrack {
  key: StemKey;
  /** Display label */
  label: string;
  /** Emoji icon */
  icon: string;
  /** Neon accent color */
  color: string;
  /** Audio file name (relative to song audio dir) */
  filename: string;
}

export const STEM_TRACKS: StemTrack[] = [
  { key: 'vocals', label: '人声',   icon: '🎤', color: '#ff2d95', filename: 'vocals.mp3' },
  { key: 'guitar', label: '吉他',   icon: '🎸', color: '#00e5ff', filename: 'guitar.mp3' },
  { key: 'piano',  label: '钢琴',   icon: '🎹', color: '#ffab00', filename: 'piano.mp3' },
  { key: 'drums',  label: '架子鼓', icon: '🥁', color: '#76ff03', filename: 'drums.mp3' },
  { key: 'bass',   label: 'Bass',   icon: '🎵', color: '#ff6d00', filename: 'bass.mp3' },
  { key: 'other',  label: '其他',   icon: '🔊', color: '#a855f7', filename: 'other.mp3' },
];

/** Volume range: 0 to 1.2 (0% to 120%) */
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1.2;
export const VOLUME_DEFAULT = 1.0;
