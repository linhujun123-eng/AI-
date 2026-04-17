import { useCallback } from 'react';
import { STEM_TRACKS, VOLUME_MAX } from '../../types/stems';
import type { StemKey } from '../../types/stems';
import { useStemStore } from '../../stores/stem-store';
import styles from './TrackMixer.module.css';

interface TrackMixerProps {
  onActivate: () => void;
}

export function TrackMixer({ onActivate }: TrackMixerProps) {
  const isActive = useStemStore((s) => s.isActive);
  const isLoaded = useStemStore((s) => s.isLoaded);
  const loadingProgress = useStemStore((s) => s.loadingProgress);
  const volumes = useStemStore((s) => s.volumes);
  const muted = useStemStore((s) => s.muted);
  const solo = useStemStore((s) => s.solo);
  const setVolume = useStemStore((s) => s.setVolume);
  const toggleMute = useStemStore((s) => s.toggleMute);
  const toggleSolo = useStemStore((s) => s.toggleSolo);
  const resetVolumes = useStemStore((s) => s.resetVolumes);
  const setIsActive = useStemStore((s) => s.setIsActive);

  const handleActivate = useCallback(() => {
    setIsActive(true);
    onActivate();
  }, [onActivate, setIsActive]);

  const handleDeactivate = useCallback(() => {
    setIsActive(false);
  }, [setIsActive]);

  // Not activated yet — show toggle button
  if (!isActive) {
    return (
      <div className={styles.container}>
        <button className={styles.activateBtn} onClick={handleActivate}>
          <span className={styles.activateIcon}>🎛️</span>
          <span>分轨混音</span>
        </button>
      </div>
    );
  }

  // Loading state
  if (!isLoaded) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.title}>🎛️ 分轨混音</span>
          <span className={styles.loading}>
            加载中 {Math.round(loadingProgress * 100)}%
          </span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${loadingProgress * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>🎛️ 分轨混音</span>
        <div className={styles.headerActions}>
          <button className={styles.resetBtn} onClick={resetVolumes}>
            重置
          </button>
          <button className={styles.closeBtn} onClick={handleDeactivate}>
            ✕
          </button>
        </div>
      </div>

      <div className={styles.tracks}>
        {STEM_TRACKS.map((track) => {
          const vol = volumes[track.key];
          const isMuted = muted[track.key];
          const isSoloed = solo === track.key;
          const isEffectivelyMuted =
            isMuted || (solo !== null && !isSoloed);
          const pct = Math.round(vol * 100);

          return (
            <TrackRow
              key={track.key}
              stemKey={track.key}
              label={track.label}
              icon={track.icon}
              color={track.color}
              volume={vol}
              pct={pct}
              isMuted={isMuted}
              isSoloed={isSoloed}
              isEffectivelyMuted={isEffectivelyMuted}
              onVolumeChange={setVolume}
              onToggleMute={toggleMute}
              onToggleSolo={toggleSolo}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Individual track row — extracted for perf (memo-friendly) */
interface TrackRowProps {
  stemKey: StemKey;
  label: string;
  icon: string;
  color: string;
  volume: number;
  pct: number;
  isMuted: boolean;
  isSoloed: boolean;
  isEffectivelyMuted: boolean;
  onVolumeChange: (key: StemKey, val: number) => void;
  onToggleMute: (key: StemKey) => void;
  onToggleSolo: (key: StemKey) => void;
}

function TrackRow({
  stemKey,
  label,
  icon,
  color,
  volume,
  pct,
  isMuted,
  isSoloed,
  isEffectivelyMuted,
  onVolumeChange,
  onToggleMute,
  onToggleSolo,
}: TrackRowProps) {
  return (
    <div
      className={`${styles.trackRow} ${isEffectivelyMuted ? styles.trackMuted : ''}`}
    >
      <div className={styles.trackInfo}>
        <span className={styles.trackIcon}>{icon}</span>
        <span className={styles.trackLabel}>{label}</span>
      </div>

      <div className={styles.trackControls}>
        <button
          className={`${styles.muteBtn} ${isMuted ? styles.muteBtnActive : ''}`}
          onClick={() => onToggleMute(stemKey)}
          title="静音"
        >
          M
        </button>
        <button
          className={`${styles.soloBtn} ${isSoloed ? styles.soloBtnActive : ''}`}
          onClick={() => onToggleSolo(stemKey)}
          title="独奏"
        >
          S
        </button>
      </div>

      <div className={styles.sliderWrap}>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={VOLUME_MAX * 100}
          step={1}
          value={volume * 100}
          onChange={(e) =>
            onVolumeChange(stemKey, Number(e.target.value) / 100)
          }
          style={
            {
              '--track-color': color,
              '--fill-pct': `${(volume / VOLUME_MAX) * 100}%`,
            } as React.CSSProperties
          }
        />
      </div>

      <span
        className={styles.trackVolume}
        style={{ color: isEffectivelyMuted ? 'var(--text3, #444)' : color }}
      >
        {pct}%
      </span>
    </div>
  );
}
