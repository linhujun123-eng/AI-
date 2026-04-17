import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChordEvent } from '../../types/song';
import { usePlayerStore } from '../../stores/player-store';
import styles from './ChordDisplay.module.css';

interface ChordDisplayProps {
  chords: ChordEvent[];
}

/** Binary search: find the last chord whose time <= t */
function findChordIndex(chords: ChordEvent[], t: number): number {
  let lo = 0;
  let hi = chords.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].time <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export function ChordDisplay({ chords }: ChordDisplayProps) {
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [timeToNext, setTimeToNext] = useState(-1);
  const rafRef = useRef<number>(0);
  const lastIdxRef = useRef(-1);

  const isPlaying = usePlayerStore((s) => s.isPlaying);

  // Get high-precision time directly from WaveSurfer (bypasses store latency)
  const getTime = useCallback((): number => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getter = (window as any).__waveformGetCurrentTime;
    if (typeof getter === 'function') return getter();
    return usePlayerStore.getState().currentTime;
  }, []);

  // Own RAF loop — only runs when playing, reads WaveSurfer time directly
  useEffect(() => {
    if (!isPlaying || chords.length === 0) {
      // When paused, do one final sync from store
      const t = getTime();
      const idx = findChordIndex(chords, t);
      setCurrentIdx(idx);
      lastIdxRef.current = idx;
      const ni = idx + 1 < chords.length ? idx + 1 : -1;
      setTimeToNext(ni >= 0 ? Math.max(0, chords[ni].time - t) : -1);
      return;
    }

    let lastDisplayedTTN = '';

    const tick = () => {
      const t = getTime();
      const idx = findChordIndex(chords, t);

      // Only trigger React setState when chord index actually changes
      if (idx !== lastIdxRef.current) {
        setCurrentIdx(idx);
        lastIdxRef.current = idx;
      }

      // Update countdown — only re-render when the displayed text would change
      const ni = idx + 1 < chords.length ? idx + 1 : -1;
      const ttn = ni >= 0 ? Math.max(0, chords[ni].time - t) : -1;
      const displayTTN = ttn < 0 ? '' : ttn < 1 ? 'now' : ttn.toFixed(1);
      if (displayTTN !== lastDisplayedTTN) {
        lastDisplayedTTN = displayTTN;
        setTimeToNext(ttn);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, chords, getTime]);

  // Also sync when user seeks (currentTime jumps while paused)
  const storeTime = usePlayerStore((s) => s.currentTime);
  useEffect(() => {
    if (isPlaying || chords.length === 0) return;
    const idx = findChordIndex(chords, storeTime);
    if (idx !== lastIdxRef.current) {
      setCurrentIdx(idx);
      lastIdxRef.current = idx;
    }
    const ni = idx + 1 < chords.length ? idx + 1 : -1;
    setTimeToNext(ni >= 0 ? Math.max(0, chords[ni].time - storeTime) : -1);
  }, [storeTime, isPlaying, chords]);

  const currentChord = currentIdx >= 0 ? chords[currentIdx].chord : '';
  const nextIdx = currentIdx + 1 < chords.length ? currentIdx + 1 : -1;
  const nextChord = nextIdx >= 0 ? chords[nextIdx].chord : '';

  // Countdown urgency: show visual hint when <2s to next chord
  const isApproaching = timeToNext >= 0 && timeToNext < 2;
  const isImminent = timeToNext >= 0 && timeToNext < 0.5;

  if (chords.length === 0) return null;

  return (
    <div className={styles.container}>
      <div className={styles.current}>
        <span className={styles.label}>当前和弦</span>
        <span
          className={`${styles.chord} ${isImminent ? styles.chordPulse : ''}`}
        >
          {currentChord || '—'}
        </span>
      </div>

      {nextChord && nextChord !== currentChord && (
        <div className={`${styles.next} ${isApproaching ? styles.nextApproaching : ''}`}>
          <span className={styles.label}>下一个</span>
          <span className={styles.nextChord}>{nextChord}</span>
          {timeToNext >= 0 && (
            <span className={styles.countdown}>
              {timeToNext < 1 ? '即将切换' : `${timeToNext.toFixed(1)}s`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
