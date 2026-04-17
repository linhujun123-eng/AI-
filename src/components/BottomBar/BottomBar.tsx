import { useState, useRef, useEffect } from 'react';
import { usePlayerStore } from '../../stores/player-store';
import { useABLoopStore } from '../../stores/ab-loop-store';
import { formatTime } from '../../utils/format-time';
import styles from './BottomBar.module.css';

const SPEED_PRESETS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.25, 1.5];

export function BottomBar() {
  const { isPlaying, currentTime, duration, speed, isLoaded, setSpeed } =
    usePlayerStore();
  const { a, b, isActive, loopCount, setA, setB, clear } = useABLoopStore();

  const [showSpeed, setShowSpeed] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  // Close speed popover on outside tap
  useEffect(() => {
    if (!showSpeed) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setShowSpeed(false);
      }
    };
    document.addEventListener('touchstart', handler, { passive: true });
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('mousedown', handler);
    };
  }, [showSpeed]);

  const handleTogglePlay = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformToggle?.();
  };

  const handleSeekBack = () => {
    const newTime = Math.max(0, currentTime - 5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformSeek?.(newTime);
  };

  const handleSeekForward = () => {
    const newTime = Math.min(duration, currentTime + 5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformSeek?.(newTime);
  };

  const handleSetA = () => setA(currentTime);
  const handleSetB = () => setB(currentTime);
  const handleClearAB = () => clear();

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.wrapper}>
      {/* Progress bar — thin line at top of bottom bar */}
      <div className={styles.progressTrack}>
        <div
          className={styles.progressBar}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Time */}
      <div className={styles.timeRow}>
        <span className={styles.time}>{formatTime(currentTime)}</span>
        <span className={styles.timeSep}>/</span>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>

      {/* Main controls row */}
      <div className={styles.controlsRow}>
        {/* AB Loop */}
        <div className={styles.abGroup}>
          <button
            className={`${styles.abBtn} ${a !== null ? styles.abActive : ''}`}
            onClick={handleSetA}
            disabled={!isLoaded}
          >
            A
          </button>
          <button
            className={`${styles.abBtn} ${b !== null ? styles.abActive : ''}`}
            onClick={handleSetB}
            disabled={!isLoaded}
          >
            B
          </button>
          {isActive && (
            <button className={styles.loopBadge} onClick={handleClearAB}>
              ×{loopCount}
            </button>
          )}
        </div>

        {/* Transport: seek back / play / seek forward */}
        <div className={styles.transport}>
          <button
            className={styles.seekBtn}
            onClick={handleSeekBack}
            disabled={!isLoaded}
          >
            ⏪
          </button>
          <button
            className={`${styles.playBtn} ${isPlaying ? styles.playing : ''}`}
            onClick={handleTogglePlay}
            disabled={!isLoaded}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className={styles.seekBtn}
            onClick={handleSeekForward}
            disabled={!isLoaded}
          >
            ⏩
          </button>
        </div>

        {/* Speed */}
        <div className={styles.speedGroup} ref={speedRef}>
          <button
            className={styles.speedBtn}
            onClick={() => setShowSpeed(!showSpeed)}
          >
            {speed === 1 ? '1×' : `${speed.toFixed(2).replace(/0$/, '')}×`}
          </button>

          {/* Speed popover */}
          {showSpeed && (
            <div className={styles.speedPopover}>
              <div className={styles.speedGrid}>
                {SPEED_PRESETS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.speedPresetBtn} ${speed === s ? styles.speedPresetActive : ''}`}
                    onClick={() => {
                      setSpeed(s);
                      setShowSpeed(false);
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <div className={styles.speedFine}>
                <button
                  className={styles.speedStepBtn}
                  onClick={() => setSpeed(speed - 0.05)}
                >
                  −
                </button>
                <span className={styles.speedValue}>{speed.toFixed(2)}×</span>
                <button
                  className={styles.speedStepBtn}
                  onClick={() => setSpeed(speed + 0.05)}
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
