#!/bin/bash
# Starts the API (private, 127.0.0.1:3001) and nginx (public, $PORT). If either stops, the
# container exits so Render restarts it.
set -e

export PUBLIC_PORT="${PORT:-10000}"
envsubst '${PUBLIC_PORT}' < /etc/nginx/nearpill.conf.template > /etc/nginx/nginx.conf
nginx -t

cd /app/backend
PORT=3001 HOST=127.0.0.1 node --env-file-if-exists=.env src/bootstrap/server.ts &
API_PID=$!
nginx -g 'daemon off;' &
NGINX_PID=$!

trap 'kill "$API_PID" "$NGINX_PID" 2>/dev/null || true; exit 0' TERM INT
wait -n "$API_PID" "$NGINX_PID" || true
echo "A NearPill process exited; stopping the container so it restarts." >&2
kill "$API_PID" "$NGINX_PID" 2>/dev/null || true
exit 1
