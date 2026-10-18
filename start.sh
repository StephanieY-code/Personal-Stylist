#!/usr/bin/env bash
# Start the backend (port 8000) and the frontend (port 8443) together.
# Run:  ./start.sh   then open http://localhost:8443   (Ctrl+C stops both)
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
[ -f .env ] || cp .env.example .env

for port in 8000 8443; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the other server first:"
    lsof -nP -iTCP:$port -sTCP:LISTEN
    exit 1
  fi
done

# --reload-include .env restarts the backend whenever you save new keys.
.venv/bin/python -m uvicorn main:app --reload --reload-include .env --port 8000 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

cd "Peak Style Personal Stylist"
# Use pnpm if installed, otherwise run it through npx (no global install needed).
if command -v pnpm >/dev/null 2>&1; then PNPM=pnpm; else PNPM="npx --yes pnpm"; fi
[ -d node_modules ] || $PNPM install
$PNPM dev
