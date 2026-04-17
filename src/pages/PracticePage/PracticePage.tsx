import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import type { ChordEvent } from '../../types/song';
import { useSongStore } from '../../stores/song-store';
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
import { fetchChords } from '../../services/api';
import styles from './PracticePage.module.css';

export function PracticePage() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.getSongById(songId ?? ''));
  const resolveAudioUrl = useSongStore((s) => s.resolveAudioUrl);
  const reset = usePlayerStore((s) => s.reset);
  const clearAB = useABLoopStore((s) => s.clear);

  // Resolved audio URL (static path or backend streaming URL)
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!song) return;
    const url = resolveAudioUrl(song);
    setAudioUrl(url);
    // No cleanup needed — backend URLs don't need revoking
  }, [song, resolveAudioUrl]);

  // Load chords data (shared between ChordDisplay and WaveformPanel)
  const [chords, setChords] = useState<ChordEvent[]>([]);
  const chordStatus = useSongStore((s) => songId ? s.chordStatus[songId] : undefined);
  const chordError = useSongStore((s) => songId ? s.chordError[songId] : null);
  const triggerChordRecognition = useSongStore((s) => s.triggerChordRecognition);
  const chordApiAvailable = useSongStore((s) => s.chordApiAvailable);

  // Load/reload chords when songId changes or when recognition completes
  useEffect(() => {
    if (!songId) return;
    if (song?.source === 'user') {
      // User songs: fetch chords from backend API
      fetchChords(songId)
        .then((data) => setChords(data ?? []))
        .catch(() => setChords([]));
    } else {
      // Preset songs: fetch from static file
      fetch(`/audio/${songId}/chords.json`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: ChordEvent[]) => setChords(data))
        .catch(() => setChords([]));
    }
  }, [songId, song?.source, chordStatus]); // re-run when chordStatus changes (e.g. processing → done)

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

  if (!song || !audioUrl) {
    return (
      <div className={styles.page}>
        <div className={styles.notFound}>
          {!song ? (
            <>
              <p>🎸 歌曲未找到</p>
              <button className={styles.backBtn} onClick={() => navigate('/')}>
                返回首页
              </button>
            </>
          ) : (
            <p>⏳ 加载音频中...</p>
          )}
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
        {/* Chord recognition status for user songs */}
        {song.source === 'user' && chords.length === 0 && (
          <div className={styles.chordStatusBar}>
            {(chordStatus === 'uploading' || chordStatus === 'processing') && (
              <span className={styles.chordStatusProcessing}>
                <span className={styles.statusSpinner} />
                和弦识别中，请稍候…
              </span>
            )}
            {chordStatus === 'error' && (
              <span className={styles.chordStatusError}>
                和弦识别失败{chordError ? `：${chordError}` : ''}
                {chordApiAvailable && (
                  <button
                    className={styles.retryBtn}
                    onClick={() => triggerChordRecognition(songId!)}
                  >
                    重试
                  </button>
                )}
              </span>
            )}
            {(chordStatus === 'idle' || !chordStatus) && chordApiAvailable && (
              <span className={styles.chordStatusIdle}>
                暂无和弦数据
                <button
                  className={styles.retryBtn}
                  onClick={() => triggerChordRecognition(songId!)}
                >
                  识别和弦
                </button>
              </span>
            )}
            {(chordStatus === 'idle' || !chordStatus) && !chordApiAvailable && (
              <span className={styles.chordStatusIdle}>
                暂无和弦数据（和弦识别服务未启动）
              </span>
            )}
          </div>
        )}
      </div>

      {/* Waveform — mute WaveSurfer audio when stems are active */}
      <div className={styles.section}>
        <WaveformPanel
          audioUrl={audioUrl}
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
