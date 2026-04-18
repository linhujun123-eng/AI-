/**
 * PitchEngine v2 — AudioWorklet-based (via @soundtouchjs/audio-worklet)
 *
 * The actual pitch shifting is now handled inside WaveformPanel, which sets up:
 *   <audio> → MediaElementSource → SoundTouchNode → GainNode → destination
 *
 * This file only re-exports `warmUpPitchEngine` for backward compatibility
 * (PlaybackControls / BottomBar import it to resume AudioContext on user gesture).
 *
 * The old usePitchEngine hook that loaded a buffer and ran SoundTouch PitchShifter
 * via ScriptProcessorNode is no longer needed.
 */

// Re-export for backward compatibility (PlaybackControls / BottomBar import this)
export { resumeAudioContext as warmUpPitchEngine } from '../services/audio-context';
