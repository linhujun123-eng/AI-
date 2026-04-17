import { useState, useCallback, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Song } from '../../types/song';
import { useSongStore } from '../../stores/song-store';
import { GlassPanel } from '../common/GlassPanel/GlassPanel';
import { GradientText } from '../common/GradientText/GradientText';
import styles from './SongCard.module.css';

interface SongCardProps {
  song: Song;
}

const difficultyStars = (level: number) => '★'.repeat(level) + '☆'.repeat(3 - level);

/** Chord status badge for user-uploaded songs */
function ChordBadge({ songId }: { songId: string }) {
  const status = useSongStore((s) => s.chordStatus[songId]);
  const error = useSongStore((s) => s.chordError[songId]);
  const triggerRecognition = useSongStore((s) => s.triggerChordRecognition);
  const apiAvailable = useSongStore((s) => s.chordApiAvailable);

  if (!status || status === 'idle') {
    // No chord data yet, show nothing or a hint
    return null;
  }

  if (status === 'uploading' || status === 'processing') {
    return (
      <span className={`${styles.chordBadge} ${styles.chordProcessing}`}>
        <span className={styles.spinner} />
        和弦识别中…
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span className={`${styles.chordBadge} ${styles.chordDone}`}>
        ✓ 和弦已识别
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        className={`${styles.chordBadge} ${styles.chordError}`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (apiAvailable) triggerRecognition(songId);
        }}
        title={error || '和弦识别失败'}
      >
        ✕ 识别失败 · 点击重试
      </span>
    );
  }

  return null;
}

export function SongCard({ song }: SongCardProps) {
  const navigate = useNavigate();
  const deleteSong = useSongStore((s) => s.deleteUserSong);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeleting(true);
    try {
      await deleteSong(song.id);
    } catch (err) {
      console.error('[SongCard] Delete failed:', err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [deleteSong, song.id]);

  const handleCancelDelete = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDelete(false);
  }, []);

  // Build meta tags — only show fields that exist
  const metaTags: string[] = [];
  if (song.bpm) metaTags.push(`BPM ${song.bpm}`);
  if (song.key) metaTags.push(song.key);
  if (song.duration) metaTags.push(song.duration);
  if (song.source === 'user' && !metaTags.length) metaTags.push('自定义');

  return (
    <GlassPanel className={styles.card}>
      <button
        className={styles.inner}
        onClick={() => navigate(`/practice/${song.id}`)}
      >
        {/* Cover Emoji */}
        <div className={styles.cover}>
          <span className={styles.emoji}>{song.cover || '🎵'}</span>
        </div>

        {/* Info */}
        <div className={styles.info}>
          <GradientText as="h3" className={styles.title}>
            {song.title}
          </GradientText>
          <p className={styles.artist}>{song.artist}</p>
          {metaTags.length > 0 && (
            <div className={styles.meta}>
              {metaTags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
          {song.source === 'user' && <ChordBadge songId={song.id} />}
        </div>

        {/* Right side */}
        <div className={styles.right}>
          {song.difficulty != null && (
            <span className={styles.difficulty}>{difficultyStars(song.difficulty)}</span>
          )}
          {song.chords && (
            <span className={styles.chords}>{song.chords}</span>
          )}
          <span className={styles.arrow}>→</span>
        </div>

        {/* Delete button — user songs only */}
        {song.source === 'user' && !confirmDelete && (
          <button
            className={styles.deleteBtn}
            onClick={handleDelete}
            aria-label="删除歌曲"
          >
            ✕
          </button>
        )}

        {/* Delete confirmation overlay */}
        {song.source === 'user' && confirmDelete && (
          <div className={styles.deleteConfirm} onClick={(e) => e.stopPropagation()}>
            <span className={styles.deleteText}>
              {deleting ? '删除中...' : '确认删除？'}
            </span>
            {!deleting && (
              <div className={styles.deleteActions}>
                <button className={styles.confirmYes} onClick={handleConfirmDelete}>
                  删除
                </button>
                <button className={styles.confirmNo} onClick={handleCancelDelete}>
                  取消
                </button>
              </div>
            )}
          </div>
        )}
      </button>
    </GlassPanel>
  );
}
