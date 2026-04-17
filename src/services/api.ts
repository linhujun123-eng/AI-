/**
 * API 服务层 — 与后端 Python FastAPI 通信
 *
 * 替代原来的 IndexedDB 直接操作，所有数据持久化由后端负责。
 * 开发环境通过 Vite proxy 转发 /api → localhost:8000
 */

import type { Song } from '../types/song';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Backend song response (superset of frontend Song type) */
export interface ApiSong {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
  difficulty: number | null;
  duration: string | null;
  durationSec: number | null;
  cover: string | null;
  source: string;
  createdAt: number;
  chordStatus: string;
  hasChords: boolean;
  audio: {
    mix: string;
    hasStem: boolean;
  };
}

export interface ChordEvent {
  time: number;
  chord: string;
}

export type ChordStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

// ---------------------------------------------------------------------------
// Token management (localStorage)
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'ai-practice-room-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Auto-inject Authorization header if token exists
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

/** Convert ApiSong → frontend Song type */
function toSong(api: ApiSong): Song {
  return {
    id: api.id,
    title: api.title,
    artist: api.artist,
    bpm: api.bpm ?? undefined,
    key: api.key ?? undefined,
    difficulty: api.difficulty ?? undefined,
    duration: api.duration ?? undefined,
    durationSec: api.durationSec ?? undefined,
    cover: api.cover ?? '🎵',
    source: api.source as 'preset' | 'user',
    createdAt: api.createdAt,
    audio: {
      mix: api.audio.mix,
      hasStem: api.audio.hasStem,
    },
  };
}

// ---------------------------------------------------------------------------
// Song CRUD
// ---------------------------------------------------------------------------

/** Get all user-uploaded songs from the backend */
export async function fetchSongs(): Promise<Song[]> {
  const list = await apiFetch<ApiSong[]>('/songs');
  return list.map(toSong);
}

/** Get a single song by ID */
export async function fetchSong(id: string): Promise<Song> {
  const api = await apiFetch<ApiSong>(`/songs/${id}`);
  return toSong(api);
}

/** Upload a new song (audio file + metadata) */
export async function uploadSong(
  file: File | Blob,
  metadata: {
    title: string;
    artist?: string;
    bpm?: number;
    key?: string;
    difficulty?: number;
    duration?: string;
    durationSec?: number;
    cover?: string;
  },
  filename?: string,
): Promise<Song> {
  const form = new FormData();
  form.append('file', file, filename ?? (file instanceof File ? file.name : 'audio.mp3'));
  form.append('title', metadata.title);
  if (metadata.artist) form.append('artist', metadata.artist);
  if (metadata.bpm != null) form.append('bpm', String(metadata.bpm));
  if (metadata.key) form.append('key', metadata.key);
  if (metadata.difficulty != null) form.append('difficulty', String(metadata.difficulty));
  if (metadata.duration) form.append('duration', metadata.duration);
  if (metadata.durationSec != null) form.append('duration_sec', String(metadata.durationSec));
  if (metadata.cover) form.append('cover', metadata.cover);

  const token = getToken();
  const res = await fetch(`${API_BASE}/songs`, {
    method: 'POST',
    body: form,
    headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    let detail = `上传失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  const api: ApiSong = await res.json();
  return toSong(api);
}

/** Delete a song */
export async function deleteSong(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/songs/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Audio URL
// ---------------------------------------------------------------------------

/** Get the audio URL for a song.
 *  Backend songs use /api/songs/{id}/audio (direct streaming, no objectURL needed). */
export function getSongAudioUrl(songId: string): string {
  return `${API_BASE}/songs/${songId}/audio`;
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

/** Fetch chord data for a song from the backend */
export async function fetchChords(songId: string): Promise<ChordEvent[]> {
  const data = await apiFetch<{ chords: ChordEvent[] }>(`/songs/${songId}/chords`);
  return data.chords;
}

/** Trigger chord recognition for an uploaded song (async, returns immediately) */
export async function triggerRecognition(songId: string): Promise<'started' | 'already_processing'> {
  const data = await apiFetch<{ status: string }>(`/songs/${songId}/recognize`, {
    method: 'POST',
  });
  return data.status as 'started' | 'already_processing';
}

/** Get the current chord status for a song */
export async function fetchSongChordStatus(songId: string): Promise<ChordStatus> {
  const api = await apiFetch<ApiSong>(`/songs/${songId}`);
  return api.chordStatus as ChordStatus;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Register a new user */
export async function authRegister(username: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** Login with username + password */
export async function authLogin(username: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** Get current user info from JWT */
export async function authGetMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me');
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Check if the backend API is available */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
