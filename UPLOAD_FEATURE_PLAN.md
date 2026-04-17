# 歌曲上传功能 — 需求与实现计划

> 🕐 创建：2026-04-17 19:08 | 最后更新：2026-04-17 19:08

---

## 一、功能定位

让用户可以上传自己的歌曲进行练习，从"预置曲库"走向"用户自主内容"。

---

## 二、核心需求（按优先级排序）

### P0 — 必做

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 1 | **本地音频上传** | 用户选择本地 mp3/wav/flac/m4a 文件 | ⬜ 开发中 |
| 2 | **持久化存储** | IndexedDB 存储音频 Blob + 元数据，刷新不丢 | ⬜ |
| 3 | **基础元信息填写** | 歌名、艺术家（必填），BPM/调式/难度（可选） | ⬜ |
| 4 | **混合曲目列表** | 首页同时展示预置曲 + 用户上传曲 | ⬜ |
| 5 | **播放适配** | 用户曲目能正常进入练习页播放（objectURL） | ⬜ |
| 6 | **曲目删除** | 用户可删除自己上传的曲目 | ⬜ |

### P1 — 增强

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 7 | **ID3 元数据自动提取** | 从文件 tag 自动填充歌名/艺术家/时长/封面 | ⬜ |
| 8 | **自动 BPM 检测** | Web Audio API 粗略检测 | ⬜ |
| 9 | **自动和弦识别** | 上传后自动生成 chords（需后端或 WASM） | ⬜ |

### P2 — 未来

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 10 | **云端分轨** | 上传后调 Demucs API 生成分轨 | ⬜ |
| 11 | **曲目编辑** | 修改已上传曲目的元信息 | ⬜ |

---

## 三、技术方案

### 3.1 存储：IndexedDB（纯前端，零后端）

```
IndexedDB: "ai-practice-room"
├── Store: "user-songs"     → Song 元数据（含 source: 'user'）
├── Store: "audio-files"    → Blob 音频文件（key = songId）
└── Store: "chord-data"     → 用户曲的 chords.json（key = songId）
```

### 3.2 Song 类型扩展

```typescript
export interface Song {
  // ...现有字段
  source: 'preset' | 'user';       // 来源标识
  createdAt?: number;               // 上传时间戳
}
```

### 3.3 数据流

- 预置曲目：`data/songs.ts` → 静态 URL (`/audio/xxx/mix.mp3`)
- 用户曲目：IndexedDB → `URL.createObjectURL(blob)` → WaveSurfer

### 3.4 首页整合

```
首页曲目列表
├── [+ 上传歌曲] 入口卡片（列表末尾）
├── 📌 预置曲目（标 "预置" 标签）
└── 🎵 用户上传曲目（按上传时间倒序）
```

---

## 四、开发子任务（逐个实现，每步确认）

| # | 子任务 | 新增/改动文件 | 状态 |
|---|--------|-------------|------|
| 1 | **IndexedDB 服务层** | `services/db.ts` | ⬜ |
| 2 | **Song 类型扩展 + song-store** | `types/song.ts`, `stores/song-store.ts` | ⬜ |
| 3 | **上传 Modal UI + 文件选择** | `components/UploadModal/` | ⬜ |
| 4 | **首页接入 song-store + 上传入口** | `HomePage.tsx`, `UploadCard.tsx` | ⬜ |
| 5 | **音频 URL 解析 + PracticePage 适配** | `hooks/useAudioUrl.ts`, `PracticePage.tsx` | ⬜ |
| 6 | **曲目删除** | song-store + UI | ⬜ |
| 7 | **ID3 自动提取**（P1） | `utils/id3-parse.ts` | ⬜ |

---

*每完成一个子任务，build 验证后更新状态，与湖钧确认后再做下一个。*
