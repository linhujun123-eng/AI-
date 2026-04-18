import { useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import type { ChordEvent } from '../../types/song';
import { usePlayerStore } from '../../stores/player-store';
import { useABLoopStore } from '../../stores/ab-loop-store';
import { usePitchStore } from '../../stores/pitch-store';
import { getAudioContext, resumeAudioContext } from '../../services/audio-context';
import { transposeChord } from '../../utils/transpose';
import styles from './WaveformPanel.module.css';

/** Throttle interval for store updates (ms). 
 *  60ms ≈ 16fps for React renders; RAF still runs at 60fps for scroll. */
const STORE_THROTTLE_MS = 60;

/** Track whether SoundTouchNode processor has been registered globally */
let stProcessorRegistered = false;

/** Promise that resolves once the processor module is registered (shared across instances) */
let stRegisterPromise: Promise<void> | null = null;

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
  /** Mute mix audio output (when stem engine takes over) */
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

  // Web Audio pitch route refs
  const stNodeRef = useRef<SoundTouchNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const pitchRouteReadyRef = useRef(false);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);
  const pitchSemitones = usePitchStore((s) => s.pitchSemitones);

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
      // MediaElement backend (default): the <audio> element drives playback.
      // We route its audio through SoundTouchNode (AudioWorklet) for pitch shifting.
      minPxPerSec: 50,
      autoScroll: true,
      autoCenter: true,
      plugins: [regions],
    });

    ws.load(audioUrl);

    ws.on('ready', () => {
      usePlayerStore.getState().setDuration(ws.getDuration());
      usePlayerStore.getState().setIsLoaded(true);

      // ── Set up Web Audio pitch route ──
      // Route: <audio> → MediaElementSource → SoundTouchNode → GainNode → destination
      // This intercepts the audio to enable real-time pitch shifting via AudioWorklet.
      // Once createMediaElementSource() is called, the <audio> element no longer outputs
      // directly to speakers; all audio flows through the Web Audio graph.
      // However, <audio>.volume and .muted still control the signal level entering
      // MediaElementSource, so WaveSurfer.setVolume() still works for the stem-mute case.
      setupPitchRoute(ws).catch((err) => {
        console.warn('[WaveformPanel] pitch route setup failed, falling back to native audio:', err);
      });
    });

    // High-frequency time sync via requestAnimationFrame
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
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(rafLoop);
    });

    ws.on('pause', () => {
      usePlayerStore.getState().setIsPlaying(false);
      usePlayerStore.getState().setCurrentTime(ws.getCurrentTime());
      cancelAnimationFrame(rafRef.current);
    });

    ws.on('finish', () => {
      usePlayerStore.getState().setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    });

    ws.on('seeking', (t: number) => {
      usePlayerStore.getState().setCurrentTime(t);
    });

    wsRef.current = ws;

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Tear down Web Audio pitch route
      teardownPitchRoute();
      try { ws.destroy(); } catch { /* AbortError in StrictMode double-invoke — harmless */ }
      wsRef.current = null;
      regionsRef.current = null;
      abRegionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // ── Web Audio pitch route setup / teardown ──

  async function setupPitchRoute(ws: WaveSurfer) {
    const ctx = getAudioContext();
    const mediaEl = ws.getMediaElement();

    // Ensure AudioContext is running — addModule may silently fail on suspended ctx
    if (ctx.state === 'suspended') {
      console.log('[WaveformPanel] resuming AudioContext before pitch route setup...');
      await ctx.resume().catch(() => {});
    }

    // Register AudioWorklet processor (once globally, shared promise avoids duplicate addModule)
    if (!stProcessorRegistered) {
      if (!stRegisterPromise) {
        console.log('[WaveformPanel] registering SoundTouchNode processor...');
        stRegisterPromise = SoundTouchNode.register(ctx, '/soundtouch-processor.js')
          .then(() => {
            stProcessorRegistered = true;
            console.log('[WaveformPanel] SoundTouchNode processor registered');
          });
      }
      await stRegisterPromise;
    }

    // Guard: component may have been unmounted while awaiting registration
    if (!wsRef.current) {
      console.log('[WaveformPanel] component unmounted during pitch route setup, aborting');
      return;
    }

    // Create MediaElementSource from WaveSurfer's <audio>
    // NOTE: This can only be called once per <audio> element.
    const mediaSource = ctx.createMediaElementSource(mediaEl);
    mediaSourceRef.current = mediaSource;

    // Disable browser's native pitch preservation — SoundTouchNode handles it
    mediaEl.preservesPitch = false;

    // Create SoundTouchNode (AudioWorklet-based pitch shifter)
    const stNode = new SoundTouchNode(ctx);
    stNodeRef.current = stNode;

    // Create output gain for muting (when stems take over)
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    gainNodeRef.current = gain;

    // Wire: mediaSource → stNode → gain → destination
    mediaSource.connect(stNode);
    stNode.connect(gain);
    gain.connect(ctx.destination);

    // Sync ALL current state — pitch, speed, and mute may have changed during async setup
    const currentPitch = usePitchStore.getState().pitchSemitones;
    const currentSpeed = usePlayerStore.getState().speed;
    stNode.pitchSemitones.value = currentPitch;
    stNode.playbackRate.value = currentSpeed;

    // Sync mute state via GainNode (user may have toggled stems during setup).
    // Also restore <audio>.volume to 1 — the fallback mute path may have set it to 0
    // before createMediaElementSource intercepted the output.
    gain.gain.value = muteAudio ? 0 : 1;
    mediaEl.volume = 1;

    console.log('[WaveformPanel] pitch route established:',
      'pitch:', currentPitch, 'speed:', currentSpeed,
      'muted:', muteAudio, 'ctx:', ctx.state);
    pitchRouteReadyRef.current = true;
  }

  function teardownPitchRoute() {
    try { mediaSourceRef.current?.disconnect(); } catch { /* */ }
    try { stNodeRef.current?.disconnect(); } catch { /* */ }
    try { gainNodeRef.current?.disconnect(); } catch { /* */ }
    mediaSourceRef.current = null;
    stNodeRef.current = null;
    gainNodeRef.current = null;
    pitchRouteReadyRef.current = false;
  }

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

  // Sync speed → WaveSurfer playbackRate + SoundTouchNode
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // preservesPitch=false since SoundTouchNode handles pitch correction
    ws.setPlaybackRate(speed, false);

    // Tell SoundTouchNode the source playback rate so it auto-compensates pitch
    if (stNodeRef.current) {
      stNodeRef.current.playbackRate.value = speed;
      console.log('[WaveformPanel] speed synced to SoundTouchNode:', speed);
    } else {
      console.log('[WaveformPanel] speed set on <audio>:', speed, '(SoundTouchNode not yet ready, will sync on setup)');
    }
  }, [speed]);

  // Sync pitch semitones → SoundTouchNode
  useEffect(() => {
    if (stNodeRef.current) {
      stNodeRef.current.pitchSemitones.value = pitchSemitones;
      console.log('[WaveformPanel] pitchSemitones synced:', pitchSemitones);
    } else {
      console.log('[WaveformPanel] pitchSemitones queued:', pitchSemitones, '(SoundTouchNode not yet ready, will sync on setup)');
    }
  }, [pitchSemitones]);

  // Mute mix audio when stem engine takes over
  // When pitch route is active: use GainNode (keeps <audio>.volume = 1)
  // When pitch route not yet ready: fall back to WaveSurfer volume (which sets <audio>.volume)
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muteAudio ? 0 : 1;
      // Ensure <audio>.volume stays at 1 — GainNode handles muting
      const ws = wsRef.current;
      if (ws) {
        const mediaEl = ws.getMediaElement();
        if (mediaEl && mediaEl.volume !== 1) mediaEl.volume = 1;
      }
      console.log('[WaveformPanel] gain mute:', muteAudio);
    } else {
      // Fallback: pitch route not yet set up, use WaveSurfer volume
      const ws = wsRef.current;
      if (ws) ws.setVolume(muteAudio ? 0 : 1);
      console.log('[WaveformPanel] fallback volume mute:', muteAudio);
    }
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

    const renderMarkers = () => {
      const duration = ws.getDuration();
      if (!duration) return;

      // Clear old markers
      chordMarkersRef.current.forEach((m) => m.remove());
      chordMarkersRef.current = [];

      const filtered: ChordEvent[] = [];
      let lastChord = '';
      for (const chord of chords) {
        if (chord.time <= 0 || chord.time >= duration) continue;
        if (chord.chord === lastChord) continue;
        filtered.push(chord);
        lastChord = chord.chord;
      }

      filtered.forEach((chord, i) => {
        const displayChord = transposeChord(chord.chord, pitchSemitones);

        const marker = regions.addRegion({
          start: chord.time,
          end: chord.time + 0.05,
          color: getChordColor(chord.chord).replace(')', ', 0.35)').replace('rgb', 'rgba'),
          drag: false,
          resize: false,
          content: createChordLabel(displayChord, getChordColor(chord.chord), i),
        });
        chordMarkersRef.current.push(marker);
      });
    };

    if (ws.getDuration()) {
      renderMarkers();
    }
    ws.on('ready', renderMarkers);

    return () => {
      chordMarkersRef.current.forEach((m) => m.remove());
      chordMarkersRef.current = [];
    };
  }, [chords, pitchSemitones]);

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

  // Attach to window for keyboard shortcut access
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformSeek = seek;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__waveformToggle = togglePlay;
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
      <div ref={containerRef} className={styles.waveform} onClick={resumeAudioContext} />
    </div>
  );
}
