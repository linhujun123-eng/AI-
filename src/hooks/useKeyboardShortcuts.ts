import { useEffect } from 'react';
import { usePlayerStore } from '../stores/player-store';
import { useABLoopStore } from '../stores/ab-loop-store';

export function useKeyboardShortcuts() {

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const state = usePlayerStore.getState();
      const abState = useABLoopStore.getState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seek = (window as any).__waveformSeek;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toggle = (window as any).__waveformToggle;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          toggle?.();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek?.(Math.max(0, state.currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek?.(Math.min(state.duration, state.currentTime + 5));
          break;
        case 'KeyA':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            abState.setA(state.currentTime);
          }
          break;
        case 'KeyB':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            abState.setB(state.currentTime);
          }
          break;
        case 'Escape':
          e.preventDefault();
          abState.clear();
          break;
        case 'BracketLeft':
          e.preventDefault();
          usePlayerStore.getState().setSpeed(state.speed - 0.05);
          break;
        case 'BracketRight':
          e.preventDefault();
          usePlayerStore.getState().setSpeed(state.speed + 0.05);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
