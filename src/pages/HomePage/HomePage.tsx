import { songs } from '../../data/songs';
import { SongCard } from '../../components/HomePage/SongCard';
import { GradientText } from '../../components/common/GradientText/GradientText';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>🎸</div>
        <div>
          <GradientText as="h1" className={styles.title}>
            AI 练习室
          </GradientText>
          <p className={styles.subtitle}>选一首歌，开始练习</p>
        </div>
      </header>

      {/* Stats bar */}
      <div className={styles.stats}>
        <span className={styles.statItem}>
          <span className={styles.statNum}>{songs.length}</span> 首曲目
        </span>
        <span className={styles.statDot}>·</span>
        <span className={styles.statItem}>吉他专练</span>
        <span className={styles.statDot}>·</span>
        <span className={styles.statItem}>AB 循环 + 变速</span>
      </div>

      {/* Song list */}
      <div className={styles.list}>
        {songs.map((song) => (
          <SongCard key={song.id} song={song} />
        ))}
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>AI 练习室 MVP · Neon</p>
      </footer>
    </div>
  );
}
