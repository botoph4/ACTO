#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$APP_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_ROOT/.env"
  set +a
fi

mkdir -p "$APP_ROOT/logs" "$APP_ROOT/backend/data"

exec "$APP_ROOT/.venv/bin/uvicorn" app.main:app \
  --app-dir "$APP_ROOT/backend" \
  --host "${ACTO_HOST:-0.0.0.0}" \
  --port "${ACTO_PORT:-18090}" \
  --proxy-headers \
  --forwarded-allow-ips="*"
