import { usePlayerStore } from '../../stores/player-store';
import { useABLoopStore } from '../../stores/ab-loop-store';
import { formatTime } from '../../utils/format-time';
import styles from './PlaybackControls.module.css';

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5];

export function PlaybackControls() {
  const { isPlaying, currentTime, duration, speed, isLoaded, setSpeed } =
    usePlayerStore();
  const { a, b, isActive, loopCount, setA, setB, clear } = useABLoopStore();

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

  const handleSetA = () => {
    setA(currentTime);
  };

  const handleSetB = () => {
    setB(currentTime);
  };

  const handleClearAB = () => {
    clear();
  };

  return (
    <div className={styles.controls}>
      {/* Time display */}
      <div className={styles.timeRow}>
        <span className={styles.time}>{formatTime(currentTime)}</span>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressBar}
            style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>

      {/* Play row */}
      <div className={styles.playRow}>
        <button
          className={styles.seekBtn}
          onClick={handleSeekBack}
          disabled={!isLoaded}
          title="后退 5 秒 (←)"
        >
          ⏪
        </button>
        <button
          className={`${styles.playBtn} ${isPlaying ? styles.playing : ''}`}
          onClick={handleTogglePlay}
          disabled={!isLoaded}
          title="播放/暂停 (Space)"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className={styles.seekBtn}
          onClick={handleSeekForward}
          disabled={!isLoaded}
          title="前进 5 秒 (→)"
        >
          ⏩
        </button>
      </div>

      {/* AB Loop row */}
      <div className={styles.abRow}>
        <button
          className={`${styles.abBtn} ${a !== null ? styles.abSet : ''}`}
          onClick={handleSetA}
          disabled={!isLoaded}
          title="设置 A 点 (A)"
        >
          A{a !== null ? ` ${formatTime(a)}` : ''}
        </button>
        <button
          className={`${styles.abBtn} ${b !== null ? styles.abSet : ''}`}
          onClick={handleSetB}
          disabled={!isLoaded}
          title="设置 B 点 (B)"
        >
          B{b !== null ? ` ${formatTime(b)}` : ''}
        </button>
        {isActive && (
          <>
            <span className={styles.loopBadge}>
              🔁 ×{loopCount}
            </span>
            <button className={styles.clearBtn} onClick={handleClearAB} title="清除 AB 循环 (Esc)">
              ✕ 清除
            </button>
          </>
        )}
      </div>

      {/* Speed row */}
      <div className={styles.speedRow}>
        <span className={styles.speedLabel}>速度</span>
        <div className={styles.speedPresets}>
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className={styles.speedFine}>
          <button
            className={styles.speedStep}
            onClick={() => setSpeed(speed - 0.05)}
            title="减速 5% ([)"
          >
            −
          </button>
          <span className={styles.speedValue}>{speed.toFixed(2)}×</span>
          <button
            className={styles.speedStep}
            onClick={() => setSpeed(speed + 0.05)}
            title="加速 5% (])"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
