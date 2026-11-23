from __future__ import annotations

import hashlib
import os
from collections import OrderedDict
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .auth import (
    AuthContext,
    AuthUser,
    CreateUserRequest,
    LoginRequest,
    LoginResponse,
    create_user,
    delete_user,
    init_auth,
    list_users,
    login,
    logout,
    require_admin,
    require_user,
)
from .demo import DEMO_SCENARIO
from .models import ScheduleRequest, ScheduleResponse, Scenario
from .scheduler import ScheduleValidationError, solve_schedule

app = FastAPI(
    title="ACTO API",
    version="0.2.0",
    description="Automation Cycle Time Optimizer · 机器人动作约束排程 API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "ACTO_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_cache: OrderedDict[str, ScheduleResponse] = OrderedDict()
_CACHE_LIMIT = 128
FRONTEND_DIST = Path(
    os.getenv(
        "ACTO_FRONTEND_DIST",
        str(Path(__file__).resolve().parents[2] / "frontend" / "dist"),
    )
)

init_auth()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "solver": "OR-Tools CP-SAT", "cache": "enabled"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login_user(request: LoginRequest) -> LoginResponse:
    user, token, expires_at = login(request.username, request.password)
    return LoginResponse(token=token, expires_at=expires_at, user=user)


@app.get("/api/auth/me", response_model=AuthUser)
def current_user(user: AuthContext = Depends(require_user)) -> AuthUser:
    return user.as_user()


@app.post("/api/auth/logout")
def logout_user(request: Request) -> dict[str, bool]:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        logout(authorization[7:].strip())
    return {"ok": True}


@app.get("/api/auth/users", response_model=list[AuthUser])
def users(_: AuthContext = Depends(require_admin)) -> list[AuthUser]:
    return list_users()


@app.post("/api/auth/users", response_model=AuthUser, status_code=201)
def add_user(
    request: CreateUserRequest,
    _: AuthContext = Depends(require_admin),
) -> AuthUser:
    return create_user(request)


@app.delete("/api/auth/users/{user_id}")
def remove_user(
    user_id: int,
    current_user: AuthContext = Depends(require_admin),
) -> dict[str, bool]:
    delete_user(user_id, current_user.id)
    return {"ok": True}


@app.get("/api/demo", response_model=Scenario)
def demo_scenario(_: AuthContext = Depends(require_user)) -> Scenario:
    return DEMO_SCENARIO


@app.post("/api/schedule", response_model=ScheduleResponse)
def schedule(
    request: ScheduleRequest,
    _: AuthContext = Depends(require_user),
) -> ScheduleResponse:
    cache_key = hashlib.sha256(request.model_dump_json().encode("utf-8")).hexdigest()
    if cache_key in _cache:
        _cache.move_to_end(cache_key)
        cached = _cache[cache_key]
        return cached.model_copy(
            update={
                "solve_time_ms": 0,
                "algorithm": f"{cached.algorithm} · cache",
            }
        )

    try:
        result = solve_schedule(
            request.scenario,
            time_limit_seconds=request.time_limit_seconds,
            optimize=request.optimize,
        )
        _cache[cache_key] = result
        _cache.move_to_end(cache_key)
        while len(_cache) > _CACHE_LIMIT:
            _cache.popitem(last=False)
        return result
    except ScheduleValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=[item.model_dump(mode="json") for item in exc.diagnostics],
        ) from exc


@app.post("/api/validate", response_model=ScheduleResponse)
def validate(
    request: ScheduleRequest,
    _: AuthContext = Depends(require_user),
) -> ScheduleResponse:
    return schedule(request)


@app.get("/{full_path:path}", include_in_schema=False)
def frontend(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    candidate = (FRONTEND_DIST / full_path).resolve()
    if (
        full_path
        and FRONTEND_DIST in candidate.parents
        and candidate.is_file()
    ):
        return FileResponse(candidate)
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="前端尚未构建")
    return FileResponse(index)
