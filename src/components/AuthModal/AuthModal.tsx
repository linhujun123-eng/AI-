/**
 * AuthModal — 登录/注册弹窗
 *
 * Neon 风格，用户名+密码表单，支持登录/注册切换。
 */
import { useState, useCallback, type FormEvent } from 'react';
import { useAuthStore } from '../../stores/auth-store';
import styles from './AuthModal.module.css';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** Callback after successful login/register */
  onSuccess?: () => void;
}

type Mode = 'login' | 'register';

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const storeError = useAuthStore((s) => s.error);

  const error = localError || storeError;

  const resetForm = useCallback(() => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setLocalError(null);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const switchMode = useCallback((newMode: Mode) => {
    setMode(newMode);
    setLocalError(null);
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setLocalError('请输入用户名');
      return;
    }
    if (trimmedUsername.length < 2) {
      setLocalError('用户名至少 2 个字符');
      return;
    }
    if (password.length < 6) {
      setLocalError('密码至少 6 个字符');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setLocalError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(trimmedUsername, password);
      } else {
        await register(trimmedUsername, password);
      }
      resetForm();
      onSuccess?.();
      onClose();
    } catch {
      // error is set in store
      setSubmitting(false);
    }
  }, [username, password, confirmPassword, mode, login, register, resetForm, onSuccess, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            {mode === 'login' ? '登录' : '注册'}
          </h2>
          <button className={styles.closeBtn} onClick={handleClose}>✕</button>
        </div>

        {/* Form */}
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>用户名</label>
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              autoFocus
              autoComplete="username"
              maxLength={30}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>密码</label>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码（至少 6 位）"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div className={styles.field}>
              <label className={styles.label}>确认密码</label>
              <input
                className={styles.input}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                autoComplete="new-password"
              />
            </div>
          )}

          {/* Error */}
          {error && <div className={styles.error}>{error}</div>}

          {/* Submit */}
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting}
          >
            {submitting
              ? (mode === 'login' ? '登录中...' : '注册中...')
              : (mode === 'login' ? '登录' : '注册')
            }
          </button>
        </form>

        {/* Switch mode */}
        <div className={styles.switchRow}>
          {mode === 'login' ? (
            <span>
              没有账号？
              <button className={styles.switchBtn} onClick={() => switchMode('register')}>
                立即注册
              </button>
            </span>
          ) : (
            <span>
              已有账号？
              <button className={styles.switchBtn} onClick={() => switchMode('login')}>
                去登录
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
