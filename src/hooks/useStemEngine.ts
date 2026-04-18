import { useEffect, useRef, useCallback } from 'react';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import { STEM_TRACKS, STEM_KEYS } from '../types/stems';
import type { StemKey } from '../types/stems';
import { useStemStore } from '../stores/stem-store';
import { usePlayerStore } from '../stores/player-store';
import { usePitchStore } from '../stores/pitch-store';
import { fetchStemAudio } from '../services/api';
import { getAudioContext } from '../services/audio-context';

/**
 * A stem playback node — holds the decoded buffer, a GainNode for volume,
 * and an AudioBufferSourceNode for playback.
 */
interface StemNode {
  buffer: AudioBuffer;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

/** Track whether SoundTouchNode processor has been registered globally */
let stProcessorRegistered = false;
let stRegisterPromise: Promise<void> | null = null;

/**
 * Multi-track stem playback engine using native AudioBufferSourceNode.
 *
 * Audio graph per track:
 *   AudioBufferSourceNode → GainNode (per-track volume) ─┐
 *                                                         ├→ SoundTouchNode → destination
 *   (all tracks merge into one shared SoundTouchNode)     ┘
 *
 * Pitch shifting: SoundTouchNode.pitchSemitones (real time-stretching, independent of speed)
 * Speed: AudioBufferSourceNode.playbackRate (native resampling, SoundTouchNode compensates pitch)
 *
 * WaveSurfer remains the time-source (seek, play/pause sync).
 */
export function useStemEngine(songId: string, songSource: 'preset' | 'user' = 'preset') {
  const stemsRef = useRef<Map<StemKey, StemNode>>(new Map());
  const isPlayingRef = useRef(false);
  const lastCurrentTimeRef = useRef(0);

  // Shared SoundTouchNode for pitch shifting all stems together
  const stNodeRef = useRef<SoundTouchNode | null>(null);
  const stReadyRef = useRef(false);

  const isActive = useStemStore((s) => s.isActive);
  const isLoaded = useStemStore((s) => s.isLoaded);

  // ── helpers ──────────────────────────────────────────────────────────

  const destroyNode = useCallback((node: StemNode) => {
    if (node.source) {
      try { node.source.stop(); } catch { /* already stopped */ }
      try { node.source.disconnect(); } catch { /* */ }
      node.source = null;
    }
  }, []);

  // ── setup / teardown shared SoundTouchNode ──────────────────────────

  const setupSoundTouch = useCallback(async () => {
    const ctx = getAudioContext();

    if (ctx.state === 'suspended') {
      console.log('[StemEngine] resuming AudioContext before SoundTouchNode setup...');
      await ctx.resume().catch(() => {});
    }

    // Register AudioWorklet processor (once globally)
    if (!stProcessorRegistered) {
      if (!stRegisterPromise) {
        console.log('[StemEngine] registering SoundTouchNode processor...');
        stRegisterPromise = SoundTouchNode.register(ctx, '/soundtouch-processor.js')
          .then(() => {
            stProcessorRegistered = true;
            console.log('[StemEngine] SoundTouchNode processor registered');
          });
      }
      await stRegisterPromise;
    }

    // Create shared SoundTouchNode
    const stNode = new SoundTouchNode(ctx);
    stNode.connect(ctx.destination);

    // Sync current pitch & speed
    const currentPitch = usePitchStore.getState().pitchSemitones;
    const currentSpeed = usePlayerStore.getState().speed;
    stNode.pitchSemitones.value = currentPitch;
    stNode.playbackRate.value = currentSpeed;

    stNodeRef.current = stNode;
    stReadyRef.current = true;

    console.log('[StemEngine] SoundTouchNode ready — pitch:', currentPitch, 'speed:', currentSpeed);

    return stNode;
  }, []);

  const teardownSoundTouch = useCallback(() => {
    if (stNodeRef.current) {
      try { stNodeRef.current.disconnect(); } catch { /* */ }
      stNodeRef.current = null;
    }
    stReadyRef.current = false;
    console.log('[StemEngine] SoundTouchNode torn down');
  }, []);

  // ── load stems ──────────────────────────────────────────────────────

  const loadStems = useCallback(async () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const store = useStemStore.getState();
    store.setLoadingProgress(0);
    store.setIsLoaded(false);

    // Setup shared SoundTouchNode first
    let stNode = stNodeRef.current;
    if (!stNode || !stReadyRef.current) {
      stNode = await setupSoundTouch();
    }

    const total = STEM_TRACKS.length;
    let loaded = 0;
    const entries: [StemKey, StemNode][] = [];

    for (const track of STEM_TRACKS) {
      try {
        const response = await fetchStemAudio(songId, track.key, songSource);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const gain = ctx.createGain();
        // Route: GainNode → shared SoundTouchNode (→ destination)
        gain.connect(stNode);
        entries.push([track.key, { buffer: audioBuffer, gain, source: null }]);
        console.log('[StemEngine] loaded stem:', track.key, 'duration:', audioBuffer.duration.toFixed(1) + 's');
      } catch (err) {
        // Failed to load → silent 1-second buffer
        console.warn('[StemEngine] failed to load stem:', track.key, err);
        const silentBuffer = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate);
        const gain = ctx.createGain();
        gain.connect(stNode);
        entries.push([track.key, { buffer: silentBuffer, gain, source: null }]);
      }
      loaded++;
      useStemStore.getState().setLoadingProgress(loaded / total);
    }

    stemsRef.current = new Map(entries);
    useStemStore.getState().setIsLoaded(true);
    useStemStore.getState().setLoadingProgress(1);
    console.log('[StemEngine] all stems loaded, count:', entries.length);
  }, [songId, songSource, setupSoundTouch]);

  // ── start / stop ────────────────────────────────────────────────────

  const startPlayback = useCallback((offset: number) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const speed = usePlayerStore.getState().speed;

    // Tear down existing playback
    stemsRef.current.forEach((node) => destroyNode(node));

    stemsRef.current.forEach((node) => {
      const duration = node.buffer.duration;
      const clampedOffset = duration > 0 ? Math.min(Math.max(offset, 0), duration - 0.05) : 0;

      const src = ctx.createBufferSource();
      src.buffer = node.buffer;
      // No detune — SoundTouchNode handles pitch shifting properly
      src.playbackRate.value = speed;
      src.connect(node.gain);
      src.start(0, clampedOffset);
      node.source = src;
    });

    // Sync SoundTouchNode playbackRate so it knows the source speed
    if (stNodeRef.current) {
      stNodeRef.current.playbackRate.value = speed;
    }

    isPlayingRef.current = true;
    lastCurrentTimeRef.current = offset;
    console.log('[StemEngine] startPlayback offset:', offset.toFixed(1), 'speed:', speed);
  }, [destroyNode]);

  const stopPlayback = useCallback(() => {
    stemsRef.current.forEach((node) => destroyNode(node));
    isPlayingRef.current = false;
  }, [destroyNode]);

  // ── sync play/pause/seek ────────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !isLoaded) return;

    const unsubscribe = usePlayerStore.subscribe((state, prevState) => {
      // Play/pause changed
      if (state.isPlaying !== prevState.isPlaying) {
        if (state.isPlaying) {
          startPlayback(state.currentTime);
        } else {
          stopPlayback();
        }
      }

      // Seek detection: large jump in currentTime → user dragged waveform
      if (state.isPlaying && isPlayingRef.current) {
        const delta = state.currentTime - lastCurrentTimeRef.current;
        lastCurrentTimeRef.current = state.currentTime;
        if (Math.abs(delta) > 0.5) {
          startPlayback(state.currentTime);
        }
      }
    });

    // If already playing when effect mounts, start immediately
    const t = usePlayerStore.getState().currentTime;
    lastCurrentTimeRef.current = t;
    if (usePlayerStore.getState().isPlaying) {
      startPlayback(t);
    }

    return () => {
      unsubscribe();
      stopPlayback();
    };
  }, [isActive, isLoaded, startPlayback, stopPlayback]);

  // ── sync pitch → SoundTouchNode.pitchSemitones ────────────────────

  useEffect(() => {
    if (!isActive || !isLoaded) {
      console.log('[StemEngine] pitch sync skipped: isActive:', isActive, 'isLoaded:', isLoaded);
      return;
    }
    console.log('[StemEngine] pitch sync ACTIVE — subscribing to pitchStore');

    return usePitchStore.subscribe((state, prevState) => {
      if (state.pitchSemitones !== prevState.pitchSemitones) {
        if (stNodeRef.current) {
          stNodeRef.current.pitchSemitones.value = state.pitchSemitones;
          console.log('[StemEngine] pitchSemitones synced to SoundTouchNode:', state.pitchSemitones);
        } else {
          console.warn('[StemEngine] pitch changed but SoundTouchNode not ready');
        }
      }
    });
  }, [isActive, isLoaded]);

  // ── sync speed → playbackRate on sources + SoundTouchNode ─────────

  useEffect(() => {
    if (!isActive || !isLoaded) return;

    return usePlayerStore.subscribe((state, prevState) => {
      if (state.speed !== prevState.speed) {
        const aliveSources = [...stemsRef.current.values()].filter(n => n.source !== null);
        console.log('[StemEngine] speed changed to', state.speed,
          'sources alive:', aliveSources.length);
        // Update source playbackRate (raw speed, no compensation needed)
        stemsRef.current.forEach((node) => {
          if (node.source) {
            node.source.playbackRate.value = state.speed;
          }
        });
        // Tell SoundTouchNode the source playback rate so it auto-compensates pitch
        if (stNodeRef.current) {
          stNodeRef.current.playbackRate.value = state.speed;
          console.log('[StemEngine] speed synced to SoundTouchNode:', state.speed);
        }
      }
    });
  }, [isActive, isLoaded]);

  // ── sync volumes ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isActive || !isLoaded) return;

    const unsubscribe = useStemStore.subscribe((state) => {
      STEM_KEYS.forEach((key) => {
        const node = stemsRef.current.get(key);
        if (node) {
          const vol = state.getEffectiveVolume(key);
          node.gain.gain.linearRampToValueAtTime(
            vol,
            getAudioContext().currentTime + 0.05
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

  // ── cleanup ─────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stemsRef.current.forEach((node) => destroyNode(node));
      teardownSoundTouch();
    };
  }, [destroyNode, teardownSoundTouch]);

  return { loadStems, isLoaded };
}
