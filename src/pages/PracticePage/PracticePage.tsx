import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import type { ChordEvent } from '../../types/song';
import { songs } from '../../data/songs';
import { usePlayerStore } from '../../stores/player-store';
import { useABLoopStore } from '../../stores/ab-loop-store';
import { useStemStore } from '../../stores/stem-store';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useStemEngine } from '../../hooks/useStemEngine';
import { TopBar } from '../../components/TopBar/TopBar';
import { WaveformPanel } from '../../components/Waveform/WaveformPanel';
import { ChordDisplay } from '../../components/ChordDisplay/ChordDisplay';
import { PlaybackControls } from '../../components/PlaybackControls/PlaybackControls';
import { BottomBar } from '../../components/BottomBar/BottomBar';
import { TrackMixer } from '../../components/TrackMixer/TrackMixer';
import { ShortcutHint } from '../../components/PlaybackControls/ShortcutHint';
import styles from './PracticePage.module.css';

export function PracticePage() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const song = songs.find((s) => s.id === songId);
  const reset = usePlayerStore((s) => s.reset);
  const clearAB = useABLoopStore((s) => s.clear);

  // Load chords data (shared between ChordDisplay and WaveformPanel)
  const [chords, setChords] = useState<ChordEvent[]>([]);
  useEffect(() => {
    if (!songId) return;
    fetch(`/audio/${songId}/chords.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ChordEvent[]) => setChords(data))
      .catch(() => setChords([]));
  }, [songId]);

  // Reset state on mount / song change
  useEffect(() => {
    reset();
    clearAB();
    useStemStore.getState().setIsActive(false);
    useStemStore.getState().setIsLoaded(false);
    return () => {
      reset();
      clearAB();
      useStemStore.getState().setIsActive(false);
      useStemStore.getState().setIsLoaded(false);
    };
  }, [songId, reset, clearAB]);

  // Keyboard shortcuts
  useKeyboardShortcuts();

  // Stem engine
  const { loadStems } = useStemEngine(songId ?? '');
  const stemIsActive = useStemStore((s) => s.isActive);

  // When user activates stems, load the files
  const handleStemActivate = useCallback(() => {
    loadStems();
  }, [loadStems]);

  if (!song) {
    return (
      <div className={styles.page}>
        <div className={styles.notFound}>
          <p>🎸 歌曲未找到</p>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <TopBar song={song} />

      {/* Chord Display */}
      <div className={styles.section}>
        <ChordDisplay chords={chords} />
      </div>

      {/* Waveform — mute WaveSurfer audio when stems are active */}
      <div className={styles.section}>
        <WaveformPanel
          audioUrl={song.audio.mix}
          chords={chords}
          muteAudio={stemIsActive}
        />
      </div>

      {/* Track Mixer */}
      <div className={styles.section}>
        <TrackMixer onActivate={handleStemActivate} />
      </div>

      {/* Playback Controls */}
      <div className={styles.section}>
        <PlaybackControls />
      </div>

      {/* Shortcut Hint */}
      <div className={styles.section}>
        <ShortcutHint />
      </div>

      {/* Mobile Bottom Bar — fixed at bottom, replaces PlaybackControls on mobile */}
      <BottomBar />
    </div>
  );
}
