#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$APP_ROOT/run/app.pid"

if curl --silent --fail --max-time 3 \
  "http://127.0.0.1:${ACTO_PORT:-18090}/api/health" >/dev/null; then
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    exit 0
  fi
fi

mkdir -p "$APP_ROOT/logs" "$APP_ROOT/run"
nohup "$APP_ROOT/deploy/start.sh" \
  >>"$APP_ROOT/logs/app.log" 2>&1 </dev/null &
echo $! >"$PID_FILE"
