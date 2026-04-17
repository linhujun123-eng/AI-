import { useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import type { ChordEvent } from '../../types/song';
import { usePlayerStore } from '../../stores/player-store';
import { useABLoopStore } from '../../stores/ab-loop-store';
import styles from './WaveformPanel.module.css';

/** Throttle interval for store updates (ms). 
 *  60ms ≈ 16fps for React renders; RAF still runs at 60fps for scroll. */
const STORE_THROTTLE_MS = 60;

/** Chord → Neon color mapping for markers (covers E-major key + common chords) */
const CHORD_COLORS: Record<string, string> = {
  // Natural notes
  A: '#00e5ff',
  Am: '#00bcd4',
  B: '#a855f7',
  Bm: '#7c3aed',
  C: '#ff2d95',
  Cm: '#e91e63',
  'C#': '#ff6b9d',
  'C#m': '#e91e8c',
  D: '#ffab00',
  Dm: '#ff8f00',
  E: '#00e676',
  Em: '#00c853',
  F: '#ff6d00',
  Fm: '#e65100',
  'F#': '#ff9100',
  'F#m': '#ef6c00',
  G: '#76ff03',
  Gm: '#64dd17',
  'G#': '#b2ff59',
  'G#m': '#9ccc65',
  Bb: '#ce93d8',
  Bbm: '#ab47bc',
  Eb: '#f48fb1',
  Ebm: '#ec407a',
  Ab: '#80cbc4',
};

function getChordColor(chord: string): string {
  if (CHORD_COLORS[chord]) return CHORD_COLORS[chord];
  // Try without trailing 'm'
  const root = chord.replace(/m$/, '');
  if (CHORD_COLORS[root]) return CHORD_COLORS[root];
  // Try root note only (strip #/b suffix modifiers beyond the note)
  return '#00e5ff';
}

/** Create a tiny DOM label for a chord marker overlay */
function createChordLabel(chord: string, color: string, _index: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chord-marker-label';
  el.textContent = chord;
  el.style.cssText = `
    position: absolute;
    top: -2px;
    left: 50%;
    transform: translateX(-50%);
    font-family: var(--mono, 'JetBrains Mono', monospace);
    font-size: 9px;
    font-weight: 700;
    color: ${color};
    text-shadow: 0 0 6px ${color}44, 0 1px 2px rgba(0,0,0,0.8);
    white-space: nowrap;
    pointer-events: none;
    letter-spacing: 0.3px;
    z-index: 5;
    line-height: 1;
    padding: 1px 2px;
  `;
  return el;
}

interface WaveformPanelProps {
  audioUrl: string;
  chords?: ChordEvent[];
  /** Mute WaveSurfer audio output (when stem engine takes over) */
  muteAudio?: boolean;
}

export function WaveformPanel({ audioUrl, chords = [], muteAudio = false }: WaveformPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abRegionRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const lastStoreUpdateRef = useRef<number>(0);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);

  const { a, b, isActive, incrementLoop } = useABLoopStore();

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    // Responsive waveform height: smaller on mobile
    const isMobile = window.innerWidth <= 480;
    const waveHeight = isMobile ? 72 : 100;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(0, 229, 255, 0.35)',
      progressColor: 'rgba(168, 85, 247, 0.7)',
      cursorColor: '#ff2d95',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: waveHeight,
      normalize: true,
      // MediaElement backend (default): enables browser-native
      // preservesPitchForPlaybackRate for tempo change without pitch shift.
      // WebAudio backend does NOT support preservePitch.
      minPxPerSec: 50,
      autoScroll: true,
      autoCenter: true,
      plugins: [regions],
    });

    ws.load(audioUrl);

    ws.on('ready', () => {
      usePlayerStore.getState().setDuration(ws.getDuration());
      usePlayerStore.getState().setIsLoaded(true);
    });

    // High-frequency time sync via requestAnimationFrame
    // Store updates are throttled to ~60ms to reduce React re-renders
    // but WaveSurfer's own autoScroll runs at native RAF speed.
    const rafLoop = () => {
      try {
        const t = ws.getCurrentTime();
        const now = performance.now();
        if (now - lastStoreUpdateRef.current >= STORE_THROTTLE_MS) {
          usePlayerStore.getState().setCurrentTime(t);
          lastStoreUpdateRef.current = now;
        }
      } catch {
        // WaveSurfer may be destroyed; stop RAF loop
        return;
      }
      rafRef.current = requestAnimationFrame(rafLoop);
    };

    ws.on('play', () => {
      usePlayerStore.getState().setIsPlaying(true);
      // Start RAF loop when playing
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(rafLoop);
    });

    ws.on('pause', () => {
      usePlayerStore.getState().setIsPlaying(false);
      // Final sync on pause
      usePlayerStore.getState().setCurrentTime(ws.getCurrentTime());
      cancelAnimationFrame(rafRef.current);
    });

    ws.on('finish', () => {
      usePlayerStore.getState().setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    });

    // Also sync on seek (click waveform)
    ws.on('seeking', (t: number) => {
      usePlayerStore.getState().setCurrentTime(t);
    });

    wsRef.current = ws;

    return () => {
      cancelAnimationFrame(rafRef.current);
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      abRegionRef.current = null;
    };
    // audioUrl is the only true dep; store setters are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Sync play/pause from store → wavesurfer
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (isPlaying && !ws.isPlaying()) {
      ws.play();
    } else if (!isPlaying && ws.isPlaying()) {
      ws.pause();
    }
  }, [isPlaying]);

  // Sync speed
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setPlaybackRate(speed, true);
  }, [speed]);

  // Mute WaveSurfer audio when stem engine is active
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setVolume(muteAudio ? 0 : 1);
  }, [muteAudio]);

  // AB loop region rendering
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;

    // Remove old region
    if (abRegionRef.current) {
      abRegionRef.current.remove();
      abRegionRef.current = null;
    }

    if (isActive && a !== null && b !== null) {
      abRegionRef.current = regions.addRegion({
        start: a,
        end: b,
        color: 'rgba(0, 229, 255, 0.12)',
        drag: false,
        resize: false,
      });
    }
  }, [a, b, isActive]);

  // Chord markers on waveform
  const chordMarkersRef = useRef<Array<{ remove: () => void }>>([]);

  useEffect(() => {
    const regions = regionsRef.current;
    const ws = wsRef.current;
    if (!regions || !ws || chords.length === 0) return;

    // Wait until waveform is ready (has duration)
    const renderMarkers = () => {
      const duration = ws.getDuration();
      if (!duration) return;

      // Clear old markers
      chordMarkersRef.current.forEach((m) => m.remove());
      chordMarkersRef.current = [];

      // Filter: skip markers outside valid range; deduplicate consecutive same chords
      // NOTE: v3 chords.json already has min-duration filtering, so we don't re-filter here
      const filtered: ChordEvent[] = [];
      let lastChord = '';
      for (const chord of chords) {
        if (chord.time <= 0 || chord.time >= duration) continue;
        // Skip if same chord as previous
        if (chord.chord === lastChord) continue;
        filtered.push(chord);
        lastChord = chord.chord;
      }

      filtered.forEach((chord, i) => {

        // Thin region as a marker line
        const marker = regions.addRegion({
          start: chord.time,
          end: chord.time + 0.05, // near-zero width = vertical line
          color: getChordColor(chord.chord).replace(')', ', 0.35)').replace('rgb', 'rgba'),
          drag: false,
          resize: false,
          content: createChordLabel(chord.chord, getChordColor(chord.chord), i),
        });
        chordMarkersRef.current.push(marker);
      });
    };

    // If already loaded, render now; otherwise wait for ready
    if (ws.getDuration()) {
      renderMarkers();
    }
    ws.on('ready', renderMarkers);

    return () => {
      chordMarkersRef.current.forEach((m) => m.remove());
      chordMarkersRef.current = [];
    };
  }, [chords]);

  // AB loop logic: jump back to A when hitting B
  useEffect(() => {
    if (!isActive || a === null || b === null) return;

    const unsubscribe = usePlayerStore.subscribe((state) => {
      if (state.currentTime >= b && state.isPlaying) {
        wsRef.current?.setTime(a);
        incrementLoop();
      }
    });

    return unsubscribe;
  }, [isActive, a, b, incrementLoop]);

  // Expose seek for external use
  const seek = useCallback((time: number) => {
    wsRef.current?.setTime(time);
  }, []);

  // Expose toggle play
  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  // Attach to window for keyboard shortcut access (simple approach)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformSeek = seek;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformToggle = togglePlay;
    // Expose getCurrentTime for high-frequency readers (e.g. ChordDisplay)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformGetCurrentTime = () => wsRef.current?.getCurrentTime() ?? 0;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__waveformSeek;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__waveformToggle;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__waveformGetCurrentTime;
    };
  }, [seek, togglePlay]);

  return (
    <div className={styles.panel}>
      <div ref={containerRef} className={styles.waveform} />
    </div>
  );
}
