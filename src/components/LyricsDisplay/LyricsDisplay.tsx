import { useEffect, useRef, useState, useCallback } from 'react';
import type { LyricLine } from '../../types/song';
import { usePlayerStore } from '../../stores/player-store';
import styles from './LyricsDisplay.module.css';

interface LyricsDisplayProps {
  lyrics: LyricLine[];
}

/** Binary search: find the last lyric line whose time <= t */
function findLyricIndex(lyrics: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lyrics.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics[mid].time <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export function LyricsDisplay({ lyrics }: LyricsDisplayProps) {
  const [currentIdx, setCurrentIdx] = useState(-1);
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

  // Seek to a specific time when user clicks a lyric line
  const handleSeek = useCallback((time: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seek = (window as any).__waveformSeek;
    if (typeof seek === 'function') seek(time);
  }, []);

  // RAF loop — only runs when playing
  useEffect(() => {
    if (!isPlaying || lyrics.length === 0) {
      // When paused, do one final sync
      const t = getTime();
      const idx = findLyricIndex(lyrics, t);
      setCurrentIdx(idx);
      lastIdxRef.current = idx;
      return;
    }

    const tick = () => {
      const t = getTime();
      const idx = findLyricIndex(lyrics, t);

      if (idx !== lastIdxRef.current) {
        setCurrentIdx(idx);
        lastIdxRef.current = idx;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, lyrics, getTime]);

  // Sync when user seeks while paused
  const storeTime = usePlayerStore((s) => s.currentTime);
  useEffect(() => {
    if (isPlaying || lyrics.length === 0) return;
    const idx = findLyricIndex(lyrics, storeTime);
    if (idx !== lastIdxRef.current) {
      setCurrentIdx(idx);
      lastIdxRef.current = idx;
    }
  }, [storeTime, isPlaying, lyrics]);

  if (lyrics.length === 0) return null;

  // Derive prev / current / next lines
  const prevIdx = currentIdx > 0 ? currentIdx - 1 : -1;
  const nextIdx = currentIdx + 1 < lyrics.length ? currentIdx + 1 : -1;

  const prevText = prevIdx >= 0 ? lyrics[prevIdx].text : '';
  const currentText = currentIdx >= 0 ? lyrics[currentIdx].text : '';
  const nextText = nextIdx >= 0 ? lyrics[nextIdx].text : '';

  // Display ♪♪♪ for empty lines (interludes)
  const displayText = (text: string) => text || '♪♪♪';

  return (
    <div className={styles.container}>
      {/* Previous line */}
      <div
        className={`${styles.line} ${styles.prev}`}
        onClick={prevIdx >= 0 ? () => handleSeek(lyrics[prevIdx].time) : undefined}
      >
        {prevText ? displayText(prevText) : '\u00A0'}
      </div>

      {/* Current line */}
      <div
        className={`${styles.line} ${styles.current}`}
        onClick={currentIdx >= 0 ? () => handleSeek(lyrics[currentIdx].time) : undefined}
      >
        {currentIdx >= 0 ? displayText(currentText) : '\u00A0'}
      </div>

      {/* Next line */}
      <div
        className={`${styles.line} ${styles.next}`}
        onClick={nextIdx >= 0 ? () => handleSeek(lyrics[nextIdx].time) : undefined}
      >
        {nextText ? displayText(nextText) : '\u00A0'}
      </div>
    </div>
  );
}
