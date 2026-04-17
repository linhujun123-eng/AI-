import { useEffect, useRef, useCallback } from 'react';
import { STEM_TRACKS, STEM_KEYS } from '../types/stems';
import type { StemKey } from '../types/stems';
import { useStemStore } from '../stores/stem-store';
import { usePlayerStore } from '../stores/player-store';

interface StemNode {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

/**
 * Hook that manages Web Audio API multi-track stem playback.
 * When stems are active, the mix audio from WaveSurfer is muted
 * and playback is driven by decoded stem AudioBuffers + GainNodes.
 *
 * WaveSurfer remains the time-source (seek, play/pause sync).
 */
export function useStemEngine(songId: string) {
  const ctxRef = useRef<AudioContext | null>(null);
  const stemsRef = useRef<Map<StemKey, StemNode>>(new Map());
  const startedAtRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  const isActive = useStemStore((s) => s.isActive);
  const isLoaded = useStemStore((s) => s.isLoaded);

  // Create AudioContext on first need
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  // Load all stem files
  const loadStems = useCallback(async () => {
    const ctx = getCtx();
    const store = useStemStore.getState();
    store.setLoadingProgress(0);
    store.setIsLoaded(false);

    const total = STEM_TRACKS.length;
    let loaded = 0;

    const entries: [StemKey, StemNode][] = [];

    for (const track of STEM_TRACKS) {
      try {
        const url = `/audio/${songId}/${track.filename}`;
        const response = await fetch(url);
        if (!response.ok) {
          // If stem file doesn't exist, create a silent buffer
          const silentBuffer = ctx.createBuffer(2, ctx.sampleRate * 1, ctx.sampleRate);
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          entries.push([track.key, { buffer: silentBuffer, source: null, gain }]);
        } else {
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          entries.push([track.key, { buffer: audioBuffer, source: null, gain }]);
        }
      } catch {
        // Fallback: silent buffer
        const silentBuffer = ctx.createBuffer(2, ctx.sampleRate * 1, ctx.sampleRate);
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        entries.push([track.key, { buffer: silentBuffer, source: null, gain }]);
      }
      loaded++;
      useStemStore.getState().setLoadingProgress(loaded / total);
    }

    stemsRef.current = new Map(entries);
    useStemStore.getState().setIsLoaded(true);
    useStemStore.getState().setLoadingProgress(1);
  }, [songId, getCtx]);

  // Start all stem sources from a given offset
  const startPlayback = useCallback(
    (offset: number) => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      // Stop existing sources
      stemsRef.current.forEach((node) => {
        if (node.source) {
          try { node.source.stop(); } catch { /* ignore */ }
          node.source.disconnect();
          node.source = null;
        }
      });

      stemsRef.current.forEach((node) => {
        const source = ctx.createBufferSource();
        source.buffer = node.buffer;
        source.connect(node.gain);
        source.start(0, offset);
        node.source = source;
      });

      offsetRef.current = offset;
      startedAtRef.current = ctx.currentTime;
      isPlayingRef.current = true;
    },
    []
  );

  // Stop all stem sources
  const stopPlayback = useCallback(() => {
    stemsRef.current.forEach((node) => {
      if (node.source) {
        try { node.source.stop(); } catch { /* ignore */ }
        node.source.disconnect();
        node.source = null;
      }
    });
    isPlayingRef.current = false;
  }, []);

  // Sync play/pause/seek from player store
  useEffect(() => {
    if (!isActive || !isLoaded) return;

    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      // Play state changed
      if (state.isPlaying !== prevState.isPlaying) {
        if (state.isPlaying) {
          startPlayback(state.currentTime);
        } else {
          stopPlayback();
        }
      }

      // Seek: detect large time jumps (>0.5s difference from expected position)
      if (state.isPlaying && isPlayingRef.current && ctxRef.current) {
        const expected =
          offsetRef.current + (ctxRef.current.currentTime - startedAtRef.current);
        const drift = Math.abs(state.currentTime - expected);
        if (drift > 0.5) {
          // Re-sync: restart from new position
          startPlayback(state.currentTime);
        }
      }
    });

    // If already playing when stems become active, start
    if (usePlayerStore.getState().isPlaying) {
      startPlayback(usePlayerStore.getState().currentTime);
    }

    return () => {
      unsubscribe();
      stopPlayback();
    };
  }, [isActive, isLoaded, startPlayback, stopPlayback]);

  // Sync playback speed
  useEffect(() => {
    if (!isActive || !isLoaded) return;

    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      if (state.speed !== prevState.speed) {
        stemsRef.current.forEach((node) => {
          if (node.source) {
            node.source.playbackRate.value = state.speed;
          }
        });
      }
    });

    // Apply current speed
    const speed = usePlayerStore.getState().speed;
    stemsRef.current.forEach((node) => {
      if (node.source) {
        node.source.playbackRate.value = speed;
      }
    });

    return unsubscribe;
  }, [isActive, isLoaded]);

  // Sync volumes from stem store → GainNodes (real-time)
  useEffect(() => {
    if (!isActive || !isLoaded) return;

    const unsubscribe = useStemStore.subscribe((state) => {
      STEM_KEYS.forEach((key) => {
        const node = stemsRef.current.get(key);
        if (node) {
          const vol = state.getEffectiveVolume(key);
          // Smooth ramp to avoid clicks
          node.gain.gain.linearRampToValueAtTime(
            vol,
            (ctxRef.current?.currentTime ?? 0) + 0.05
          );
        }
      });
    });

    // Apply current volumes immediately
    const state = useStemStore.getState();
    STEM_KEYS.forEach((key) => {
      const node = stemsRef.current.get(key);
      if (node) {
        node.gain.gain.value = state.getEffectiveVolume(key);
      }
    });

    return unsubscribe;
  }, [isActive, isLoaded]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
      }
    };
  }, [stopPlayback]);

  return { loadStems, isLoaded };
}
