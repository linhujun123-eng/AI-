#!/usr/bin/env python3
from __future__ import annotations
"""
AI 练习室 — 后端 API 服务

提供用户认证 + 歌曲 CRUD + 和弦识别，数据持久化到 SQLite + 文件系统。

启动方式：
  python3 scripts/chord_api.py

目录结构：
  data/
    practice-room.db     — SQLite 数据库（用户 + 歌曲元数据）
    audio/{songId}.ext   — 音频文件
    chords/{songId}.json — 和弦 JSON
    stems/{songId}/      — 分轨音频（vocals/guitar/piano/drums/bass/other.mp3）
    lyrics/{songId}.json — 歌词 JSON

API:
  POST   /api/auth/register      — 注册（用户名+密码）
  POST   /api/auth/login         — 登录
  GET    /api/auth/me            — 当前用户信息
  POST   /api/songs              — 上传歌曲（需登录）
  GET    /api/songs              — 获取当前用户的歌曲列表（需登录）
  GET    /api/songs/{id}         — 获取单曲详情
  DELETE /api/songs/{id}         — 删除歌曲（需登录，仅限自己的）
  GET    /api/songs/{id}/audio   — 流式返回音频
  GET    /api/songs/{id}/chords  — 获取和弦数据
  GET    /api/songs/{id}/lyrics  — 获取歌词数据
  POST   /api/songs/{id}/lyrics  — 上传 LRC 歌词文件
  POST   /api/chords             — 上传音频识别和弦（独立，不关联歌曲）
  POST   /api/songs/{id}/recognize — 触发已上传歌曲的和弦识别
  POST   /api/songs/{id}/separate  — 触发 Demucs 分轨
  GET    /api/songs/{id}/stems/{stem} — 流式返回分轨音频
  GET    /api/health             — 健康检查
"""

import os
import sys
import json
import re
import time
import sqlite3
import tempfile
import traceback
import shutil
import uuid
import asyncio
import threading
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

import bcrypt
import jwt as pyjwt
import requests as http_requests

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

# OpenCC for Traditional → Simplified Chinese conversion (lyrics)
try:
    from opencc import OpenCC
    _opencc_t2s = OpenCC('t2s')
    def _to_simplified(text: str) -> str:
        return _opencc_t2s.convert(text)
except ImportError:
    print("⚠️  opencc not installed — lyrics will not be converted to simplified Chinese")
    print("   Install with: pip install opencc-python-reimplemented")
    def _to_simplified(text: str) -> str:
        return text

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

# Import chord extraction — CREMA deep learning model (replaces v4 template matching)
sys.path.insert(0, str(Path(__file__).parent))
from extract_chords_crema import extract_chords

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# data/ lives next to scripts/ (i.e. workspace root / data/)
DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DATA_DIR / "practice-room.db"
AUDIO_DIR = DATA_DIR / "audio"
CHORDS_DIR = DATA_DIR / "chords"

STEMS_DIR = DATA_DIR / "stems"
LYRICS_DIR = DATA_DIR / "lyrics"

SUPPORTED_EXTENSIONS = {'.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.mp4'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# Demucs stem separation
STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]
DEMUCS_MODEL = "htdemucs_6s"

# JWT config — in production use a proper secret from env
JWT_SECRET = os.environ.get("JWT_SECRET", "ai-practice-room-dev-secret-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

# ---------------------------------------------------------------------------
# Concurrency control — prevent CPU/memory explosion from parallel heavy tasks
# ---------------------------------------------------------------------------

# threading.Semaphore because BackgroundTasks run in a thread pool, not asyncio
_chord_semaphore = threading.Semaphore(1)   # max 1 concurrent CREMA inference
_stem_semaphore = threading.Semaphore(1)    # max 1 concurrent Demucs separation

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _ensure_dirs():
    """Create data directories if they don't exist."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    CHORDS_DIR.mkdir(parents=True, exist_ok=True)
    STEMS_DIR.mkdir(parents=True, exist_ok=True)
    LYRICS_DIR.mkdir(parents=True, exist_ok=True)


def _init_db():
    """Initialize SQLite database and create tables."""
    _ensure_dirs()
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    # Users table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id           TEXT PRIMARY KEY,
            username     TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        )
    """)
    # Songs table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS songs (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            artist       TEXT NOT NULL DEFAULT '未知艺术家',
            bpm          INTEGER,
            key          TEXT,
            difficulty   INTEGER DEFAULT 1,
            duration     TEXT,
            duration_sec REAL,
            cover        TEXT DEFAULT '🎵',
            source       TEXT NOT NULL DEFAULT 'user',
            audio_ext    TEXT NOT NULL DEFAULT '.mp3',
            chord_status TEXT NOT NULL DEFAULT 'idle',
            stem_status  TEXT NOT NULL DEFAULT 'idle',
            has_lyrics   INTEGER NOT NULL DEFAULT 0,
            lyrics_status TEXT NOT NULL DEFAULT 'idle',
            created_at   INTEGER NOT NULL,
            user_id      TEXT REFERENCES users(id)
        )
    """)
    # Migration: add user_id column if missing (existing DB)
    try:
        conn.execute("SELECT user_id FROM songs LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE songs ADD COLUMN user_id TEXT REFERENCES users(id)")
        print("📀 Migrated songs table: added user_id column")
    # Migration: add stem_status column if missing (existing DB)
    try:
        conn.execute("SELECT stem_status FROM songs LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE songs ADD COLUMN stem_status TEXT NOT NULL DEFAULT 'idle'")
        print("📀 Migrated songs table: added stem_status column")
    # Migration: add lyrics columns if missing (existing DB)
    try:
        conn.execute("SELECT has_lyrics FROM songs LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE songs ADD COLUMN has_lyrics INTEGER NOT NULL DEFAULT 0")
        print("📀 Migrated songs table: added has_lyrics column")
    try:
        conn.execute("SELECT lyrics_status FROM songs LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE songs ADD COLUMN lyrics_status TEXT NOT NULL DEFAULT 'idle'")
        print("📀 Migrated songs table: added lyrics_status column")
    conn.commit()
    conn.close()
    print(f"📀 Database ready: {DB_PATH}")


@contextmanager
def get_db():
    """Context manager for DB connections."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _row_to_song(row: sqlite3.Row) -> dict:
    """Convert a DB row to a Song-like dict for the frontend."""
    d = dict(row)
    # Check if chord file exists
    chord_file = CHORDS_DIR / f"{d['id']}.json"
    has_chords = chord_file.exists()

    # Check stem status — hasStem is true only when separation is done
    stem_status = d.get("stem_status", "idle")
    has_stem = stem_status == "done"

    # Lyrics status
    has_lyrics = bool(d.get("has_lyrics", 0))
    lyrics_status = d.get("lyrics_status", "idle")

    return {
        "id": d["id"],
        "title": d["title"],
        "artist": d["artist"],
        "bpm": d["bpm"],
        "key": d["key"],
        "difficulty": d["difficulty"],
        "duration": d["duration"],
        "durationSec": d["duration_sec"],
        "cover": d["cover"],
        "source": d["source"],
        "createdAt": d["created_at"],
        "chordStatus": d["chord_status"],
        "stemStatus": stem_status,
        "hasChords": has_chords,
        "hasLyrics": has_lyrics,
        "lyricsStatus": lyrics_status,
        "audio": {
            "mix": f"/api/songs/{d['id']}/audio",
            "hasStem": has_stem,
        },
    }


def _generate_song_id(filename: str) -> str:
    """Generate a unique song ID from filename + timestamp."""
    import re
    base = Path(filename).stem
    base = re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff]', '-', base)
    base = re.sub(r'-+', '-', base).strip('-')[:40]
    ts = hex(int(time.time() * 1000))[2:]  # ms timestamp in hex
    return f"user-{base}-{ts}"


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    """Hash a password with bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def _verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def _create_token(user_id: str, username: str) -> str:
    """Create a JWT token for a user."""
    payload = {
        "sub": user_id,
        "username": username,
        "exp": int(time.time()) + JWT_EXPIRE_DAYS * 86400,
        "iat": int(time.time()),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and verify a JWT token. Raises on invalid/expired."""
    return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def _get_user_id_from_request(request: Request) -> Optional[str]:
    """Extract user_id from Authorization header. Returns None if not authenticated."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        payload = _decode_token(token)
        return payload.get("sub")
    except (pyjwt.ExpiredSignatureError, pyjwt.InvalidTokenError):
        return None


def _require_user(request: Request) -> str:
    """Extract user_id from request, raise 401 if not authenticated."""
    user_id = _get_user_id_from_request(request)
    if not user_id:
        raise HTTPException(401, "未登录，请先登录")
    return user_id

# ---------------------------------------------------------------------------
# Startup recovery — reset tasks stuck in processing (from previous crash)
# ---------------------------------------------------------------------------

def _recover_stuck_tasks():
    """Reset songs stuck in 'processing'/'uploading' status from a previous crash.
    Called once at startup. These tasks were interrupted and will never complete."""
    with get_db() as conn:
        # Chord recognition: processing/uploading → idle (user can re-trigger)
        stuck_chords = conn.execute(
            "SELECT id, title FROM songs WHERE chord_status IN ('processing', 'uploading')"
        ).fetchall()
        if stuck_chords:
            conn.execute(
                "UPDATE songs SET chord_status = 'idle' WHERE chord_status IN ('processing', 'uploading')"
            )
            for row in stuck_chords:
                print(f"🔄 Recovered stuck chord task: {row['id']} ({row['title']}) → idle")

        # Stem separation: processing → idle (user can re-trigger)
        stuck_stems = conn.execute(
            "SELECT id, title FROM songs WHERE stem_status = 'processing'"
        ).fetchall()
        if stuck_stems:
            conn.execute(
                "UPDATE songs SET stem_status = 'idle' WHERE stem_status = 'processing'"
            )
            for row in stuck_stems:
                # Clean up partial stem files
                stems_dir = STEMS_DIR / row['id']
                if stems_dir.exists():
                    shutil.rmtree(stems_dir, ignore_errors=True)
                print(f"🔄 Recovered stuck stem task: {row['id']} ({row['title']}) → idle")

        # Lyrics matching: processing → idle
        stuck_lyrics = conn.execute(
            "SELECT id, title FROM songs WHERE lyrics_status = 'processing'"
        ).fetchall()
        if stuck_lyrics:
            conn.execute(
                "UPDATE songs SET lyrics_status = 'idle' WHERE lyrics_status = 'processing'"
            )
            for row in stuck_lyrics:
                print(f"🔄 Recovered stuck lyrics task: {row['id']} ({row['title']}) → idle")

        total = len(stuck_chords) + len(stuck_stems) + len(stuck_lyrics)
        if total > 0:
            print(f"🔄 Startup recovery: reset {total} stuck task(s)")
        else:
            print("✅ Startup recovery: no stuck tasks found")


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(title="AI Practice Room API", version="2.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    _init_db()
    _recover_stuck_tasks()


# ---------------------------------------------------------------------------
# Auth Routes
# ---------------------------------------------------------------------------

@app.post("/api/auth/register")
async def auth_register(request: Request):
    """Register a new user. Body: { username, password }"""
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not username or len(username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(username) > 30:
        raise HTTPException(400, "用户名最长 30 个字符")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 个字符")

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(409, "用户名已存在")

        user_id = str(uuid.uuid4())
        password_hash = _hash_password(password)
        created_at = int(time.time() * 1000)
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, username, password_hash, created_at),
        )

    token = _create_token(user_id, username)
    print(f"✅ User registered: {username} ({user_id})")
    return JSONResponse(content={
        "token": token,
        "user": {"id": user_id, "username": username},
    }, status_code=201)


@app.post("/api/auth/login")
async def auth_login(request: Request):
    """Login. Body: { username, password }"""
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if not row:
        raise HTTPException(401, "用户名或密码错误")

    d = dict(row)
    if not _verify_password(password, d["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")

    token = _create_token(d["id"], d["username"])
    print(f"✅ User login: {username}")
    return JSONResponse(content={
        "token": token,
        "user": {"id": d["id"], "username": d["username"]},
    })


@app.get("/api/auth/me")
async def auth_me(request: Request):
    """Get current user info from JWT."""
    user_id = _require_user(request)
    with get_db() as conn:
        row = conn.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(401, "用户不存在")
    d = dict(row)
    return JSONResponse(content={"id": d["id"], "username": d["username"], "createdAt": d["created_at"]})


# ---------------------------------------------------------------------------
# Song CRUD
# ---------------------------------------------------------------------------

@app.post("/api/songs")
async def create_song(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    artist: str = Form("未知艺术家"),
    bpm: Optional[int] = Form(None),
    key: Optional[str] = Form(None),
    difficulty: int = Form(1),
    duration: Optional[str] = Form(None),
    duration_sec: Optional[float] = Form(None),
    cover: str = Form("🎵"),
):
    """Upload a new song: audio file + metadata. Requires authentication.
    Automatically triggers chord recognition and stem separation in background."""
    user_id = _require_user(request)

    # Validate extension
    ext = Path(file.filename or "audio.mp3").suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"不支持的格式: {ext}")

    # Read file
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"文件过大 ({len(content) // (1024*1024)}MB)，最大 50MB")
    if len(content) == 0:
        raise HTTPException(400, "文件为空")

    # Generate ID
    song_id = _generate_song_id(file.filename or "audio")

    # Save audio file
    audio_path = AUDIO_DIR / f"{song_id}{ext}"
    audio_path.write_bytes(content)

    # Save metadata to SQLite
    created_at = int(time.time() * 1000)
    with get_db() as conn:
        conn.execute("""
            INSERT INTO songs (id, title, artist, bpm, key, difficulty, duration, duration_sec, cover, source, audio_ext, chord_status, stem_status, has_lyrics, lyrics_status, created_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, 'uploading', 'processing', 0, 'processing', ?, ?)
        """, (song_id, title, artist, bpm, key, difficulty, duration, duration_sec, cover, ext, created_at, user_id))

    # Auto-trigger chord recognition + stem separation + lyrics matching (parallel background tasks)
    background_tasks.add_task(_run_chord_recognition, song_id, audio_path)
    background_tasks.add_task(_run_stem_separation, song_id, audio_path)
    background_tasks.add_task(_fetch_lyrics, song_id, title, artist, duration_sec, audio_path)

    # Return the created song
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()

    print(f"✅ Song created: {song_id} ({title} - {artist}, {len(content)//1024}KB) by user {user_id}")
    print(f"   → Auto-triggered: chord recognition + stem separation + lyrics matching")
    return JSONResponse(content=_row_to_song(row), status_code=201)


@app.get("/api/songs")
async def list_songs(request: Request):
    """List songs for the current user (requires auth). Returns only user's own songs, newest first."""
    user_id = _require_user(request)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM songs WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return JSONResponse(content=[_row_to_song(r) for r in rows])


@app.get("/api/songs/{song_id}")
async def get_song(song_id: str):
    """Get a single song's details."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")
    return JSONResponse(content=_row_to_song(row))


@app.delete("/api/songs/{song_id}")
async def delete_song(song_id: str, request: Request):
    """Delete a song and its audio + chord files. Only the owner can delete."""
    user_id = _require_user(request)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        if not row:
            raise HTTPException(404, "歌曲不存在")
        d = dict(row)
        if d.get("user_id") and d["user_id"] != user_id:
            raise HTTPException(403, "无权删除此歌曲")
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))

    # Delete files
    d = dict(row)
    audio_path = AUDIO_DIR / f"{song_id}{d['audio_ext']}"
    chord_path = CHORDS_DIR / f"{song_id}.json"
    lyrics_path = LYRICS_DIR / f"{song_id}.json"
    stems_dir = STEMS_DIR / song_id
    if audio_path.exists():
        audio_path.unlink()
    if chord_path.exists():
        chord_path.unlink()
    if lyrics_path.exists():
        lyrics_path.unlink()
    if stems_dir.exists():
        shutil.rmtree(stems_dir, ignore_errors=True)

    print(f"🗑️  Song deleted: {song_id}")
    return JSONResponse(content={"ok": True})


@app.get("/api/songs/{song_id}/audio")
async def get_song_audio(song_id: str):
    """Stream the audio file for a song."""
    with get_db() as conn:
        row = conn.execute("SELECT audio_ext, title FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    d = dict(row)
    audio_path = AUDIO_DIR / f"{song_id}{d['audio_ext']}"
    if not audio_path.exists():
        raise HTTPException(404, "音频文件不存在")

    # Map extension to MIME type
    mime_map = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.mp4': 'audio/mp4',
    }
    media_type = mime_map.get(d['audio_ext'], 'application/octet-stream')

    return FileResponse(
        path=str(audio_path),
        media_type=media_type,
        filename=f"{d['title']}{d['audio_ext']}",
    )


@app.get("/api/songs/{song_id}/chords")
async def get_song_chords(song_id: str):
    """Get chord data for a song."""
    # Verify song exists
    with get_db() as conn:
        row = conn.execute("SELECT id FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    chord_path = CHORDS_DIR / f"{song_id}.json"
    if not chord_path.exists():
        return JSONResponse(content={"chords": []})

    chords = json.loads(chord_path.read_text(encoding="utf-8"))
    return JSONResponse(content={"chords": chords})


# ---------------------------------------------------------------------------
# Chord Recognition
# ---------------------------------------------------------------------------

def _run_chord_recognition(song_id: str, audio_path: Path):
    """Background task: run chord extraction and save result.
    Guarded by _chord_semaphore to prevent concurrent CPU-heavy inference."""
    acquired = _chord_semaphore.acquire(timeout=600)  # wait up to 10min for slot
    if not acquired:
        print(f"⏳ Chord recognition timed out waiting for slot: {song_id}")
        with get_db() as conn:
            conn.execute("UPDATE songs SET chord_status = 'error' WHERE id = ?", (song_id,))
        return

    try:
        # Update status → processing
        with get_db() as conn:
            conn.execute("UPDATE songs SET chord_status = 'processing' WHERE id = ?", (song_id,))

        print(f"\n{'='*60}")
        print(f"🎵 Chord recognition started: {song_id}")
        print(f"{'='*60}")

        chords = extract_chords(str(audio_path))

        # Save chords to file
        chord_path = CHORDS_DIR / f"{song_id}.json"
        chord_path.write_text(json.dumps(chords, ensure_ascii=False, indent=2), encoding="utf-8")

        # Update status → done
        with get_db() as conn:
            conn.execute("UPDATE songs SET chord_status = 'done' WHERE id = ?", (song_id,))

        print(f"✅ Chord recognition done: {song_id} ({len(chords)} chords)")
        print(f"{'='*60}\n")

    except Exception as e:
        traceback.print_exc()
        with get_db() as conn:
            conn.execute("UPDATE songs SET chord_status = 'error' WHERE id = ?", (song_id,))
        print(f"❌ Chord recognition failed: {song_id}: {e}")
    finally:
        _chord_semaphore.release()


@app.post("/api/songs/{song_id}/recognize")
async def recognize_song_chords(song_id: str, background_tasks: BackgroundTasks):
    """Trigger chord recognition for an uploaded song."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    d = dict(row)
    audio_path = AUDIO_DIR / f"{song_id}{d['audio_ext']}"
    if not audio_path.exists():
        raise HTTPException(404, "音频文件不存在")

    # Don't re-trigger if already processing
    if d['chord_status'] == 'processing':
        return JSONResponse(content={"status": "already_processing"})

    # Update status to uploading (about to start)
    with get_db() as conn:
        conn.execute("UPDATE songs SET chord_status = 'uploading' WHERE id = ?", (song_id,))

    # Run in background
    background_tasks.add_task(_run_chord_recognition, song_id, audio_path)

    return JSONResponse(content={"status": "started"})


# ---------------------------------------------------------------------------
# Stem Separation (Demucs)
# ---------------------------------------------------------------------------

def _run_stem_separation(song_id: str, audio_path: Path):
    """Background task: run Demucs htdemucs_6s stem separation.
    Guarded by _stem_semaphore to prevent concurrent CPU/memory-heavy processes."""
    import subprocess

    acquired = _stem_semaphore.acquire(timeout=900)  # wait up to 15min for slot
    if not acquired:
        print(f"⏳ Stem separation timed out waiting for slot: {song_id}")
        with get_db() as conn:
            conn.execute("UPDATE songs SET stem_status = 'error' WHERE id = ?", (song_id,))
        return

    try:
        # Update status → processing
        with get_db() as conn:
            conn.execute("UPDATE songs SET stem_status = 'processing' WHERE id = ?", (song_id,))

        print(f"\n{'='*60}")
        print(f"🎛️ Stem separation started: {song_id}")
        print(f"   Model: {DEMUCS_MODEL}")
        print(f"   Input: {audio_path}")
        print(f"{'='*60}")

        # Temp output directory
        tmp_out = DATA_DIR / "tmp_demucs" / song_id
        tmp_out.mkdir(parents=True, exist_ok=True)

        # Run Demucs
        cmd = [
            sys.executable, "-m", "demucs",
            "-n", DEMUCS_MODEL,
            "--mp3",
            "--mp3-bitrate", "192",
            "-o", str(tmp_out),
            str(audio_path),
        ]

        print(f"   Command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)  # 30min timeout

        if result.returncode != 0:
            print(f"   STDERR: {result.stderr[-500:]}" if result.stderr else "   (no stderr)")
            raise RuntimeError(f"Demucs exited with code {result.returncode}")

        # Find Demucs output directory
        # Output is at: tmp_out/{model_name}/{filename_without_ext}/
        audio_stem = audio_path.stem  # e.g. "user-xxxx-abc123"
        demucs_out = tmp_out / DEMUCS_MODEL / audio_stem
        if not demucs_out.exists():
            # Try listing actual contents
            actual = list((tmp_out / DEMUCS_MODEL).iterdir()) if (tmp_out / DEMUCS_MODEL).exists() else []
            if len(actual) == 1:
                demucs_out = actual[0]
            else:
                raise RuntimeError(f"Demucs output not found. Expected: {demucs_out}, actual: {actual}")

        # Create stems directory for this song
        stems_dir = STEMS_DIR / song_id
        stems_dir.mkdir(parents=True, exist_ok=True)

        # Copy stem files
        copied = 0
        for stem in STEM_NAMES:
            src = demucs_out / f"{stem}.mp3"
            dst = stems_dir / f"{stem}.mp3"
            if src.exists():
                shutil.copy2(src, dst)
                size_mb = dst.stat().st_size / (1024 * 1024)
                print(f"   ✅ {stem}.mp3 ({size_mb:.1f} MB)")
                copied += 1
            else:
                print(f"   ⚠️  {stem}.mp3 not found in Demucs output")

        # Clean up temp directory
        shutil.rmtree(tmp_out, ignore_errors=True)

        if copied < len(STEM_NAMES):
            print(f"   ⚠️  Only {copied}/{len(STEM_NAMES)} stems copied")

        # Update status → done
        with get_db() as conn:
            conn.execute("UPDATE songs SET stem_status = 'done' WHERE id = ?", (song_id,))

        print(f"✅ Stem separation done: {song_id} ({copied} stems)")
        print(f"{'='*60}\n")

    except Exception as e:
        traceback.print_exc()
        # Clean up on error
        stems_dir = STEMS_DIR / song_id
        if stems_dir.exists():
            shutil.rmtree(stems_dir, ignore_errors=True)
        tmp_out = DATA_DIR / "tmp_demucs" / song_id
        if tmp_out.exists():
            shutil.rmtree(tmp_out, ignore_errors=True)
        with get_db() as conn:
            conn.execute("UPDATE songs SET stem_status = 'error' WHERE id = ?", (song_id,))
        print(f"❌ Stem separation failed: {song_id}: {e}")
    finally:
        _stem_semaphore.release()


@app.post("/api/songs/{song_id}/separate")
async def separate_song_stems(song_id: str, background_tasks: BackgroundTasks):
    """Trigger Demucs stem separation for an uploaded song."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    d = dict(row)
    audio_path = AUDIO_DIR / f"{song_id}{d['audio_ext']}"
    if not audio_path.exists():
        raise HTTPException(404, "音频文件不存在")

    # Don't re-trigger if already processing
    if d.get('stem_status') == 'processing':
        return JSONResponse(content={"status": "already_processing"})

    # Update status
    with get_db() as conn:
        conn.execute("UPDATE songs SET stem_status = 'processing' WHERE id = ?", (song_id,))

    # Run in background
    background_tasks.add_task(_run_stem_separation, song_id, audio_path)

    return JSONResponse(content={"status": "started"})


@app.get("/api/songs/{song_id}/stems/{stem_name}")
async def get_song_stem(song_id: str, stem_name: str):
    """Stream a single stem audio file for a song."""
    # Validate stem name
    if stem_name not in STEM_NAMES:
        raise HTTPException(400, f"无效的分轨名: {stem_name}，可选: {', '.join(STEM_NAMES)}")

    # Verify song exists
    with get_db() as conn:
        row = conn.execute("SELECT id, title, stem_status FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    d = dict(row)
    if d.get("stem_status") != "done":
        raise HTTPException(404, "分轨尚未完成")

    stem_path = STEMS_DIR / song_id / f"{stem_name}.mp3"
    if not stem_path.exists():
        raise HTTPException(404, f"分轨文件不存在: {stem_name}")

    return FileResponse(
        path=str(stem_path),
        media_type="audio/mpeg",
        filename=f"{d['title']}_{stem_name}.mp3",
    )


@app.post("/api/chords")
async def recognize_chords_standalone(file: UploadFile = File(...)):
    """
    Standalone chord recognition: upload audio, get chords back.
    Does NOT persist the song — for one-off analysis.
    """
    if file.filename:
        ext = Path(file.filename).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(400, f"不支持的格式: {ext}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"文件过大 ({len(content) // (1024*1024)}MB)，最大 50MB")
    if len(content) == 0:
        raise HTTPException(400, "文件为空")

    suffix = Path(file.filename or "audio.mp3").suffix
    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(content)
        tmp.close()

        print(f"\n{'='*60}")
        print(f"Processing (standalone): {file.filename} ({len(content) // 1024}KB)")
        print(f"{'='*60}")

        chords = extract_chords(tmp.name)

        print(f"Result: {len(chords)} chord events")
        print(f"{'='*60}\n")

        return JSONResponse(content={"chords": chords})

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"和弦识别失败: {str(e)}")
    finally:
        if tmp and os.path.exists(tmp.name):
            os.unlink(tmp.name)


# ---------------------------------------------------------------------------
# Lyrics — LRC parser + LRCLIB matching + API endpoints
# ---------------------------------------------------------------------------

_LRC_TAG_RE = re.compile(r'\[(\d{1,3}):(\d{2})(?:\.(\d{2,3}))?\]')

def _parse_lrc(lrc_text: str) -> list[dict]:
    """Parse LRC formatted text into [{ time: float, text: str }, ...].
    Only returns lines with valid time tags. Sorted by time ascending."""
    lines = []
    for raw_line in lrc_text.split('\n'):
        trimmed = raw_line.strip()
        if not trimmed:
            continue

        # Collect all time tags from this line
        times = []
        last_end = 0
        for m in _LRC_TAG_RE.finditer(trimmed):
            minutes = int(m.group(1))
            seconds = int(m.group(2))
            frac_str = m.group(3)
            frac = 0
            if frac_str:
                frac = int(frac_str) * 10 if len(frac_str) == 2 else int(frac_str)
            t = minutes * 60 + seconds + frac / 1000
            times.append(t)
            last_end = m.end()

        if not times:
            continue  # skip metadata lines like [ti:xxx]

        text = trimmed[last_end:].strip()

        for t in times:
            lines.append({"time": round(t, 3), "text": text})

    lines.sort(key=lambda x: x["time"])
    return lines


def _fuzzy_match(a: str, b: str) -> bool:
    """Fuzzy string match: normalize to simplified Chinese + lowercase, then check containment."""
    na = _to_simplified(a).lower().strip()
    nb = _to_simplified(b).lower().strip()
    if not na or not nb:
        return False
    return na == nb or na in nb or nb in na


def _match_lrclib(title: str, artist: str, duration_sec: float | None) -> list[dict] | None:
    """Search LRCLIB for synced lyrics matching the given song.
    Returns parsed LyricLine list (simplified Chinese) or None if no match."""
    query = f"{title} {artist}".strip()
    if not query:
        return None

    try:
        resp = http_requests.get(
            'https://lrclib.net/api/search',
            params={'q': query},
            timeout=10,
            headers={'User-Agent': 'AI-Practice-Room/1.0'},
        )
        if resp.status_code != 200:
            print(f"   LRCLIB search returned {resp.status_code}")
            return None

        results = resp.json()
        if not isinstance(results, list) or not results:
            return None
    except Exception as e:
        print(f"   LRCLIB request failed: {e}")
        return None

    # Score and rank results
    best = None
    best_score = 0

    for r in results:
        synced = r.get('syncedLyrics')
        if not synced:
            continue  # skip results without time-synced lyrics

        score = 0
        # Artist match
        r_artist = r.get('artistName', '')
        if _fuzzy_match(r_artist, artist):
            score += 50
        # Track name match
        r_name = r.get('trackName', '') or r.get('name', '')
        if _fuzzy_match(r_name, title):
            score += 30
        # Duration match (within 5 seconds)
        if duration_sec and r.get('duration'):
            if abs(r['duration'] - duration_sec) < 5:
                score += 20

        if score > best_score:
            best_score = score
            best = r

    # Minimum score threshold
    if not best or best_score < 50:
        return None

    # Parse the synced lyrics
    lines = _parse_lrc(best['syncedLyrics'])
    if not lines:
        return None

    # Convert Traditional → Simplified Chinese
    for line in lines:
        if line['text']:
            line['text'] = _to_simplified(line['text'])

    print(f"   LRCLIB matched: \"{best.get('trackName')}\" by {best.get('artistName')} "
          f"(score={best_score}, {len(lines)} lines)")
    return lines


def _fetch_lyrics(song_id: str, title: str, artist: str, duration_sec: float | None, audio_path: Path):
    """Background task: fetch lyrics for a song.
    Priority: 1) ID3 embedded synced lyrics  2) LRCLIB online matching.
    No semaphore needed — this is a lightweight HTTP request."""
    try:
        print(f"🎤 Lyrics matching started: {song_id} ({title} - {artist})")

        lyrics = None

        # --- Priority 1: ID3 embedded synced lyrics ---
        try:
            from mutagen import File as MutagenFile
            from mutagen.id3 import SYLT, USLT

            audio = MutagenFile(str(audio_path))
            if audio and audio.tags:
                # Check for SYLT (synchronized lyrics) first
                for key in audio.tags:
                    frame = audio.tags[key]
                    if isinstance(frame, SYLT) and frame.text:
                        # SYLT text is list of (text, timestamp_ms) tuples
                        lines = []
                        for text_chunk, ts_ms in frame.text:
                            t = ts_ms / 1000.0
                            text_str = text_chunk if isinstance(text_chunk, str) else text_chunk.decode('utf-8', errors='ignore')
                            text_str = _to_simplified(text_str.strip())
                            lines.append({"time": round(t, 3), "text": text_str})
                        if lines:
                            lines.sort(key=lambda x: x["time"])
                            lyrics = lines
                            print(f"   Found ID3 SYLT: {len(lyrics)} lines")
                            break
        except Exception as e:
            print(f"   ID3 extraction failed (non-fatal): {e}")

        # --- Priority 2: LRCLIB online matching ---
        if not lyrics:
            lyrics = _match_lrclib(title, artist, duration_sec)

        # --- Save result ---
        if lyrics and len(lyrics) > 0:
            lyrics_path = LYRICS_DIR / f"{song_id}.json"
            lyrics_path.write_text(
                json.dumps(lyrics, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            with get_db() as conn:
                conn.execute(
                    "UPDATE songs SET has_lyrics = 1, lyrics_status = 'done' WHERE id = ?",
                    (song_id,),
                )
            print(f"✅ Lyrics saved: {song_id} ({len(lyrics)} lines)")
        else:
            with get_db() as conn:
                conn.execute(
                    "UPDATE songs SET has_lyrics = 0, lyrics_status = 'error' WHERE id = ?",
                    (song_id,),
                )
            print(f"⚠️  No lyrics found: {song_id}")

    except Exception as e:
        traceback.print_exc()
        with get_db() as conn:
            conn.execute(
                "UPDATE songs SET has_lyrics = 0, lyrics_status = 'error' WHERE id = ?",
                (song_id,),
            )
        print(f"❌ Lyrics matching failed: {song_id}: {e}")


@app.get("/api/songs/{song_id}/lyrics")
async def get_song_lyrics(song_id: str):
    """Get lyrics data for a song."""
    with get_db() as conn:
        row = conn.execute("SELECT id FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    lyrics_path = LYRICS_DIR / f"{song_id}.json"
    if not lyrics_path.exists():
        return JSONResponse(content={"lyrics": []})

    lyrics = json.loads(lyrics_path.read_text(encoding="utf-8"))
    return JSONResponse(content={"lyrics": lyrics})


@app.post("/api/songs/{song_id}/lyrics")
async def upload_song_lyrics(song_id: str, request: Request, file: UploadFile = File(...)):
    """Upload an LRC lyrics file for a song. Parses LRC → JSON, converts to simplified Chinese."""
    _require_user(request)

    with get_db() as conn:
        row = conn.execute("SELECT id FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not row:
        raise HTTPException(404, "歌曲不存在")

    # Read and validate LRC file
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "文件为空")
    if len(content) > 1024 * 1024:  # 1MB max for lyrics
        raise HTTPException(400, "歌词文件过大，最大 1MB")

    lrc_text = content.decode('utf-8', errors='ignore')
    lyrics = _parse_lrc(lrc_text)

    if not lyrics:
        raise HTTPException(400, "无法解析 LRC 文件，请检查格式")

    # Convert to simplified Chinese
    for line in lyrics:
        if line['text']:
            line['text'] = _to_simplified(line['text'])

    # Save
    lyrics_path = LYRICS_DIR / f"{song_id}.json"
    lyrics_path.write_text(
        json.dumps(lyrics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    with get_db() as conn:
        conn.execute(
            "UPDATE songs SET has_lyrics = 1, lyrics_status = 'done' WHERE id = ?",
            (song_id,),
        )

    print(f"✅ Lyrics uploaded: {song_id} ({len(lyrics)} lines)")
    return JSONResponse(content={"status": "ok", "lines": len(lyrics)})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ai-practice-room", "version": "2.4.0"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    print("🎵 AI Practice Room API v2.4 (with auth + stem separation + lyrics + safety guards)")
    print(f"   Data dir: {DATA_DIR}")
    print(f"   Database: {DB_PATH}")
    print()
    print("   POST   /api/auth/register        — 注册")
    print("   POST   /api/auth/login           — 登录")
    print("   GET    /api/auth/me              — 当前用户")
    print("   POST   /api/songs                — 上传歌曲（需登录，自动触发和弦+分轨+歌词）")
    print("   GET    /api/songs                — 歌曲列表（需登录）")
    print("   GET    /api/songs/{id}           — 歌曲详情")
    print("   DELETE /api/songs/{id}           — 删除歌曲（需登录）")
    print("   GET    /api/songs/{id}/audio     — 音频流")
    print("   GET    /api/songs/{id}/chords    — 和弦数据")
    print("   GET    /api/songs/{id}/lyrics    — 歌词数据")
    print("   POST   /api/songs/{id}/lyrics    — 上传 LRC 歌词")
    print("   POST   /api/songs/{id}/recognize — 触发和弦识别")
    print("   POST   /api/songs/{id}/separate  — 触发分轨")
    print("   GET    /api/songs/{id}/stems/{s} — 分轨音频流")
    print("   POST   /api/chords               — 独立和弦识别")
    print("   GET    /api/health               — 健康检查")
    print()
    uvicorn.run(app, host="0.0.0.0", port=8000)
