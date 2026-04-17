import { create } from 'zustand';

interface PlayerState {
  /** Is audio currently playing? */
  isPlaying: boolean;
  /** Current playback time in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Playback speed (0.25 – 2.0) */
  speed: number;
  /** Is audio loaded? */
  isLoaded: boolean;

  // Actions
  setIsPlaying: (v: boolean) => void;
  togglePlay: () => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setSpeed: (s: number) => void;
  setIsLoaded: (v: boolean) => void;
  reset: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  speed: 1,
  isLoaded: false,

  setIsPlaying: (v) => set({ isPlaying: v }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setSpeed: (s) => set({ speed: Math.max(0.25, Math.min(2, s)) }),
  setIsLoaded: (v) => set({ isLoaded: v }),
  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      speed: 1,
      isLoaded: false,
    }),
}));
