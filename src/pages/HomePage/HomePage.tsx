import { useEffect, useState } from 'react';
import { useSongStore } from '../../stores/song-store';
import { useAuthStore } from '../../stores/auth-store';
import { SongCard } from '../../components/HomePage/SongCard';
import { GradientText } from '../../components/common/GradientText/GradientText';
import { GlassPanel } from '../../components/common/GlassPanel/GlassPanel';
import { UploadModal } from '../../components/UploadModal/UploadModal';
import { AuthModal } from '../../components/AuthModal/AuthModal';
import styles from './HomePage.module.css';

export function HomePage() {
  const songs = useSongStore((s) => s.songs);
  const isLoading = useSongStore((s) => s.isLoading);
  const loadUserSongs = useSongStore((s) => s.loadUserSongs);
  const checkChordApi = useSongStore((s) => s.checkChordApi);

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.isLoading);
  const logout = useAuthStore((s) => s.logout);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Load user songs when auth state changes
  useEffect(() => {
    if (!authLoading) {
      loadUserSongs();
      checkChordApi();
    }
  }, [authLoading, isLoggedIn, loadUserSongs, checkChordApi]);

  // Separate preset and user songs for display
  const presetSongs = songs.filter((s) => s.source === 'preset');
  const userSongs = songs.filter((s) => s.source === 'user');

  const handleUploadClick = () => {
    if (isLoggedIn) {
      setUploadOpen(true);
    } else {
      setAuthOpen(true);
    }
  };

  const handleAuthSuccess = () => {
    // After login/register, reload user songs
    loadUserSongs();
  };

  const handleLogout = () => {
    logout();
    // Reload to clear user songs
    loadUserSongs();
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>🎸</div>
          <div>
            <GradientText as="h1" className={styles.title}>
              AI 练习室
            </GradientText>
            <p className={styles.subtitle}>选一首歌，开始练习</p>
          </div>
        </div>

        {/* Auth area */}
        <div className={styles.authArea}>
          {authLoading ? null : isLoggedIn ? (
            <div className={styles.userInfo}>
              <span className={styles.username}>{user?.username}</span>
              <button className={styles.logoutBtn} onClick={handleLogout}>
                登出
              </button>
            </div>
          ) : (
            <button className={styles.loginBtn} onClick={() => setAuthOpen(true)}>
              登录
            </button>
          )}
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
        {isLoading ? (
          <div className={styles.loading}>加载中...</div>
        ) : (
          <>
            {/* User uploaded songs first (newest first) */}
            {userSongs.length > 0 && (
              <>
                <div className={styles.sectionLabel}>我的上传</div>
                {userSongs.map((song) => (
                  <SongCard key={song.id} song={song} />
                ))}
              </>
            )}

            {/* Preset songs */}
            {userSongs.length > 0 && (
              <div className={styles.sectionLabel}>预置曲目</div>
            )}
            {presetSongs.map((song) => (
              <SongCard key={song.id} song={song} />
            ))}

            {/* Upload entry card */}
            <GlassPanel className={styles.uploadCard}>
              <button className={styles.uploadInner} onClick={handleUploadClick}>
                <div className={styles.uploadIcon}>＋</div>
                <div className={styles.uploadText}>
                  <span className={styles.uploadTitle}>上传歌曲</span>
                  <span className={styles.uploadSub}>
                    {isLoggedIn ? '添加自己的音乐来练习' : '登录后上传自己的音乐'}
                  </span>
                </div>
              </button>
            </GlassPanel>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>AI 练习室 MVP · Neon</p>
      </footer>

      {/* Modals */}
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={handleAuthSuccess} />
    </div>
  );
}
