import { create } from 'zustand';

interface ABLoopState {
  /** A point in seconds */
  a: number | null;
  /** B point in seconds */
  b: number | null;
  /** Is AB loop active? (both A and B set) */
  isActive: boolean;
  /** How many loops completed */
  loopCount: number;

  setA: (t: number | null) => void;
  setB: (t: number | null) => void;
  incrementLoop: () => void;
  clear: () => void;
}

export const useABLoopStore = create<ABLoopState>((set) => ({
  a: null,
  b: null,
  isActive: false,
  loopCount: 0,

  setA: (t) =>
    set((s) => {
      const a = t;
      const b = s.b;
      return {
        a,
        isActive: a !== null && b !== null && a < b,
        loopCount: 0,
      };
    }),
  setB: (t) =>
    set((s) => {
      const a = s.a;
      let b = t;
      // If B <= A, swap
      if (a !== null && b !== null && b <= a) {
        return { a: b, b: a, isActive: true, loopCount: 0 };
      }
      return {
        b,
        isActive: a !== null && b !== null && a < (b ?? 0),
        loopCount: 0,
      };
    }),
  incrementLoop: () => set((s) => ({ loopCount: s.loopCount + 1 })),
  clear: () => set({ a: null, b: null, isActive: false, loopCount: 0 }),
}));
