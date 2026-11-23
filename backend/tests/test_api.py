import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

_test_dir = tempfile.TemporaryDirectory()
os.environ["ACTO_DB_PATH"] = str(Path(_test_dir.name) / "acto-test.db")
os.environ["ACTO_ADMIN_USERNAME"] = "test-admin"
os.environ["ACTO_ADMIN_PASSWORD"] = "test-admin-password"

from app.main import _cache, app

client = TestClient(app)


def auth_headers(username: str = "test-admin", password: str = "test-admin-password"):
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_schedule_cache_returns_immediately_for_unchanged_request():
    _cache.clear()
    headers = auth_headers()
    scenario = client.get("/api/demo", headers=headers).json()
    payload = {
        "scenario": scenario,
        "time_limit_seconds": 2,
        "optimize": True,
    }

    first = client.post("/api/schedule", json=payload, headers=headers)
    second = client.post("/api/schedule", json=payload, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["solve_time_ms"] == 0
    assert "cache" in second.json()["algorithm"]


def test_invalid_constraints_return_specific_diagnostics():
    headers = auth_headers()
    scenario = client.get("/api/demo", headers=headers).json()
    scenario["tasks"] = scenario["tasks"][:2]
    scenario["tasks"][0]["dependencies"] = [scenario["tasks"][1]["id"]]
    scenario["tasks"][1]["dependencies"] = [scenario["tasks"][0]["id"]]

    response = client.post(
        "/api/schedule",
        headers=headers,
        json={
            "scenario": scenario,
            "time_limit_seconds": 2,
            "optimize": True,
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["level"] == "error"
    assert detail[0]["title"] == "依赖关系存在环"
    assert "闭环" in detail[0]["detail"]


def test_schedule_requires_login():
    response = client.post(
        "/api/schedule",
        json={"scenario": {}, "time_limit_seconds": 2, "optimize": True},
    )
    assert response.status_code == 401


def test_admin_can_create_additional_accounts():
    admin_headers = auth_headers()
    response = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "username": "operator-one",
            "display_name": "操作员一",
            "password": "operator-password",
            "role": "user",
        },
    )
    assert response.status_code == 201
    assert response.json()["username"] == "operator-one"

    user_headers = auth_headers("operator-one", "operator-password")
    forbidden = client.get("/api/auth/users", headers=user_headers)
    assert forbidden.status_code == 403


def test_admin_can_delete_another_account_but_not_self():
    admin_headers = auth_headers()
    created = client.post(
        "/api/auth/users",
        headers=admin_headers,
        json={
            "username": "delete-me",
            "display_name": "待删除账号",
            "password": "delete-me-password",
            "role": "user",
        },
    )
    assert created.status_code == 201

    deleted = client.delete(
        f"/api/auth/users/{created.json()['id']}",
        headers=admin_headers,
    )
    assert deleted.status_code == 200

    me = client.get("/api/auth/me", headers=admin_headers).json()
    self_delete = client.delete(
        f"/api/auth/users/{me['id']}",
        headers=admin_headers,
    )
    assert self_delete.status_code == 400
