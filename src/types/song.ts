export interface ChordEvent {
  /** Timestamp in seconds */
  time: number;
  /** Chord name, e.g. "Am", "F", "C" */
  chord: string;
}

export interface SectionMarker {
  /** Timestamp in seconds */
  time: number;
  /** Section label */
  label: string;
}

export interface Song {
  id: string;
  /** Song title */
  title: string;
  /** Artist name */
  artist: string;
  /** BPM (optional for user uploads) */
  bpm?: number;
  /** Key, e.g. "Am", "C" (optional for user uploads) */
  key?: string;
  /** Duration formatted string, e.g. "4:29" */
  duration?: string;
  /** Duration in seconds */
  durationSec?: number;
  /** Difficulty 1-3 (optional for user uploads) */
  difficulty?: number;
  /** Core chord progression description (optional for user uploads) */
  chords?: string;
  /** Cover image (emoji placeholder for MVP) */
  cover?: string;
  /** Audio paths */
  audio: {
    /** For preset: static path like '/audio/xxx/mix.mp3'
     *  For user: resolved via backend API at runtime */
    mix: string;
    /** Whether stem files are available for this song */
    hasStem?: boolean;
  };
  /** Song source: preset (bundled) or user (uploaded) */
  source: 'preset' | 'user';
  /** Upload timestamp (user songs only) */
  createdAt?: number;
}
