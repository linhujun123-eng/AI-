/**
 * Auth Store — 用户登录/注册/登出状态管理
 *
 * JWT token 存 localStorage，启动时自动验证。
 */
import { create } from 'zustand';
import {
  authRegister,
  authLogin,
  authGetMe,
  setToken,
  clearToken,
  getToken,
  type AuthUser,
} from '../services/api';

interface AuthState {
  /** Current logged-in user, or null */
  user: AuthUser | null;
  /** Whether we're checking auth on startup */
  isLoading: boolean;
  /** Whether user is logged in */
  isLoggedIn: boolean;
  /** Error message from last auth attempt */
  error: string | null;

  /** Register a new account */
  register: (username: string, password: string) => Promise<void>;
  /** Login with existing account */
  login: (username: string, password: string) => Promise<void>;
  /** Logout — clear token and user */
  logout: () => void;
  /** Check auth on startup — verify token from localStorage */
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isLoggedIn: false,
  error: null,

  register: async (username, password) => {
    set({ error: null });
    try {
      const res = await authRegister(username, password);
      setToken(res.token);
      set({ user: res.user, isLoggedIn: true, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '注册失败';
      set({ error: msg });
      throw err;
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const res = await authLogin(username, password);
      setToken(res.token);
      set({ user: res.user, isLoggedIn: true, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败';
      set({ error: msg });
      throw err;
    }
  },

  logout: () => {
    clearToken();
    set({ user: null, isLoggedIn: false, error: null });
  },

  checkAuth: async () => {
    const token = getToken();
    if (!token) {
      set({ isLoading: false, user: null, isLoggedIn: false });
      return;
    }
    try {
      const user = await authGetMe();
      set({ user, isLoggedIn: true, isLoading: false });
    } catch {
      // Token expired or invalid
      clearToken();
      set({ user: null, isLoggedIn: false, isLoading: false });
    }
  },
}));
