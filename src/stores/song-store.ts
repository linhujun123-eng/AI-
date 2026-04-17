/**
 * Song Store — 统一曲目列表（预置 + 用户上传）
 *
 * 用户上传的歌曲通过后端 API（SQLite + 文件系统）持久化。
 * 预置歌曲仍走 static path。
 */
import { create } from 'zustand';
import type { Song } from '../types/song';
import { presetSongs } from '../data/songs';
import {
  fetchSongs,
  uploadSong,
  deleteSong,
  getSongAudioUrl,
  triggerRecognition,
  fetchSongChordStatus,
  checkApiHealth,
  type ChordStatus,
} from '../services/api';

/** RecognitionStatus kept for backward compatibility with UI components */
export type RecognitionStatus = ChordStatus;

interface SongState {
  /** All songs: preset first, then user (newest first) */
  songs: Song[];
  /** Loading state for initial load */
  isLoading: boolean;
  /** Chord recognition status per song */
  chordStatus: Record<string, RecognitionStatus>;
  /** Chord recognition error message per song */
  chordError: Record<string, string | null>;
  /** Whether the backend API is available */
  chordApiAvailable: boolean | null;
  /** Load user songs from backend and merge with preset */
  loadUserSongs: () => Promise<void>;
  /** Find a song by id (from merged list) */
  getSongById: (id: string) => Song | undefined;
  /** Upload a new song: sends audio + metadata to backend */
  addUserSong: (
    song: Omit<Song, 'id' | 'source' | 'audio'> & { audio?: Song['audio'] },
    audioFile: File | Blob,
    filename?: string,
  ) => Promise<Song>;
  /** Delete a user-uploaded song */
  deleteUserSong: (id: string) => Promise<void>;
  /** Resolve the playable audio URL for a song.
   *  Preset songs return static path; user songs return backend streaming URL. */
  resolveAudioUrl: (song: Song) => string;
  /** Trigger chord recognition for a user-uploaded song (fire & forget) */
  triggerChordRecognition: (songId: string) => Promise<void>;
  /** Check if backend API is available */
  checkChordApi: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Poll helper: check chord status until done or error
// ---------------------------------------------------------------------------

function pollChordStatus(
  songId: string,
  set: (fn: (state: SongState) => Partial<SongState>) => void,
  get: () => SongState,
) {
  const INTERVAL = 2000; // 2s
  const MAX_ATTEMPTS = 60; // 2min max
  let attempts = 0;

  const tick = async () => {
    attempts++;
    try {
      const status = await fetchSongChordStatus(songId);
      set((state) => ({
        chordStatus: { ...state.chordStatus, [songId]: status },
      }));
      if (status === 'done' || status === 'error') {
        // Refresh songs list to get updated metadata
        if (status === 'done') {
          get().loadUserSongs();
        }
        return; // stop polling
      }
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tick, INTERVAL);
      }
    } catch {
      // Network error — stop polling, mark as error
      set((state) => ({
        chordStatus: { ...state.chordStatus, [songId]: 'error' },
        chordError: { ...state.chordError, [songId]: '状态查询失败' },
      }));
    }
  };

  setTimeout(tick, INTERVAL);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSongStore = create<SongState>((set, get) => ({
  songs: presetSongs,
  isLoading: true,
  chordStatus: {},
  chordError: {},
  chordApiAvailable: null,

  loadUserSongs: async () => {
    try {
      const userSongs = await fetchSongs();

      // Initialize chord status from backend data
      const statusUpdate: Record<string, RecognitionStatus> = {};
      for (const song of userSongs) {
        // Backend returns chordStatus in the song object (via API)
        // We already have it from fetchSongs → toSong, but we need to check
        // We'll re-fetch statuses from the existing chordStatus or set to idle
        const currentStatus = get().chordStatus[song.id];
        if (!currentStatus) {
          // For fresh load, we don't have chordStatus on the Song type,
          // but the API returns hasChords. Use that.
          statusUpdate[song.id] = 'idle'; // will be overridden below
        }
      }

      set((state) => ({
        songs: [...presetSongs, ...userSongs],
        isLoading: false,
        chordStatus: { ...statusUpdate, ...state.chordStatus },
      }));

      // Now fetch actual chord status for each user song from backend
      for (const song of userSongs) {
        if (!get().chordStatus[song.id] || get().chordStatus[song.id] === 'idle') {
          try {
            const status = await fetchSongChordStatus(song.id);
            set((state) => ({
              chordStatus: { ...state.chordStatus, [song.id]: status },
            }));
            // If still processing, start polling
            if (status === 'processing' || status === 'uploading') {
              pollChordStatus(song.id, set, get);
            }
          } catch {
            // Ignore — keep idle
          }
        }
      }
    } catch (err) {
      console.error('[song-store] Failed to load user songs:', err);
      set({ isLoading: false });
    }
  },

  getSongById: (id: string) => {
    return get().songs.find((s) => s.id === id);
  },

  addUserSong: async (songMeta, audioFile, filename) => {
    // Upload to backend — backend generates id, stores audio + metadata
    const song = await uploadSong(audioFile, {
      title: songMeta.title,
      artist: songMeta.artist,
      bpm: songMeta.bpm,
      key: songMeta.key,
      difficulty: songMeta.difficulty,
      duration: songMeta.duration,
      durationSec: songMeta.durationSec,
      cover: songMeta.cover,
    }, filename);

    // Refresh list
    await get().loadUserSongs();

    // Trigger chord recognition (fire & forget)
    get().triggerChordRecognition(song.id);

    return song;
  },

  deleteUserSong: async (id: string) => {
    await deleteSong(id);
    // Clean up chord status
    set((state) => {
      const { [id]: _s, ...restStatus } = state.chordStatus;
      const { [id]: _e, ...restError } = state.chordError;
      return { chordStatus: restStatus, chordError: restError };
    });
    // Refresh list
    await get().loadUserSongs();
  },

  resolveAudioUrl: (song: Song) => {
    if (song.source === 'preset') {
      return song.audio.mix;
    }
    // User song: stream from backend
    return getSongAudioUrl(song.id);
  },

  triggerChordRecognition: async (songId: string) => {
    const currentStatus = get().chordStatus[songId];
    // Don't re-trigger if already processing or done
    if (currentStatus === 'processing' || currentStatus === 'uploading' || currentStatus === 'done') {
      return;
    }

    set((state) => ({
      chordStatus: { ...state.chordStatus, [songId]: 'processing' },
      chordError: { ...state.chordError, [songId]: null },
    }));

    try {
      await triggerRecognition(songId);
      // Start polling for completion
      pollChordStatus(songId, set, get);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '和弦识别失败';
      set((state) => ({
        chordStatus: { ...state.chordStatus, [songId]: 'error' },
        chordError: { ...state.chordError, [songId]: msg },
      }));
    }
  },

  checkChordApi: async () => {
    const available = await checkApiHealth();
    set({ chordApiAvailable: available });
    return available;
  },
}));
