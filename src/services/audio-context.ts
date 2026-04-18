/**
 * Shared AudioContext singleton.
 *
 * All audio engines (StemEngine, PitchEngine) MUST use this single context.
 * Browser autoplay policy requires AudioContext.resume() to be called within
 * a user-gesture call-stack (click, keydown, touchend). Multiple AudioContexts
 * each need their own resume, making the problem harder — a single shared one
 * solves it.
 *
 * Usage:
 *   import { getAudioContext, resumeAudioContext } from '../services/audio-context';
 *
 *   // In hooks/engines — get the context:
 *   const ctx = getAudioContext();
 *
 *   // In click handlers — call resume BEFORE any state updates:
 *   resumeAudioContext();
 */

let _ctx: AudioContext | null = null;

/**
 * Get or create the shared AudioContext.
 * Safe to call outside user gestures (creation is fine, playback is not).
 */
export function getAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
  }
  return _ctx;
}

/**
 * Resume the shared AudioContext.
 * **Must be called from a user-gesture handler** (click / keydown / touchend).
 *
 * Call this at the TOP of any click handler that may lead to audio playback:
 *   - Play button click
 *   - Stem mixer activate
 *   - Pitch change buttons
 *   - Waveform click (seek while playing)
 */
export function resumeAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      console.warn('[AudioContext] resume() failed — not in user gesture?');
    });
  }
}
