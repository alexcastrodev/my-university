#!/bin/sh
# Runs the three processes that make up the web container: the Nest API, the Angular SSR
# server and nginx in front of both. There is deliberately no in-container supervisor: if any
# of them dies, this script exits, the container stops, and Swarm/Compose (which already own
# restarts and healthchecks) replace it. tini is PID 1 (see Dockerfile) and signals the whole
# process group on `docker stop`, so every child gets SIGTERM.
set -eu

node dist/main.js &
api=$!
PORT=4000 node frontend/server/server.mjs &
ssr=$!
nginx -g 'daemon off;' &
proxy=$!

while kill -0 "$api" "$ssr" "$proxy" 2>/dev/null; do
  sleep 2
done

echo "A web container process exited; stopping so the orchestrator restarts the container." >&2
exit 1
