import { create } from 'zustand';
import { STEM_KEYS, VOLUME_DEFAULT, VOLUME_MIN, VOLUME_MAX } from '../types/stems';
import type { StemKey } from '../types/stems';

interface StemState {
  /** Volume per stem (0 – 1.2) */
  volumes: Record<StemKey, number>;
  /** Muted stems */
  muted: Record<StemKey, boolean>;
  /** Soloed stem (only one at a time, or null) */
  solo: StemKey | null;
  /** Are stems loaded & ready? */
  isLoaded: boolean;
  /** Is stems mode active (user opened the mixer)? */
  isActive: boolean;
  /** Loading progress (0–1) */
  loadingProgress: number;

  // Actions
  setVolume: (key: StemKey, value: number) => void;
  toggleMute: (key: StemKey) => void;
  toggleSolo: (key: StemKey) => void;
  resetVolumes: () => void;
  setIsLoaded: (v: boolean) => void;
  setIsActive: (v: boolean) => void;
  setLoadingProgress: (v: number) => void;
  /** Get effective volume considering mute/solo */
  getEffectiveVolume: (key: StemKey) => number;
}

const defaultVolumes = Object.fromEntries(
  STEM_KEYS.map((k) => [k, VOLUME_DEFAULT])
) as Record<StemKey, number>;

const defaultMuted = Object.fromEntries(
  STEM_KEYS.map((k) => [k, false])
) as Record<StemKey, boolean>;

export const useStemStore = create<StemState>((set, get) => ({
  volumes: { ...defaultVolumes },
  muted: { ...defaultMuted },
  solo: null,
  isLoaded: false,
  isActive: false,
  loadingProgress: 0,

  setVolume: (key, value) =>
    set((s) => ({
      volumes: {
        ...s.volumes,
        [key]: Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, value)),
      },
    })),

  toggleMute: (key) =>
    set((s) => ({
      muted: { ...s.muted, [key]: !s.muted[key] },
      // Clear solo if muting the soloed track
      solo: s.solo === key && !s.muted[key] ? null : s.solo,
    })),

  toggleSolo: (key) =>
    set((s) => ({
      solo: s.solo === key ? null : key,
    })),

  resetVolumes: () =>
    set({
      volumes: { ...defaultVolumes },
      muted: { ...defaultMuted },
      solo: null,
    }),

  setIsLoaded: (v) => set({ isLoaded: v }),
  setIsActive: (v) => set({ isActive: v }),
  setLoadingProgress: (v) => set({ loadingProgress: v }),

  getEffectiveVolume: (key) => {
    const s = get();
    // If a track is soloed, only that track plays
    if (s.solo !== null && s.solo !== key) return 0;
    // If muted, volume = 0
    if (s.muted[key]) return 0;
    return s.volumes[key];
  },
}));
