#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d backend/node_modules ]; then
  (cd backend && npm install)
fi
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f /tmp/bot_token_env ]; then
  TELEGRAM_BOT_TOKEN=$(tr -d '\r\n' </tmp/bot_token_env)
  export TELEGRAM_BOT_TOKEN
fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f backend/.env ]; then
  TELEGRAM_BOT_TOKEN=$(awk -F= '/^TELEGRAM_BOT_TOKEN=/{print $2; exit}' backend/.env | tr -d '"'\''[:space:]')
  export TELEGRAM_BOT_TOKEN
fi

node backend/server.js &
BACKEND_PID=$!

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  node backend/bot.js &
  BOT_PID=$!
  echo "$BOT_PID" > /tmp/usdtsham-bot.pid
fi

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
  if [ -n "${BOT_PID:-}" ]; then
    kill "$BOT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd frontend && npm run dev
