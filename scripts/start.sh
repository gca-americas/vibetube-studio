#!/usr/bin/env bash
# Production-style start for the lab: build the frontend once, then serve
# everything (frontend, API, SSE, the mounted ADK dev UI) from one port.
# In Cloud Shell: Web Preview -> port 4600.
#
# Ctrl+C stops the server AND every process it started (the ADK agent reload
# watcher, any driver subprocess still running). A stale server already
# holding the port from an earlier session is stopped first, so there is
# never more than one instance answering.
# `sh scripts/restart.sh` runs a bash script under another shell. Re-enter under
# bash rather than fail somewhere later on a construct sh does not have.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-4600}"

# This shell and its parents are never candidates: a terminal must survive a
# restart of the server it started.
is_ancestor() {
  local target="$1" p="$$"
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    [ "$p" = "$target" ] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d '[:space:]' || true)"
  done
  return 1
}

stop_port() {            # stop whatever from THIS repo is listening on a port
  # lsof ORs its selectors unless -a is given: without it, this would list
  # every listening socket on the machine, not just the one on our port.
  local pids ours=""
  # Nothing listening is the ordinary case, and grep says so by exiting 1.
  # Under `set -e` with pipefail that ends the script here, before a line of
  # output, so every one of these has to be allowed to find nothing.
  pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -a -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true)
  fi
  if [ -z "$pids" ] && command -v ss >/dev/null 2>&1; then   # lsof is absent from some images
    pids=$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
  fi
  if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
    pids=$(fuser -n tcp "$1" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' || true)
  fi
  for pid in $pids; do
    [ "$pid" = "$$" ] && continue
    is_ancestor "$pid" && continue
    if ps -o command= -p "$pid" | grep -q "uvicorn.*server.main\|scripts/start.sh\|adk web\|vite"; then
      echo "stopping stale process $pid on port $1"
      parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
      # only a start/dev script of this repo, and never an ancestor of this shell
      if [ -n "$parent" ] && [ "$parent" != "$$" ] && ! is_ancestor "$parent" \
         && ps -o command= -p "$parent" | grep -q "scripts/\(start\|dev\)\.sh"; then
        kill "$parent" 2>/dev/null || true      # its exit trap only touches its own children
      fi
      kill "$pid" 2>/dev/null || true
      ours="$ours $pid"
    fi
  done
  sleep 0.5
  for pid in $ours; do kill -9 "$pid" 2>/dev/null || true; done
}

stop_tree() {           # a process and its children (drivers under uvicorn), TERM then KILL
  local pid=$1
  [ -z "$pid" ] && return 0
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.5; done
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "stopping Vibe Studio and every process it started..."
  stop_tree "${SERVER_PID:-}"
  echo "stopped."
}
trap cleanup EXIT INT TERM

# uv installs into ~/.local/bin, which a login shell picks up and the shell
# behind `nohup scripts/start.sh &` does not. Without this, a start that needs
# uv dies with "command not found" into runs/lab.log and the port stays empty.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$PATH"; export PATH ;;
esac

# uv follows whatever package index the machine is configured with. A corporate
# proxy on a machine that is not on that network (Cloud Shell images carry one)
# refuses every download and the sync fails before the lab runs a line. PyPI
# has everything this lab needs, so a failed sync is tried again there.
uv_sync() {
    if uv sync "$@"; then return 0; fi
    echo "  the configured package index did not answer; trying PyPI directly"
    env -u UV_INDEX_URL -u UV_EXTRA_INDEX_URL -u UV_INDEX -u PIP_INDEX_URL -u PIP_EXTRA_INDEX_URL \
        UV_DEFAULT_INDEX=https://pypi.org/simple uv sync "$@"
}

need_uv() {
  command -v uv >/dev/null 2>&1 && return 0
  echo "uv is not on PATH (looked in $HOME/.local/bin)."
  echo "Install it, or run this in a shell where uv works:  source ~/.local/bin/env"
  return 1
}

# Dependencies, on the same rule as the page: a pull can change uv.lock, and a
# venv built from the old one would then run the wrong ADK.
if [ ! -d .venv ]; then
  need_uv || exit 1
  uv_sync
  touch .venv/.synced
elif [ ! -f .venv/.synced ] || [ uv.lock -nt .venv/.synced ] || [ pyproject.toml -nt .venv/.synced ]; then
  echo "the dependency lock changed since the last sync; running uv sync"
  if need_uv; then
    uv_sync
    touch .venv/.synced
  else
    echo "carrying on with the venv as it is; it may not match uv.lock"
  fi
fi

# The built page is not in git, so a `git pull` brings new sources and leaves
# the old build in place. Rebuild when the sources are newer than the build,
# so starting the server is all anyone has to remember. REBUILD=1 forces it.
needs_build=0
[ -f web/dist/index.html ] || needs_build=1
if [ "$needs_build" = 0 ] && [ -n "$(find web/src web/index.html web/package.json -newer web/dist/index.html -print -quit 2>/dev/null)" ]; then
  needs_build=1
  echo "the page sources changed since the last build; rebuilding"
fi
[ "${REBUILD:-0}" = "1" ] && needs_build=1
if [ "$needs_build" = 1 ]; then
  (cd web && ([ -d node_modules ] || npm install) && npm run build)
fi

# The nine student files are not in git; a fresh clone has none of them and
# the server would fail to import. Missing ones come from starter/; present
# ones are the student's and are left alone.
for f in stage0_prompt/agent.py stage1_fanout/agent.py stage2_direction/agent.py stage3_router/agent.py stage4_memory/agent.py stage5_rag/agent.py stage6_video/agent.py agent/graph.py agent/deliver.py; do
  if [ ! -f "$f" ]; then
    cp "starter/$f" "$f"
    echo "put $f in place from starter/"
  fi
done

stop_port "$PORT"
.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port "$PORT" \
  --timeout-graceful-shutdown 3 &
SERVER_PID=$!
echo "Vibe Studio on http://localhost:$PORT  (Ctrl+C stops everything)"
wait "$SERVER_PID"
