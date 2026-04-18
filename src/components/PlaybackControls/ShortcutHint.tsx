import { useState } from 'react';
import styles from './ShortcutHint.module.css';

const SHORTCUTS = [
  { key: 'Space', action: '播放 / 暂停' },
  { key: '← →', action: '前进 / 后退 5 秒' },
  { key: '↑ ↓', action: '升调 / 降调 1 半音' },
  { key: 'A', action: '设置 A 点' },
  { key: 'B', action: '设置 B 点' },
  { key: 'Esc', action: '清除 AB 循环' },
  { key: '[ ]', action: '减速 / 加速 5%' },
];

export function ShortcutHint() {
  const [show, setShow] = useState(false);

  return (
    <div className={styles.container}>
      <button
        className={styles.toggle}
        onClick={() => setShow(!show)}
        title="键盘快捷键"
      >
        ⌨️ 快捷键
      </button>
      {show && (
        <div className={styles.list}>
          {SHORTCUTS.map((s) => (
            <div key={s.key} className={styles.item}>
              <kbd className={styles.key}>{s.key}</kbd>
              <span className={styles.action}>{s.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
