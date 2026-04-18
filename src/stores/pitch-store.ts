import { create } from 'zustand';

interface PitchState {
  /** Pitch shift in semitones (-12 to +12). 0 = original pitch. */
  pitchSemitones: number;

  setPitchSemitones: (n: number) => void;
  stepPitch: (delta: number) => void;
  resetPitch: () => void;
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export const usePitchStore = create<PitchState>((set) => ({
  pitchSemitones: 0,

  setPitchSemitones: (n) =>
    set({ pitchSemitones: clamp(Math.round(n), -12, 12) }),

  stepPitch: (delta) =>
    set((s) => ({
      pitchSemitones: clamp(s.pitchSemitones + Math.round(delta), -12, 12),
    })),

  resetPitch: () => set({ pitchSemitones: 0 }),
}));
