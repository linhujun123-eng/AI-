#!/usr/bin/env python3
"""
和弦提取脚本 v4 — 高密度版

v3 → v4 改进：
1. beats_per_segment 1（每拍分析，分辨率翻倍）
2. min_duration 降到 0.8s（保留更多快速和弦变化）
3. 平滑窗口从 5→3 只保留一轮（减少过度平滑）
4. 稀有和弦阈值从 3→2（保留更多真实和弦）
5. 置信度阈值微降（basic 0.50, extended 0.60），捕获更多边界和弦
"""

import sys
import json
import numpy as np
import librosa
from collections import Counter

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def build_chord_templates():
    basic = {}
    extended = {}
    for i, root in enumerate(NOTE_NAMES):
        v = np.zeros(12); v[i]=1; v[(i+4)%12]=0.8; v[(i+7)%12]=0.8
        basic[root] = v
        v = np.zeros(12); v[i]=1; v[(i+3)%12]=0.8; v[(i+7)%12]=0.8
        basic[f'{root}m'] = v
        v = np.zeros(12); v[i]=1; v[(i+4)%12]=0.7; v[(i+7)%12]=0.7; v[(i+10)%12]=0.6
        extended[f'{root}7'] = v
        v = np.zeros(12); v[i]=1; v[(i+3)%12]=0.7; v[(i+7)%12]=0.7; v[(i+10)%12]=0.6
        extended[f'{root}m7'] = v
        v = np.zeros(12); v[i]=1; v[(i+4)%12]=0.7; v[(i+7)%12]=0.7; v[(i+11)%12]=0.6
        extended[f'{root}maj7'] = v
        v = np.zeros(12); v[i]=1; v[(i+5)%12]=0.8; v[(i+7)%12]=0.8
        extended[f'{root}sus4'] = v
    return basic, extended


def cosine_sim(a, b):
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    return np.dot(a, b) / (na * nb) if na > 0 and nb > 0 else 0.0


def match_chord(chroma_vec, basic_t, ext_t, ext_threshold=0.08):
    if np.max(chroma_vec) < 0.03:
        return 'N', 0.0
    bn = list(basic_t.keys()); bv = list(basic_t.values())
    en = list(ext_t.keys()); ev = list(ext_t.values())
    bs = np.array([cosine_sim(chroma_vec, v) for v in bv])
    es = np.array([cosine_sim(chroma_vec, v) for v in ev])
    bi, ei = np.argmax(bs), np.argmax(es)
    if es[ei] > bs[bi] + ext_threshold and es[ei] >= 0.60:
        return en[ei], es[ei]
    if bs[bi] >= 0.50:
        return bn[bi], bs[bi]
    return 'N', bs[bi]


def simplify_chord(chord):
    """简化和弦名 — 将扩展和弦回退到基本三和弦"""
    if chord.endswith('maj7'):
        return chord[:-4]
    if 'm7' in chord:
        return chord.replace('m7', 'm')
    if chord.endswith('7') and 'maj' not in chord and 'm' not in chord:
        return chord[:-1]
    if chord.endswith('sus4'):
        return chord[:-4]
    return chord


def guitar_friendly_name(chord):
    mapping = {
        'D#': 'Eb', 'D#m': 'Ebm',
        'G#': 'Ab', 'G#m': 'G#m',  # G#m 吉他常用
        'A#': 'Bb', 'A#m': 'Bbm',
    }
    return mapping.get(chord, chord)


def extract_chords(audio_path, beats_per_segment=1, min_duration=0.8, simplify=True):
    print(f"Loading: {audio_path}")
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    print(f"Duration: {duration:.1f}s")
    
    hop = 512
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    tempo_val = float(np.atleast_1d(tempo)[0])
    print(f"Tempo: {tempo_val:.1f} BPM, {len(beat_times)} beats")
    
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, n_chroma=12)
    
    # 聚合 beat 段（每拍一次分析）
    seg_times, seg_chromas = [], []
    for i in range(0, len(beat_times), beats_per_segment):
        t_start = beat_times[i]
        t_end = beat_times[min(i + beats_per_segment, len(beat_times) - 1)] if i + beats_per_segment < len(beat_times) else duration
        f_start = librosa.time_to_frames(t_start, sr=sr, hop_length=hop)
        f_end = min(librosa.time_to_frames(t_end, sr=sr, hop_length=hop), chroma.shape[1])
        if f_end > f_start:
            seg_times.append(t_start)
            seg_chromas.append(np.median(chroma[:, f_start:f_end], axis=1))
    
    print(f"Segments: {len(seg_times)}")
    
    # 匹配
    basic_t, ext_t = build_chord_templates()
    raw = [match_chord(c, basic_t, ext_t)[0] for c in seg_chromas]
    
    # 简化
    if simplify:
        raw = [simplify_chord(c) if c != 'N' else c for c in raw]
    
    # 吉他友好名
    raw = [guitar_friendly_name(c) if c != 'N' else c for c in raw]
    
    # 单轮 3-窗口平滑（只做一轮，避免过度平滑）
    s = raw.copy()
    for i in range(1, len(s) - 1):
        if s[i-1] == s[i+1] and s[i] != s[i-1] and s[i-1] != 'N':
            s[i] = s[i-1]
    
    # 稀有和弦回退 — 出现 < 2 次的和弦替换为最相似的常见和弦
    total_counts = Counter(x for x in s if x != 'N')
    common_chords = {c for c, n in total_counts.items() if n >= 2}
    print(f"Common chords (≥2 occurrences): {common_chords}")
    
    if common_chords:
        for i, chord in enumerate(s):
            if chord != 'N' and chord not in common_chords:
                best = None
                for d in range(1, len(s)):
                    if i - d >= 0 and s[i-d] in common_chords:
                        best = s[i-d]; break
                    if i + d < len(s) and s[i+d] in common_chords:
                        best = s[i+d]; break
                if best:
                    s[i] = best
    
    # 合并连续相同
    segments = []
    for i, chord in enumerate(s):
        if chord == 'N':
            continue
        t = round(seg_times[i], 2)
        if segments and segments[-1]['chord'] == chord:
            continue
        segments.append({'time': t, 'chord': chord})
    
    # 最小时长过滤
    if min_duration > 0 and len(segments) > 1:
        filtered = [segments[0]]
        for i in range(1, len(segments)):
            gap = segments[i]['time'] - filtered[-1]['time']
            if gap < min_duration:
                continue
            filtered.append(segments[i])
        segments = filtered
    
    # 二次去重
    deduped = [segments[0]]
    for i in range(1, len(segments)):
        if segments[i]['chord'] != deduped[-1]['chord']:
            deduped.append(segments[i])
    segments = deduped
    
    # 最终统计
    final_counts = Counter(s['chord'] for s in segments)
    print(f"\nFinal chord distribution:")
    for chord, count in final_counts.most_common():
        print(f"  {chord}: {count}")
    print(f"Total chord changes: {len(segments)}")
    
    # Gap 分析
    print(f"\n--- Gaps > 4s ---")
    for i in range(1, len(segments)):
        gap = segments[i]['time'] - segments[i-1]['time']
        if gap > 4:
            print(f"  [{segments[i-1]['time']:.2f}s] {segments[i-1]['chord']}  →  [{segments[i]['time']:.2f}s] {segments[i]['chord']}  gap: {gap:.1f}s")
    
    return segments


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python extract_chords_v4.py <audio_file> [output.json]")
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
        print(output)
