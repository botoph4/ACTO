from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator


DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "acto.db"
DB_PATH = Path(os.getenv("ACTO_DB_PATH", str(DEFAULT_DB_PATH)))
SESSION_TTL_SECONDS = int(os.getenv("ACTO_SESSION_TTL_SECONDS", "604800"))
PASSWORD_ITERATIONS = 310_000
bearer = HTTPBearer(auto_error=False)


class AuthUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    token: str
    expires_at: float
    user: AuthUser


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(default="", max_length=80)
    password: str = Field(min_length=8, max_length=256)
    role: str = "user"

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._@-")
        if not normalized or any(character not in allowed for character in normalized):
            raise ValueError("账号只能包含字母、数字、点、下划线、@ 和连字符")
        return normalized

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        if value not in {"user", "admin"}:
            raise ValueError("角色必须是 user 或 admin")
        return value


@dataclass(frozen=True)
class AuthContext:
    id: int
    username: str
    display_name: str
    role: str

    def as_user(self) -> AuthUser:
        return AuthUser(
            id=self.id,
            username=self.username,
            display_name=self.display_name,
            role=self.role,
        )


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user_from_row(row: sqlite3.Row) -> AuthContext:
    return AuthContext(
        id=int(row["id"]),
        username=str(row["username"]),
        display_name=str(row["display_name"]),
        role=str(row["role"]),
    )


def init_auth() -> None:
    with _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                disabled INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at REAL NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS sessions_expires_at
            ON sessions(expires_at);
            """
        )
        connection.execute(
            "DELETE FROM sessions WHERE expires_at <= ?",
            (time.time(),),
        )

    username = os.getenv("ACTO_ADMIN_USERNAME", "").strip().lower()
    password = os.getenv("ACTO_ADMIN_PASSWORD", "")
    if not username or not password:
        return

    with _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if existing is None:
            connection.execute(
                """
                INSERT INTO users
                    (username, display_name, password_hash, role, created_at)
                VALUES (?, ?, ?, 'admin', ?)
                """,
                (
                    username,
                    os.getenv("ACTO_ADMIN_DISPLAY_NAME", username),
                    _hash_password(password),
                    time.time(),
                ),
            )


def login(username: str, password: str) -> tuple[AuthUser, str, float]:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT id, username, display_name, password_hash, role, disabled
            FROM users WHERE username = ?
            """,
            (username.strip().lower(),),
        ).fetchone()
        if row is None or row["disabled"] or not _verify_password(
            password,
            str(row["password_hash"]),
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="账号或密码错误",
            )

        token = secrets.token_urlsafe(32)
        expires_at = time.time() + SESSION_TTL_SECONDS
        connection.execute(
            """
            INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (_token_hash(token), row["id"], expires_at, time.time()),
        )
        return _user_from_row(row).as_user(), token, expires_at


def authenticate(token: str) -> AuthContext:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT u.id, u.username, u.display_name, u.role
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
            """,
            (_token_hash(token), time.time()),
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="登录已失效，请重新登录",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return _user_from_row(row)


def logout(token: str) -> None:
    with _connect() as connection:
        connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (_token_hash(token),),
        )


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return authenticate(credentials.credentials)


def require_admin(user: AuthContext = Depends(require_user)) -> AuthContext:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可以管理账号",
        )
    return user


def list_users() -> list[AuthUser]:
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT id, username, display_name, role
            FROM users
            WHERE disabled = 0
            ORDER BY created_at, id
            """
        ).fetchall()
        return [_user_from_row(row).as_user() for row in rows]


def create_user(request: CreateUserRequest) -> AuthUser:
    with _connect() as connection:
        try:
            cursor = connection.execute(
                """
                INSERT INTO users
                    (username, display_name, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    request.username,
                    request.display_name.strip() or request.username,
                    _hash_password(request.password),
                    request.role,
                    time.time(),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该账号已存在",
            ) from exc
        row = connection.execute(
            """
            SELECT id, username, display_name, role
            FROM users WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=500, detail="账号创建失败")
        return _user_from_row(row).as_user()


def delete_user(user_id: int, current_user_id: int) -> None:
    if user_id == current_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能删除当前登录账号",
        )

    with _connect() as connection:
        row = connection.execute(
            "SELECT id, role FROM users WHERE id = ? AND disabled = 0",
            (user_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="账号不存在",
            )
        if row["role"] == "admin":
            admin_count = connection.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0"
            ).fetchone()[0]
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="至少需要保留一个管理员账号",
                )
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
