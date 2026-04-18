# AI练习室 — Neon 视觉设计规范

> **来源**：`demo-neon.html` 静态Demo
> **确认日期**：2026-04-16
> **状态**：✅ 湖钧确认采用

---

## 1. 设计哲学

- **深空霓虹**：深黑底色 + 霓虹三色发光，营造沉浸式练习氛围
- **毛玻璃层叠**：半透明卡片 + blur，信息层次清晰
- **克制发光**：glow 只用于交互焦点和关键数据，不滥用
- **暗色优先**：适合长时间练习场景，护眼且专注

---

## 2. 色彩系统

### 2.1 基础色

| Token | 色值 | 用途 |
|---|---|---|
| `--bg` | `#0a0a12` | 页面主背景 |
| `--bg2` | `#12121f` | 次级背景/深层面板 |
| `--panel` | `rgba(255,255,255,0.04)` | 毛玻璃卡片填充 |
| `--panel-border` | `rgba(255,255,255,0.08)` | 卡片边框 |

### 2.2 强调色

| Token | 色值 | 语义 |
|---|---|---|
| `--cyan` | `#00e5ff` | 主交互色（按钮hover、AB标记、slider thumb、开放弦） |
| `--purple` | `#a855f7` | 辅助色（和弦标签、指位圆点、渐变中段） |
| `--pink` | `#ff2d95` | 高亮/警示（播放指针、闭弦标记） |
| `--grad` | `linear-gradient(135deg, cyan, purple, pink)` | 品牌渐变（播放按钮、标题文字、速度值） |

### 2.3 文字色

| Token | 色值 | 用途 |
|---|---|---|
| `--text` | `#e8e8f0` | 主文字 |
| `--text2` | `rgba(255,255,255,0.55)` | 次级文字/标签 |

### 2.4 功能色

| Token | 色值 | 用途 |
|---|---|---|
| `--ab-color` | `rgba(0,229,255,0.15)` | AB循环区域填充 |
| `--ab-border` | `rgba(0,229,255,0.5)` | AB循环边界线 |
| `--glow-cyan` | `0 0 20px rgba(0,229,255,0.35)` | Cyan 发光 |
| `--glow-pink` | `0 0 20px rgba(255,45,149,0.3)` | Pink 发光 |

---

## 3. 字体系统

| 用途 | 字体栈 | 场景 |
|---|---|---|
| UI文字 | `-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif` | 标题、正文、标签 |
| 数据/代码 | `'SF Mono', 'Fira Code', 'Consolas', monospace` | BPM、速度值、和弦名、Loop计数、时间码 |

### 字号参考

| 元素 | 桌面 | 移动端 |
|---|---|---|
| 歌名 | 18px / 600 | 15px |
| 元信息（BPM等） | 12px / mono | 12px |
| 和弦名（大字） | 48px / 700 / mono | 36px |
| AI镜子文案 | 13px | 13px |
| 按钮文字 | 13px-14px | 12px |
| 段落标签 | 11px | 11px |

---

## 4. 圆角规范

| 组件 | 圆角 |
|---|---|
| 毛玻璃卡片 | `14px` |
| 功能按钮 | `10px` |
| 胶囊按钮/Tag | `20px` |
| 波形容器 | `10px` |
| 小标签 | `4px` |
| 播放按钮 | `50%`（正圆） |

---

## 5. 卡片 / 面板

```css
.glass {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 16px;           /* 移动端 12px */
  margin-bottom: 12px;
}
```

所有主要内容区域使用此卡片样式，纵向排列，间距 12px。

---

## 6. 发光效果

### 6.1 静态 Glow
- hover 按钮：`box-shadow: 0 0 20px rgba(0,229,255,0.35)`
- 播放按钮：`box-shadow: 0 0 24px rgba(0,229,255,0.25), 0 0 24px rgba(255,45,149,0.2)`

### 6.2 动画 Glow
- **播放指针**：`cursorPulse` — opacity 在 1 ↔ 0.55 之间 1.2s 循环
- **AI镜子卡片**：`glowBreath` — box-shadow 从透明到 cyan 微光 3s 循环
- **和弦指位**：SVG `feGaussianBlur` stdDeviation=3 静态辉光

### 6.3 渐变文字
```css
background: var(--grad);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
/* 可选 drop-shadow 增强 */
filter: drop-shadow(0 0 16px rgba(0,229,255,0.25));
```

---

## 7. 背景处理

```css
/* 点阵网格 */
body::before {
  background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 28px 28px;
}
```

微弱点阵网格，增加空间感但不干扰内容。

---

## 8. 核心组件规范

### 8.1 波形区
- 容器高度：桌面 110px / 移动端 80px
- 渲染：三色渐变（cyan→purple→pink）条形图
- 镜像倒影：下半部分 opacity 0.35，高度为上半 70%
- AB循环：半透明 cyan 覆盖区 + 两侧 2px 边界线 + A/B 标签

### 8.2 播放控制
- 播放键：52px 正圆，渐变实心，双色外发光
- 传输按钮（⏮⏭）：38px 方形，透明底 + 边框
- AB 按钮：38px，mono 字体，cyan 色
- 速度预设：胶囊按钮组，active 态用品牌渐变填充
- 速度微调：±5% 按钮 + 中间大数字（22px mono 渐变）

### 8.3 和弦图
- SVG viewBox `120×140`
- 品丝：cyan 色，弦：白色低透明度（从粗到细 1.5→0.8）
- 指位圆点：purple 填充 + blur glow，白色指法编号
- 开放弦 ○：cyan / 闭弦 ✕：pink

### 8.4 AI 镜子提示
- 渐变底：`cyan 0.06 → purple 0.06`
- 边框：`cyan 0.15`
- 左侧 emoji + 文案 + 右侧关闭按钮
- 呼吸发光动画

### 8.5 分轨音量
- 横向 slider：4px 轨道 + 16px cyan 圆形 thumb + glow
- hover 时 thumb scale(1.2)

---

## 9. 响应式断点

| 断点 | 调整 |
|---|---|
| ≤ 768px | padding 收紧、字号缩小、波形高度降至 80px、和弦名 36px、speed-btn 间距/尺寸缩小 |

采用移动端优先适配，PWA 全屏体验。

---

## 10. CSS Variables 完整清单

```css
:root {
  --bg: #0a0a12;
  --bg2: #12121f;
  --panel: rgba(255,255,255,0.04);
  --panel-border: rgba(255,255,255,0.08);
  --cyan: #00e5ff;
  --purple: #a855f7;
  --pink: #ff2d95;
  --grad: linear-gradient(135deg, var(--cyan), var(--purple), var(--pink));
  --text: #e8e8f0;
  --text2: rgba(255,255,255,0.55);
  --ab-color: rgba(0,229,255,0.15);
  --ab-border: rgba(0,229,255,0.5);
  --glow-cyan: 0 0 20px rgba(0,229,255,0.35);
  --glow-pink: 0 0 20px rgba(255,45,149,0.3);
  --radius: 14px;
  --font: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
  --mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
```

---

## 附注

- Demo 源文件：`demo-neon.html`
- 后续开发直接基于此 CSS Variables 体系构建 React 组件
- Tailwind 可通过 `extend.colors` 映射这套 token
