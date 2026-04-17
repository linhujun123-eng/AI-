import { useNavigate } from 'react-router-dom';
import type { Song } from '../../types/song';
import styles from './TopBar.module.css';

interface TopBarProps {
  song: Song;
}

export function TopBar({ song }: TopBarProps) {
  const navigate = useNavigate();

  return (
    <header className={styles.bar}>
      <button className={styles.back} onClick={() => navigate('/')}>
        ←
      </button>
      <div className={styles.info}>
        <span className={styles.emoji}>{song.cover || '🎵'}</span>
        <div>
          <h1 className={styles.title}>{song.title}</h1>
          <p className={styles.meta}>
            {song.artist}
            {song.bpm ? ` · BPM ${song.bpm}` : ''}
            {song.key ? ` · ${song.key}` : ''}
          </p>
        </div>
      </div>
      <div className={styles.spacer} />
    </header>
  );
}
