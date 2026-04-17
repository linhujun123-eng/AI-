/**
 * UploadModal — 歌曲上传弹窗
 *
 * 功能：文件拖拽/选择 + 元信息表单（歌名、艺术家必填，BPM/调式/难度可选）
 */
import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { useSongStore } from '../../stores/song-store';
import styles from './UploadModal.module.css';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
}

const ACCEPTED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg'];
const ACCEPTED_EXT = '.mp3,.wav,.flac,.m4a,.aac,.ogg';
const MAX_SIZE_MB = 50;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get audio duration from a blob */
function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取音频时长'));
    });
    audio.src = url;
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function UploadModal({ open, onClose }: UploadModalProps) {
  const addUserSong = useSongStore((s) => s.addUserSong);

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState('');
  const [songKey, setSongKey] = useState('');
  const [difficulty, setDifficulty] = useState(1);

  // Submitting state
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setFile(null);
    setAudioDuration(null);
    setTitle('');
    setArtist('');
    setBpm('');
    setSongKey('');
    setDifficulty(1);
    setError(null);
    setDragOver(false);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const validateAndSetFile = useCallback(async (f: File) => {
    setError(null);

    // Check type
    if (!ACCEPTED_TYPES.includes(f.type) && !f.name.match(/\.(mp3|wav|flac|m4a|aac|ogg)$/i)) {
      setError(`不支持的格式：${f.type || f.name.split('.').pop()}。请上传 MP3、WAV、FLAC、M4A 格式。`);
      return;
    }

    // Check size
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`文件太大（${formatFileSize(f.size)}），最大支持 ${MAX_SIZE_MB}MB。`);
      return;
    }

    setFile(f);

    // Auto-fill title from filename (fallback)
    const nameWithoutExt = f.name.replace(/\.[^/.]+$/, '');
    if (!title) setTitle(nameWithoutExt);

    // Extract ID3/metadata tags
    try {
      const { parseBlob } = await import('music-metadata');
      const metadata = await parseBlob(f);
      const { common, format } = metadata;

      // Auto-fill fields from tags (only if user hasn't typed something)
      if (common.title && !title) setTitle(common.title);
      if (common.artist && !artist) setArtist(common.artist);
      if (common.bpm && !bpm) setBpm(String(Math.round(common.bpm)));

      // Duration from metadata (more reliable than Audio element for some formats)
      if (format.duration) {
        setAudioDuration(format.duration);
      }
    } catch {
      // ID3 extraction is best-effort; fall through to Audio element duration
    }

    // Get duration via Audio element (fallback if metadata didn't have it)
    if (!audioDuration) {
      try {
        const dur = await getAudioDuration(f);
        setAudioDuration(dur);
      } catch {
        // Non-fatal: duration is optional
      }
    }
  }, [title, artist, bpm, audioDuration]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) validateAndSetFile(f);
  }, [validateAndSetFile]);

  const handleFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) validateAndSetFile(f);
  }, [validateAndSetFile]);

  const handleSubmit = useCallback(async () => {
    if (!file) return;
    if (!title.trim()) {
      setError('请输入歌曲名称');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Upload to backend — backend generates id, stores audio, triggers chord recognition
      await addUserSong(
        {
          title: title.trim(),
          artist: artist.trim() || '未知艺术家',
          cover: '🎵',
          ...(bpm ? { bpm: parseInt(bpm, 10) } : {}),
          ...(songKey ? { key: songKey } : {}),
          ...(audioDuration != null ? {
            duration: formatDuration(audioDuration),
            durationSec: Math.round(audioDuration),
          } : {}),
          difficulty,
        },
        file,
        file.name,
      );

      handleClose();
    } catch (err) {
      setError(`上传失败：${err instanceof Error ? err.message : '未知错误'}`);
      setSubmitting(false);
    }
  }, [file, title, artist, bpm, songKey, difficulty, audioDuration, addUserSong, handleClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>上传歌曲</h2>
          <button className={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>

        {/* Drop zone / File info */}
        {!file ? (
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={styles.dropIcon}>🎵</div>
            <p className={styles.dropText}>拖拽音频文件到这里</p>
            <p className={styles.dropSub}>或点击选择文件</p>
            <p className={styles.dropFormats}>MP3 · WAV · FLAC · M4A · 最大 {MAX_SIZE_MB}MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXT}
              className={styles.fileInput}
              onChange={handleFileInput}
            />
          </div>
        ) : (
          <div className={styles.fileInfo}>
            <div className={styles.fileIcon}>🎶</div>
            <div className={styles.fileDetails}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileMeta}>
                {formatFileSize(file.size)}
                {audioDuration != null && ` · ${formatDuration(audioDuration)}`}
              </p>
            </div>
            <button className={styles.removeFile} onClick={() => { setFile(null); setAudioDuration(null); }}>
              ✕
            </button>
          </div>
        )}

        {/* Error */}
        {error && <div className={styles.error}>{error}</div>}

        {/* Form (show after file selected) */}
        {file && (
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>歌曲名称 *</label>
              <input
                className={styles.input}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入歌曲名称"
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>艺术家</label>
              <input
                className={styles.input}
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="输入艺术家名称"
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>BPM</label>
                <input
                  className={styles.input}
                  type="number"
                  value={bpm}
                  onChange={(e) => setBpm(e.target.value)}
                  placeholder="例如 120"
                  min="30"
                  max="300"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>调式</label>
                <input
                  className={styles.input}
                  type="text"
                  value={songKey}
                  onChange={(e) => setSongKey(e.target.value)}
                  placeholder="例如 C, Am"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>难度</label>
                <div className={styles.difficultyPicker}>
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      className={`${styles.diffBtn} ${difficulty === d ? styles.diffActive : ''}`}
                      onClick={() => setDifficulty(d)}
                    >
                      {'★'.repeat(d)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        {file && (
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={handleClose} disabled={submitting}>
              取消
            </button>
            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
            >
              {submitting ? '上传中...' : '确认上传'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
