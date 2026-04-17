import { useNavigate } from 'react-router-dom';
import type { Song } from '../../types/song';
import { GlassPanel } from '../common/GlassPanel/GlassPanel';
import { GradientText } from '../common/GradientText/GradientText';
import styles from './SongCard.module.css';

interface SongCardProps {
  song: Song;
}

const difficultyStars = (level: number) => '★'.repeat(level) + '☆'.repeat(3 - level);

export function SongCard({ song }: SongCardProps) {
  const navigate = useNavigate();

  return (
    <GlassPanel className={styles.card}>
      <button
        className={styles.inner}
        onClick={() => navigate(`/practice/${song.id}`)}
      >
        {/* Cover Emoji */}
        <div className={styles.cover}>
          <span className={styles.emoji}>{song.cover}</span>
        </div>

        {/* Info */}
        <div className={styles.info}>
          <GradientText as="h3" className={styles.title}>
            {song.title}
          </GradientText>
          <p className={styles.artist}>{song.artist}</p>
          <div className={styles.meta}>
            <span className={styles.tag}>BPM {song.bpm}</span>
            <span className={styles.tag}>{song.key}</span>
            <span className={styles.tag}>{song.duration}</span>
          </div>
        </div>

        {/* Right side */}
        <div className={styles.right}>
          <span className={styles.difficulty}>{difficultyStars(song.difficulty)}</span>
          <span className={styles.chords}>{song.chords}</span>
          <span className={styles.arrow}>→</span>
        </div>
      </button>
    </GlassPanel>
  );
}
