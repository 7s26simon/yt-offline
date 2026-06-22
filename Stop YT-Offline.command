#!/bin/bash
# Double-click to stop the YT-Offline server.
cd "$(dirname "$0")" || exit 1

PIDFILE=".server.pid"
PORT=3100

stopped=0

# Stop via the recorded PID.
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null && stopped=1
  fi
  rm -f "$PIDFILE"
fi

# Fallback: anything still listening on the port.
LEFTOVER="$(lsof -ti tcp:$PORT 2>/dev/null)"
if [ -n "$LEFTOVER" ]; then
  echo "$LEFTOVER" | xargs kill 2>/dev/null && stopped=1
fi

if [ "$stopped" -eq 1 ]; then
  echo "🛑 YT-Offline stopped."
else
  echo "YT-Offline was not running."
fi
sleep 2
