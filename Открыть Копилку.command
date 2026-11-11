#!/bin/zsh
# Запускает Копилку локально: http://localhost:8765
cd "$(dirname "$0")"
PORT=8765
if ! lsof -i :$PORT >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 0.7
fi
open "http://localhost:$PORT/"
