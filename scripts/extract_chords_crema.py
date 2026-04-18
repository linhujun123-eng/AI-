#!/usr/bin/env python3
"""
和弦提取脚本 — CREMA 深度学习版

基于 CREMA (Convolutional and Recurrent Estimators for Music Analysis) 模型，
替代 v4 的手工 chroma template matching，预期准确率 ~82-85%。

输出格式保持与 v4 完全一致：[{"time": float, "chord": str}, ...]
前端零改动。

依赖：
  pip install crema tf_keras

使用：
  python3 scripts/extract_chords_crema.py <audio_file> [output.json]
"""

import sys
import json
import re
from collections import Counter

# ---------------------------------------------------------------------------
# Keras 3 compatibility: CREMA needs legacy keras (tf_keras)
# Must be done BEFORE any crema import
# ---------------------------------------------------------------------------
import tf_keras
sys.modules['keras'] = tf_keras
sys.modules['keras.models'] = tf_keras.models
sys.modules['keras.layers'] = tf_keras.layers

import numpy as np
import librosa

from crema.analyze import analyze


# ---------------------------------------------------------------------------
# Chord name mapping: CREMA → guitar-friendly
# ---------------------------------------------------------------------------

# CREMA uses MIREX format: "Root:quality" or "Root:quality/bass"
# e.g. "G:min", "C:min/5", "D:maj", "D#:maj", "A:7", "E:min7"
# We need: "Gm", "Cm", "D", "Eb", "A7", "Em7"

# Sharp → Flat mapping for guitar-friendly names
SHARP_TO_FLAT = {
    'D#': 'Eb',
    'A#': 'Bb',
    # G# stays G# for minor (G#m is standard), but G# major → Ab
}

# CREMA quality → suffix mapping
QUALITY_MAP = {
    'maj':   '',
    'min':   'm',
    'maj7':  'maj7',
    'min7':  'm7',
    '7':     '7',
    'dim':   'dim',
    'aug':   'aug',
    'sus4':  'sus4',
    'sus2':  'sus2',
    'hdim7': 'm7b5',
    'minmaj7': 'mMaj7',
    'maj6':  '6',
    'min6':  'm6',
    '9':     '9',
    'min9':  'm9',
    'dim7':  'dim7',
    '1':     '5',       # power chord
}


def crema_to_guitar(crema_chord: str) -> str:
    """
    Convert CREMA chord notation to guitar-friendly name.
    
    Examples:
        "G:min"    → "Gm"
        "C:min/5"  → "Cm"
        "D#:maj"   → "Eb"
        "A:7"      → "A7"
        "N"        → "N"
        "X"        → "N"
    """
    if crema_chord in ('N', 'X', ''):
        return 'N'
    
    # Split "Root:quality" or "Root:quality/bass"
    # Remove bass note (e.g. "/5", "/b7") — we don't display inversions
    chord_no_bass = crema_chord.split('/')[0]
    
    parts = chord_no_bass.split(':')
    if len(parts) < 2:
        # Just a root note, treat as major
        root = parts[0]
        quality = ''
    else:
        root = parts[0]
        quality = parts[1]
    
    # Map quality to suffix
    suffix = QUALITY_MAP.get(quality, quality)
    
    # Apply sharp → flat for guitar friendliness
    if root in SHARP_TO_FLAT:
        # Special case: G#m stays G#m, but G# major → Ab
        if root == 'G#' and 'm' in suffix:
            pass  # keep G#
        elif root == 'D#' and 'm' in suffix:
            root = 'Eb'
        elif root == 'A#' and 'm' in suffix:
            root = 'Bb'
        else:
            root = SHARP_TO_FLAT.get(root, root)
    
    return f"{root}{suffix}"


def simplify_chord(chord: str) -> str:
    """
    Simplify extended chords to basic triads (same logic as v4).
    Keep 7ths for now — they're useful. Only simplify rare extensions.
    """
    if chord == 'N':
        return chord
    # mMaj7 → m
    if chord.endswith('mMaj7'):
        return chord[:-5] + 'm'
    # m7b5 → dim
    if chord.endswith('m7b5'):
        return chord[:-4] + 'dim'
    # dim7 → dim
    if chord.endswith('dim7'):
        return chord[:-4] + 'dim'
    # 9 → 7
    if chord.endswith('9') and not chord.endswith('m9'):
        return chord[:-1] + '7'
    if chord.endswith('m9'):
        return chord[:-1] + '7'
    # 6 → maj
    if chord.endswith('6') and not chord.endswith('m6'):
        return chord[:-1]
    if chord.endswith('m6'):
        return chord[:-2] + 'm'
    return chord


# ---------------------------------------------------------------------------
# Beat quantization & subdivision
# ---------------------------------------------------------------------------

def extract_beats(audio_path: str) -> tuple:
    """
    Extract beat times from audio using librosa.
    
    Returns:
        (beats, tempo) where beats is a numpy array of beat times in seconds,
        tempo is the estimated BPM.
    """
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    
    # tempo may be an ndarray with one element
    if hasattr(tempo, '__len__'):
        tempo = float(tempo[0]) if len(tempo) > 0 else 120.0
    else:
        tempo = float(tempo)
    
    return beat_times, tempo


def snap_to_beat(t: float, beats: np.ndarray, max_distance: float = 0.3) -> float:
    """
    Snap a time value to the nearest beat.
    
    Args:
        t: Time in seconds
        beats: Sorted array of beat times
        max_distance: Maximum snap distance in seconds. If nearest beat is
                     farther than this, return original time.
    
    Returns:
        Snapped time (or original if no beat within max_distance)
    """
    if len(beats) == 0:
        return t
    idx = np.searchsorted(beats, t)
    candidates = []
    if idx > 0:
        candidates.append(beats[idx - 1])
    if idx < len(beats):
        candidates.append(beats[idx])
    nearest = min(candidates, key=lambda b: abs(b - t))
    if abs(nearest - t) <= max_distance:
        return round(float(nearest), 3)
    return t


def subdivide_long_segments(chords: list, beats: np.ndarray,
                            min_interval: float = 1.0) -> list:
    """
    Subdivide long chord segments by repeating the chord at beat positions.
    
    For each pair of adjacent chords, find beats that fall between them.
    If those beats are far enough apart (>= min_interval), insert a
    repeated chord entry at each beat.
    
    Args:
        chords: List of {"time": float, "chord": str}
        beats: Sorted array of beat times
        min_interval: Minimum interval between subdivided entries (seconds)
    
    Returns:
        New chord list with subdivisions inserted
    """
    if not chords or len(beats) == 0:
        return chords
    
    result = []
    for i, chord in enumerate(chords):
        result.append(chord)
        
        # Find the end of this chord's region
        if i + 1 < len(chords):
            next_time = chords[i + 1]['time']
        else:
            # Last chord: extend to the last beat (or a bit beyond)
            next_time = float(beats[-1]) + 1.0 if len(beats) > 0 else chord['time'] + 10.0
        
        segment_duration = next_time - chord['time']
        if segment_duration <= min_interval:
            continue
        
        # Find beats within this segment (exclusive of chord's own beat)
        start_idx = np.searchsorted(beats, chord['time'], side='right')
        end_idx = np.searchsorted(beats, next_time, side='left')
        
        segment_beats = beats[start_idx:end_idx]
        if len(segment_beats) == 0:
            continue
        
        # Filter beats to maintain min_interval spacing
        last_inserted = chord['time']
        for bt in segment_beats:
            if bt - last_inserted >= min_interval and next_time - bt >= min_interval * 0.5:
                result.append({'time': round(float(bt), 3), 'chord': chord['chord']})
                last_inserted = bt
    
    # Sort by time (should already be sorted, but be safe)
    result.sort(key=lambda c: c['time'])
    return result


# ---------------------------------------------------------------------------
# Key detection & V4 fusion
# ---------------------------------------------------------------------------

# All diatonic chords for each major key (triads + common extensions)
# Format: root → set of diatonic chord names
MAJOR_KEY_CHORDS = {}
_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
_SEMITONES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
_ROOT_TO_SEMI = {r: s for r, s in zip(_ROOTS, _SEMITONES)}
# Add enharmonic aliases
_ROOT_TO_SEMI.update({'Db': 1, 'D#': 3, 'Gb': 6, 'G#': 8, 'A#': 10})
_SEMI_TO_ROOT = {s: r for r, s in zip(_ROOTS, _SEMITONES)}

def _chord_name(semitone: int, quality: str) -> str:
    root = _SEMI_TO_ROOT.get(semitone % 12, _ROOTS[semitone % 12])
    return f"{root}{quality}"

def _build_key_chords(root_semi: int) -> set:
    """Build set of diatonic chords for a major key."""
    # Major scale intervals: W W H W W W H → 0,2,4,5,7,9,11
    scale = [(root_semi + i) % 12 for i in [0, 2, 4, 5, 7, 9, 11]]
    chords = set()
    # I, IV, V = major
    for deg in [0, 3, 4]:
        chords.add(_chord_name(scale[deg], ''))
        chords.add(_chord_name(scale[deg], 'maj7'))
        chords.add(_chord_name(scale[deg], '7'))
    # ii, iii, vi = minor
    for deg in [1, 2, 5]:
        chords.add(_chord_name(scale[deg], 'm'))
        chords.add(_chord_name(scale[deg], 'm7'))
    # vii = dim
    chords.add(_chord_name(scale[6], 'dim'))
    chords.add(_chord_name(scale[6], 'm7b5'))
    # Common borrowed: bVII, iv (minor subdominant)
    chords.add(_chord_name((root_semi + 10) % 12, ''))   # bVII
    chords.add(_chord_name((root_semi + 5) % 12, 'm'))    # iv
    # sus chords on I, IV, V
    for deg in [0, 3, 4]:
        chords.add(_chord_name(scale[deg], 'sus4'))
        chords.add(_chord_name(scale[deg], 'sus2'))
    return chords

# Pre-build all keys
for _r, _s in _ROOT_TO_SEMI.items():
    if _r in _ROOTS:  # avoid duplicates from enharmonic
        MAJOR_KEY_CHORDS[_r] = _build_key_chords(_s)


def detect_key(chords: list) -> tuple:
    """
    Detect the likely key from a chord list by scoring against all major keys.
    
    Returns:
        (key_name, diatonic_chords_set, confidence)
        e.g. ('E', {'E', 'F#m', 'G#m', 'A', 'B', 'C#m', ...}, 0.94)
    """
    if not chords:
        return ('C', MAJOR_KEY_CHORDS['C'], 0.0)
    
    chord_names = [c['chord'] for c in chords]
    total = len(chord_names)
    
    best_key = 'C'
    best_score = 0.0
    best_set = MAJOR_KEY_CHORDS['C']
    
    for key_name, key_chords in MAJOR_KEY_CHORDS.items():
        matches = sum(1 for c in chord_names if c in key_chords)
        score = matches / total
        if score > best_score:
            best_score = score
            best_key = key_name
            best_set = key_chords
    
    return (best_key, best_set, best_score)


def run_v4_extraction(audio_path: str) -> list:
    """
    Run V4 template-matching chord extraction.
    Returns list of {"time": float, "chord": str}.
    """
    import importlib.util
    import os
    
    v4_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extract_chords_v4.py')
    if not os.path.exists(v4_path):
        print(f"  V4 script not found at {v4_path}, skipping fusion")
        return []
    
    spec = importlib.util.spec_from_file_location("extract_chords_v4", v4_path)
    v4_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v4_mod)
    
    return v4_mod.extract_chords(audio_path)


def fuse_v4_into_crema(crema_chords: list, v4_chords: list,
                       key_chords: set, key_name: str,
                       duration: float,
                       n_gap_threshold: float = 3.0,
                       long_segment_threshold: float = 6.0,
                       min_time_distance: float = 0.3) -> tuple:
    """
    Fuse V4 chord detections into CREMA results in two targeted scenarios:
    
    Scenario A — CREMA N-gaps (no-chord regions):
        If CREMA has gaps > n_gap_threshold where no chord is assigned,
        fill with V4 detections that are in-key.
    
    Scenario B — CREMA long segments (single chord > long_segment_threshold):
        If CREMA holds one chord for > long_segment_threshold seconds,
        V4 may have detected real chord changes within. Accept V4 chords
        that are (a) in-key, (b) different from the CREMA sustained chord,
        and (c) not too close to existing CREMA chord boundaries.
    
    Args:
        crema_chords: CREMA output (post-quantize, post-subdivide)
        v4_chords: V4 output
        key_chords: Set of diatonic chord names for the detected key
        key_name: Detected key name (for logging)
        duration: Total audio duration in seconds
        n_gap_threshold: Min gap (seconds) to be considered a CREMA N-gap
        long_segment_threshold: Min duration to be a "long segment"
        min_time_distance: Min distance (seconds) from existing CREMA points
    
    Returns:
        (fused_chords, fusion_stats) where fusion_stats is a dict with details
    """
    stats = {
        'n_gaps_found': 0,
        'n_gaps_filled': 0,
        'long_segments_found': 0,
        'long_segments_filled': 0,
        'v4_candidates': 0,
        'v4_accepted': 0,
        'v4_rejected_offkey': 0,
        'v4_rejected_same': 0,
        'v4_rejected_close': 0,
        'fusion_applied': False,
    }
    
    if not v4_chords:
        return crema_chords, stats
    
    added = []
    
    # Build a set of existing CREMA times for proximity check
    crema_times = set(c['time'] for c in crema_chords)
    
    def _too_close(t: float) -> bool:
        return any(abs(t - ct) < min_time_distance for ct in crema_times)
    
    # --- Scenario A: Find N-gaps (uncovered regions) ---
    # Gaps at the start (before first chord) and end (after last chord),
    # plus any internal gaps > threshold
    gap_regions = []
    
    # Start gap
    if crema_chords and crema_chords[0]['time'] > n_gap_threshold:
        gap_regions.append((0.0, crema_chords[0]['time']))
    
    # Internal gaps (between consecutive chords)
    for i in range(len(crema_chords) - 1):
        gap = crema_chords[i + 1]['time'] - crema_chords[i]['time']
        if gap > n_gap_threshold:
            gap_regions.append((crema_chords[i]['time'], crema_chords[i + 1]['time']))
    
    # End gap
    if crema_chords and duration - crema_chords[-1]['time'] > n_gap_threshold:
        gap_regions.append((crema_chords[-1]['time'], duration))
    
    stats['n_gaps_found'] = len(gap_regions)
    
    for gap_start, gap_end in gap_regions:
        v4_in_gap = [c for c in v4_chords
                     if gap_start < c['time'] < gap_end]
        stats['v4_candidates'] += len(v4_in_gap)
        
        for v in v4_in_gap:
            if v['chord'] not in key_chords:
                stats['v4_rejected_offkey'] += 1
                continue
            if _too_close(v['time']):
                stats['v4_rejected_close'] += 1
                continue
            added.append(v.copy())
            crema_times.add(v['time'])
            stats['v4_accepted'] += 1
        
        if any(gap_start < a['time'] < gap_end for a in added):
            stats['n_gaps_filled'] += 1
    
    # --- Scenario B: Long CREMA segments ---
    # Find segments where CREMA holds one chord for a long time
    # (use the ORIGINAL crema_chords before subdivision to find true long holds)
    # But since we already have subdivided data, we detect by looking at
    # consecutive runs of the same chord
    
    # Group consecutive identical chords to find sustained regions
    i = 0
    while i < len(crema_chords):
        j = i
        while j < len(crema_chords) and crema_chords[j]['chord'] == crema_chords[i]['chord']:
            j += 1
        
        # Region: crema_chords[i] to crema_chords[j-1] (same chord)
        seg_start = crema_chords[i]['time']
        if j < len(crema_chords):
            seg_end = crema_chords[j]['time']
        else:
            seg_end = duration
        seg_duration = seg_end - seg_start
        seg_chord = crema_chords[i]['chord']
        
        if seg_duration >= long_segment_threshold:
            stats['long_segments_found'] += 1
            
            # Find V4 chords within this region that are DIFFERENT
            v4_in_seg = [c for c in v4_chords
                         if seg_start < c['time'] < seg_end
                         and c['chord'] != seg_chord]
            stats['v4_candidates'] += len(v4_in_seg)
            
            seg_accepted = 0
            for v in v4_in_seg:
                if v['chord'] not in key_chords:
                    stats['v4_rejected_offkey'] += 1
                    continue
                if v['chord'] == seg_chord:
                    stats['v4_rejected_same'] += 1
                    continue
                if _too_close(v['time']):
                    stats['v4_rejected_close'] += 1
                    continue
                added.append(v.copy())
                crema_times.add(v['time'])
                stats['v4_accepted'] += 1
                seg_accepted += 1
            
            if seg_accepted > 0:
                stats['long_segments_filled'] += 1
        
        i = j
    
    if not added:
        return crema_chords, stats
    
    # Merge added chords into CREMA list
    stats['fusion_applied'] = True
    fused = crema_chords + added
    fused.sort(key=lambda c: c['time'])
    
    # Final dedup (shouldn't be needed, but safety)
    deduped = [fused[0]]
    for k in range(1, len(fused)):
        if fused[k]['time'] != deduped[-1]['time']:
            deduped.append(fused[k])
    
    return deduped, stats


def extract_chords(audio_path: str, min_confidence: float = 0.0,
                   min_duration: float = 0.5, simplify: bool = True,
                   quantize_beats: bool = True,
                   subdivide: bool = True,
                   snap_max_distance: float = 0.3,
                   subdivide_min_interval: float = 1.0,
                   fuse_v4: bool = True,
                   fuse_n_gap_threshold: float = 3.0,
                   fuse_long_segment_threshold: float = 6.0) -> list:
    """
    Extract chords from audio using CREMA model.
    
    Args:
        audio_path: Path to audio file
        min_confidence: Minimum confidence threshold (0.0 = keep all)
        min_duration: Minimum chord duration in seconds
        simplify: Whether to simplify extended chords
        quantize_beats: Whether to snap chord times to nearest beat
        subdivide: Whether to subdivide long chord segments at beat positions
        snap_max_distance: Max distance (seconds) for beat snapping
        subdivide_min_interval: Min interval (seconds) between subdivided entries
        fuse_v4: Whether to fuse V4 detections into weak regions
        fuse_n_gap_threshold: Min gap (seconds) for N-gap fusion
        fuse_long_segment_threshold: Min duration (seconds) for long-segment fusion
    
    Returns:
        List of {"time": float, "chord": str} dicts (same format as v4)
    """
    print(f"Loading: {audio_path}")
    print("Running CREMA chord recognition (deep learning)...")
    
    # --- Beat extraction (for quantization & subdivision) ---
    beats = np.array([])
    tempo = 0.0
    if quantize_beats or subdivide:
        print("Extracting beats with librosa...")
        beats, tempo = extract_beats(audio_path)
        avg_interval = float(np.mean(np.diff(beats))) if len(beats) > 1 else 0
        print(f"  Tempo: {tempo:.1f} BPM | Beats: {len(beats)} | Avg interval: {avg_interval:.3f}s")
    
    # Run CREMA analysis
    jam = analyze(filename=audio_path)
    
    duration = jam.file_metadata.duration
    print(f"Duration: {duration:.1f}s")
    
    # Extract chord annotations
    chord_ann = jam.annotations['chord', 0]
    df = chord_ann.to_dataframe()
    
    print(f"Raw CREMA output: {len(df)} segments")
    
    # Convert to our format
    raw_chords = []
    for _, row in df.iterrows():
        t = round(float(row['time']), 2)
        dur = float(row['duration'])
        conf = float(row['confidence'])
        crema_name = str(row['value'])
        
        # Convert to guitar-friendly name
        chord = crema_to_guitar(crema_name)
        
        # Skip no-chord
        if chord == 'N':
            continue
        
        # Confidence filter
        if conf < min_confidence:
            continue
        
        # Duration filter (CREMA segments)
        if dur < min_duration:
            continue
        
        # Simplify if requested
        if simplify:
            chord = simplify_chord(chord)
        
        raw_chords.append({'time': t, 'chord': chord, '_conf': conf, '_dur': dur})
    
    print(f"After filtering: {len(raw_chords)} chord events")
    
    # Merge consecutive identical chords
    merged = []
    for item in raw_chords:
        if merged and merged[-1]['chord'] == item['chord']:
            continue
        merged.append(item)
    
    # Rare chord fallback: chords appearing < 2 times → replace with nearest common
    chord_counts = Counter(c['chord'] for c in merged)
    common_chords = {c for c, n in chord_counts.items() if n >= 2}
    print(f"Common chords (≥2): {common_chords}")
    
    if common_chords:
        for i, item in enumerate(merged):
            if item['chord'] not in common_chords:
                best = None
                for d in range(1, len(merged)):
                    if i - d >= 0 and merged[i - d]['chord'] in common_chords:
                        best = merged[i - d]['chord']; break
                    if i + d < len(merged) and merged[i + d]['chord'] in common_chords:
                        best = merged[i + d]['chord']; break
                if best:
                    merged[i]['chord'] = best
    
    # Re-merge after fallback
    final = []
    for item in merged:
        entry = {'time': item['time'], 'chord': item['chord']}
        if final and final[-1]['chord'] == entry['chord']:
            continue
        final.append(entry)
    
    # Min-duration gap filter (between consecutive different chords)
    if min_duration > 0 and len(final) > 1:
        filtered = [final[0]]
        for i in range(1, len(final)):
            gap = final[i]['time'] - filtered[-1]['time']
            if gap < min_duration:
                continue
            filtered.append(final[i])
        final = filtered
    
    # Final dedup
    deduped = [final[0]] if final else []
    for i in range(1, len(final)):
        if final[i]['chord'] != deduped[-1]['chord']:
            deduped.append(final[i])
    final = deduped
    
    pre_quantize_count = len(final)
    
    # --- Beat quantization: snap chord times to nearest beat ---
    if quantize_beats and len(beats) > 0:
        print(f"\nBeat quantization (max_distance={snap_max_distance}s)...")
        snapped_count = 0
        for item in final:
            original = item['time']
            item['time'] = snap_to_beat(original, beats, max_distance=snap_max_distance)
            if item['time'] != original:
                snapped_count += 1
        
        # Re-dedup after snapping (snap may cause adjacent chords to collide)
        deduped2 = [final[0]] if final else []
        for i in range(1, len(final)):
            if final[i]['time'] != deduped2[-1]['time'] and final[i]['chord'] != deduped2[-1]['chord']:
                deduped2.append(final[i])
            elif final[i]['time'] == deduped2[-1]['time']:
                # Same time: keep the one that was there (first wins)
                pass
        final = deduped2
        print(f"  Snapped {snapped_count}/{pre_quantize_count} chords to beats, {len(final)} after dedup")
    
    # --- Long segment subdivision: repeat chord at beat positions ---
    if subdivide and len(beats) > 0:
        pre_subdivide_count = len(final)
        final = subdivide_long_segments(final, beats, min_interval=subdivide_min_interval)
        print(f"\nSubdivision (min_interval={subdivide_min_interval}s):")
        print(f"  {pre_subdivide_count} → {len(final)} chord entries (+{len(final) - pre_subdivide_count})")
    
    # --- V4 Fusion: fill N-gaps and long segments with V4 in-key chords ---
    if fuse_v4:
        print(f"\n--- V4 Fusion ---")
        # Detect key from CREMA results
        key_name, key_chords, key_conf = detect_key(final)
        print(f"  Detected key: {key_name} major (confidence: {key_conf:.0%})")
        print(f"  Diatonic chords: {sorted(key_chords)[:12]}...")
        
        # Run V4 extraction
        print(f"  Running V4 extraction for fusion candidates...")
        v4_chords = run_v4_extraction(audio_path)
        print(f"  V4 returned {len(v4_chords)} chords")
        
        if v4_chords:
            pre_fuse_count = len(final)
            final, fuse_stats = fuse_v4_into_crema(
                crema_chords=final,
                v4_chords=v4_chords,
                key_chords=key_chords,
                key_name=key_name,
                duration=duration,
                n_gap_threshold=fuse_n_gap_threshold,
                long_segment_threshold=fuse_long_segment_threshold,
            )
            
            print(f"\n  Fusion results:")
            print(f"    N-gaps found: {fuse_stats['n_gaps_found']}, filled: {fuse_stats['n_gaps_filled']}")
            print(f"    Long segments found: {fuse_stats['long_segments_found']}, filled: {fuse_stats['long_segments_filled']}")
            print(f"    V4 candidates: {fuse_stats['v4_candidates']}")
            print(f"    V4 accepted: {fuse_stats['v4_accepted']} (off-key rejected: {fuse_stats['v4_rejected_offkey']}, "
                  f"same-chord rejected: {fuse_stats['v4_rejected_same']}, too-close rejected: {fuse_stats['v4_rejected_close']})")
            if fuse_stats['fusion_applied']:
                print(f"    {pre_fuse_count} → {len(final)} chord entries (+{len(final) - pre_fuse_count} from V4)")
            else:
                print(f"    No V4 chords accepted — CREMA output is already optimal")
        else:
            print(f"  V4 returned no chords, skipping fusion")
    
    # Stats
    final_counts = Counter(c['chord'] for c in final)
    print(f"\nFinal chord distribution:")
    for chord, count in final_counts.most_common():
        print(f"  {chord}: {count}")
    print(f"Total chord changes: {len(final)}")
    
    # Gap analysis
    print(f"\n--- Gaps > 4s ---")
    for i in range(1, len(final)):
        gap = final[i]['time'] - final[i - 1]['time']
        if gap > 4:
            print(f"  [{final[i-1]['time']:.2f}s] {final[i-1]['chord']}  →  [{final[i]['time']:.2f}s] {final[i]['chord']}  gap: {gap:.1f}s")
    
    return final


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python extract_chords_crema.py <audio_file> [output.json]")
        sys.exit(1)
    
    audio_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    chords = extract_chords(audio_path)
    
    output = json.dumps(chords, indent=2, ensure_ascii=False)
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"\nSaved to: {output_path}")
    else:
        print(f"\n{output}")
