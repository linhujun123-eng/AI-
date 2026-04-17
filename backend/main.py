#!/usr/bin/env python3
"""
AI 练习室 — 后端 API 服务 (Railway 部署版)

提供用户认证 + 歌曲 CRUD + 和弦识别，数据持久化到 SQLite + 文件系统。

启动方式：
  uvicorn main:app --host 0.0.0.0 --port $PORT

目录结构：
  data/
    practice-room.db     — SQLite 数据库（用户 + 歌曲元数据）
    audio/{songId}.ext   — 音频文件
    chords/{songId}.json — 和弦 JSON

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
  POST   /api/chords             — 上传音频识别和弦（独立，不关联歌曲）
  POST   /api/songs/{id}/recognize — 触发已上传歌曲的和弦识别
  GET    /api/health             — 健康检查
"""

import os
import sys
import json
import time
import sqlite3
import tempfile
import traceback
import shutil
import uuid
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

import bcrypt
import jwt as pyjwt

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

# Import chord extraction (same directory)
from extract_chords_v4 import extract_chords

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# data/ lives in /app/data on Railway (persistent volume) or local ./data
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent / "data"))
DB_PATH = DATA_DIR / "practice-room.db"
AUDIO_DIR = DATA_DIR / "audio"
CHORDS_DIR = DATA_DIR / "chords"

SUPPORTED_EXTENSIONS = {'.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.mp4'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# JWT config — in production use a proper secret from env
JWT_SECRET = os.environ.get("JWT_SECRET", "ai-practice-room-dev-secret-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _ensure_dirs():
    """Create data directories if they don't exist."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    CHORDS_DIR.mkdir(parents=True, exist_ok=True)


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
        "hasChords": has_chords,
        "audio": {
            "mix": f"/api/songs/{d['id']}/audio",
            "hasStem": False,
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
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(title="AI Practice Room API", version="2.1.0")

# CORS — allow Vercel frontend + local dev
FRONTEND_ORIGINS = os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    _init_db()


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
    """Upload a new song: audio file + metadata. Requires authentication."""
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
            INSERT INTO songs (id, title, artist, bpm, key, difficulty, duration, duration_sec, cover, source, audio_ext, chord_status, created_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, 'idle', ?, ?)
        """, (song_id, title, artist, bpm, key, difficulty, duration, duration_sec, cover, ext, created_at, user_id))

    # Return the created song
    with get_db() as conn:
        row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()

    print(f"✅ Song created: {song_id} ({title} - {artist}, {len(content)//1024}KB) by user {user_id}")
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
    if audio_path.exists():
        audio_path.unlink()
    if chord_path.exists():
        chord_path.unlink()

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
    """Background task: run chord extraction and save result."""
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
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ai-practice-room", "version": "2.1.0"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"🎵 AI Practice Room API v2.1 (Railway)")
    print(f"   Data dir: {DATA_DIR}")
    print(f"   Database: {DB_PATH}")
    print(f"   Port: {port}")
    print()
    uvicorn.run(app, host="0.0.0.0", port=port)
