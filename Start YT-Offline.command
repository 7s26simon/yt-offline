#!/bin/bash
# Double-click to start the YT-Offline server and open it in your browser.
cd "$(dirname "$0")" || exit 1

PORT=3100
PIDFILE=".server.pid"
URL="http://localhost:$PORT"

# Already running?
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "YT-Offline is already running → $URL"
  open "$URL"
  sleep 1
  exit 0
fi

# Make sure dependencies are installed.
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install --cache /tmp/npm-cache-ytoffline || { echo "npm install failed"; sleep 3; exit 1; }
fi

echo "Starting YT-Offline on $URL …"
PORT=$PORT nohup node server.js > server.log 2>&1 &
echo $! > "$PIDFILE"

# Wait until it's actually listening, then open the browser.
for i in $(seq 1 20); do
  if curl -s "$URL" >/dev/null 2>&1; then break; fi
  sleep 0.3
done

open "$URL"
echo ""
echo "✅ YT-Offline is running → $URL"
echo "   Leave it running in the background. Double-click 'Stop YT-Offline' to shut it down."
echo "   (You can close this Terminal window now.)"
sleep 2
