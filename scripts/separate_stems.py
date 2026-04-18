#!/usr/bin/env python3
"""
分轨脚本：用 Demucs htdemucs_6s 将歌曲分离为 6 轨
输出：vocals, drums, bass, guitar, piano, other
直接映射到项目的 6 轨命名规范（与 Demucs 一致）
"""
import sys
import os
import subprocess
import shutil

# 配置
SONG_ID = sys.argv[1] if len(sys.argv) > 1 else "qingtian"
PROJECT_ROOT = "/Users/admin/.openclaw/workspace-music-practice/ai-practice-room"
INPUT_FILE = f"{PROJECT_ROOT}/public/audio/{SONG_ID}/mix.mp3"
OUTPUT_DIR = "/tmp/demucs_output"
TARGET_DIR = f"{PROJECT_ROOT}/public/audio/{SONG_ID}"

# htdemucs_6s 输出的 6 轨，与项目 stem key 完全一致
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]


def main():
    print(f"🎵 开始分轨: {SONG_ID}")
    print(f"   输入: {INPUT_FILE}")

    if not os.path.exists(INPUT_FILE):
        print(f"❌ 找不到输入文件: {INPUT_FILE}")
        sys.exit(1)

    # 清理旧输出
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)

    # Step 1: 运行 Demucs 分轨
    print("\n📦 Step 1: 运行 Demucs htdemucs_6s 模型...")
    print("   （首次运行需下载 ~52MB 模型，请耐心等待）\n")

    cmd = [
        sys.executable, "-m", "demucs",
        "--name", "htdemucs_6s",
        "--out", OUTPUT_DIR,
        "--mp3",
        "--mp3-bitrate", "192",
        INPUT_FILE,
    ]

    result = subprocess.run(cmd)
    if result.returncode != 0:
        print(f"\n❌ Demucs htdemucs_6s 分轨失败 (exit code {result.returncode})")
        sys.exit(1)

    model_name = "htdemucs_6s"

    # Step 2: 定位输出目录
    demucs_out = os.path.join(OUTPUT_DIR, model_name, "mix")
    if not os.path.exists(demucs_out):
        base = os.path.splitext(os.path.basename(INPUT_FILE))[0]
        demucs_out = os.path.join(OUTPUT_DIR, model_name, base)

    print(f"\n📂 Demucs 输出目录: {demucs_out}")
    if os.path.exists(demucs_out):
        files = os.listdir(demucs_out)
        print(f"   输出文件: {files}")
    else:
        print("❌ 找不到输出目录，实际文件结构：")
        for root, dirs, files in os.walk(OUTPUT_DIR):
            for f in files:
                print(f"   {os.path.join(root, f)}")
        sys.exit(1)

    # Step 3: 复制到项目目录
    print(f"\n📋 Step 2: 复制分轨到项目目录...")
    os.makedirs(TARGET_DIR, exist_ok=True)

    copied = 0
    for stem in STEMS:
        src = os.path.join(demucs_out, f"{stem}.mp3")
        if not os.path.exists(src):
            # 试 wav
            src = os.path.join(demucs_out, f"{stem}.wav")

        dst = os.path.join(TARGET_DIR, f"{stem}.mp3")

        if os.path.exists(src):
            shutil.copy2(src, dst)
            size_mb = os.path.getsize(dst) / 1024 / 1024
            print(f"   ✅ {stem}.mp3 ({size_mb:.1f} MB)")
            copied += 1
        else:
            print(f"   ⚠️  {stem}.mp3 — 源文件不存在，跳过")

    # Step 4: 汇总
    print(f"\n🎉 分轨完成!")
    print(f"   模型: {model_name}")
    print(f"   歌曲: {SONG_ID}")
    print(f"   输出: {TARGET_DIR}")
    print(f"   文件数: {copied}/{len(STEMS)}")

    print(f"\n📁 目录内容:")
    for f in sorted(os.listdir(TARGET_DIR)):
        fpath = os.path.join(TARGET_DIR, f)
        size = os.path.getsize(fpath)
        if size > 1024 * 1024:
            print(f"   {f:30s} {size/1024/1024:.1f} MB")
        else:
            print(f"   {f:30s} {size/1024:.0f} KB")


if __name__ == "__main__":
    main()
