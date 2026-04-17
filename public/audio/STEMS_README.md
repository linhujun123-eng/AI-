# 分轨音频文件说明

## 目录结构

每首歌的音频目录下应包含以下文件：

```
/audio/{songId}/
├── mix.mp3          # 混合音频（必须）
├── chords.json      # 和弦时间轴（必须）
├── vocals.mp3       # 人声分轨
├── guitar.mp3       # 吉他分轨
├── piano.mp3        # 钢琴分轨
├── drums.mp3        # 架子鼓分轨
├── bass.mp3         # Bass分轨
└── other.mp3        # 其他乐器分轨
```

## 生成方式

使用 Demucs htdemucs_6s 对 mix.mp3 进行 6 轨分离：

```bash
# 安装
pip install demucs

# 6 轨分离（htdemucs_6s：vocals, drums, bass, guitar, piano, other）
python3 scripts/separate_stems.py qingtian
```

## 注意

- 所有分轨文件的时长必须与 mix.mp3 完全一致
- 格式统一为 MP3（192kbps）
- 如果某个分轨不存在，系统会自动创建静音轨，不影响使用
- 6 轨命名与 Demucs htdemucs_6s 输出完全一致，无需额外映射
