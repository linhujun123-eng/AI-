#!/usr/bin/env python3
"""
从音频文件提取和弦时间轴，输出 chords.json
使用 librosa chroma 特征 + 模板匹配
"""

import sys
import json
import numpy as np
import librosa

# 和弦模板：12个音高 [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]
CHORD_TEMPLATES = {}

def _major(root):
    t = np.zeros(12)
    t[root % 12] = 1.0
    t[(root + 4) % 12] = 0.8
    t[(root + 7) % 12] = 0.8
    return t / np.linalg.norm(t)

def _minor(root):
    t = np.zeros(12)
    t[root % 12] = 1.0
    t[(root + 3) % 12] = 0.8
    t[(root + 7) % 12] = 0.8
    return t / np.linalg.norm(t)

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

for i, name in enumerate(NOTE_NAMES):
    CHORD_TEMPLATES[name] = _major(i)
    CHORD_TEMPLATES[name + 'm'] = _minor(i)


def extract_chords(audio_path, hop_length=512, sr=22050):
    """提取和弦序列"""
    print(f"Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    duration = len(y) / sr
    print(f"Duration: {duration:.1f}s, Sample rate: {sr}")

    # 提取 chroma 特征
    print("Computing chroma features...")
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)

    # 对 chroma 做一些平滑处理减少噪声
    from scipy.ndimage import median_filter
    chroma_smooth = median_filter(chroma, size=(1, 9))

    n_frames = chroma_smooth.shape[1]
    frame_times = librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=hop_length)

    # 模板匹配：每帧找最佳和弦
    template_names = list(CHORD_TEMPLATES.keys())
    template_matrix = np.array([CHORD_TEMPLATES[n] for n in template_names])  # (n_chords, 12)

    print("Matching chords...")
    frame_chords = []
    for i in range(n_frames):
        frame_vec = chroma_smooth[:, i]
        norm = np.linalg.norm(frame_vec)
        if norm < 0.01:
            frame_chords.append("N")
            continue
        frame_norm = frame_vec / norm
        similarities = template_matrix @ frame_norm
        best_idx = np.argmax(similarities)
        if similarities[best_idx] < 0.6:
            frame_chords.append("N")
        else:
            frame_chords.append(template_names[best_idx])

    # 分段：连续相同和弦合并
    segments = []
    current_chord = frame_chords[0]
    current_start = frame_times[0]

    for i in range(1, n_frames):
        if frame_chords[i] != current_chord:
            if current_chord != "N":
                segments.append({
                    "chord": current_chord,
                    "start": float(current_start),
                    "end": float(frame_times[i])
                })
            current_chord = frame_chords[i]
            current_start = frame_times[i]

    # 最后一段
    if current_chord != "N":
        segments.append({
            "chord": current_chord,
            "start": float(current_start),
            "end": float(frame_times[-1])
        })

    # 过滤太短的段（< 0.5s 通常是噪声）
    segments = [s for s in segments if s["end"] - s["start"] >= 0.5]

    # 再次合并相邻相同和弦（过滤短段后可能产生）
    merged = []
    for seg in segments:
        if merged and merged[-1]["chord"] == seg["chord"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)

    # 输出格式
    chords = [{"time": round(s["start"], 2), "chord": s["chord"]} for s in merged]

    return chords


def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_chords.py <audio_file> [output_json]")
        sys.exit(1)

    audio_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "chords.json"

    chords = extract_chords(audio_path)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(chords, f, indent=2, ensure_ascii=False)

    print(f"\nExtracted {len(chords)} chord changes → {output_path}")
    print(f"\nAll entries:")
    for c in chords:
        print(f"  {c['time']:>7.2f}s  {c['chord']}")


if __name__ == "__main__":
    main()
