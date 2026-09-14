#!/usr/bin/env bash
# Vibe Studio — one-shot environment setup for the codelab. Safe to re-run:
# every step checks what is already there and keeps what you chose before.
#
# Run ./setup_project.sh FIRST: this script reads the project it recorded in
# ~/project_id.txt. When it finishes you have:
#   • uv, a .venv, and exactly what uv.lock pins inside it
#   • the APIs this lab calls, enabled on that project
#   • a .env that sends every model call to GEAP with your own credentials
#   • one real Gemini call, proven, before any step depends on it
#   • the editable files in the state students receive, on a first setup only
#   • the learning center built and running in the background on port 4600
#
# It asks two questions, the room's event code and the name the room credits
# you by. Enter takes the default, and a previous answer is the default the
# next time. With no terminal attached both take the default, so the script
# also runs from another script or a container.
#
# What it does NOT do: create the Memory Bank or the RAG corpus. Those are
# steps 6 and 7 of the lab; you press the button yourself.
# `sh scripts/restart.sh` runs a bash script under another shell. Re-enter under
# bash rather than fail somewhere later on a construct sh does not have.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4600}"
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
tick() { printf '  ✓ %s\n' "$1"; }
info() { printf '  · %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1" >&2; }
die() {
    printf '\n\033[1m✗ %s\033[0m\n\n' "$1" >&2
    shift
    for line in "$@"; do printf '%s\n' "$line" >&2; done
    printf '\n' >&2
    exit 1
}

say "Vibe Studio · setup"

# ── 1 · python env + deps (uv owns both) ────────────────────────────────────
UV_WAS_INSTALLED=0
if ! command -v uv >/dev/null 2>&1; then
    info "uv not found — installing it from astral.sh"
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || die \
        "Could not install uv." \
        "Install it by hand, then re-run ./setup_codelab.sh:" \
        "  curl -LsSf https://astral.sh/uv/install.sh | sh" \
        "  source ~/.local/bin/env"
    if [ -f "$HOME/.local/bin/env" ]; then
        set +u
        # shellcheck disable=SC1091
        . "$HOME/.local/bin/env"
        set -u
    fi
    export PATH="$HOME/.local/bin:$PATH"
    UV_WAS_INSTALLED=1
fi
command -v uv >/dev/null 2>&1 || die \
    "uv installed but is not on PATH." \
    "Put it there, then re-run ./setup_codelab.sh:" \
    "  source ~/.local/bin/env"
tick "uv $(uv --version 2>/dev/null | awk '{print $2}')"

[ -d .venv ] || uv venv >/dev/null
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

uv_sync
[ -x .venv/bin/python ] || die \
    "uv sync finished but .venv/bin/python is missing." \
    "Clear the env and let uv rebuild it:" \
    "  rm -rf .venv && ./setup_codelab.sh"
tick ".venv in sync with uv.lock (google-adk $(uv run python -c 'import google.adk;print(google.adk.__version__)' 2>/dev/null || echo pinned)) — activate it with: source .venv/bin/activate"

command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || die \
    "node and npm are needed to build the learning center's page." \
    "Cloud Shell has them. On a laptop install Node 20 or newer, then re-run ./setup_codelab.sh."
tick "node $(node --version) · npm $(npm --version)"

# ── 2 · the project and the APIs this lab calls ─────────────────────────────
say "1 · Project and APIs"

PROJECT=""
PROJECT_FILE="$HOME/project_id.txt"
if [ -f "$PROJECT_FILE" ]; then
    PROJECT="$(tr -d '[:space:]' < "$PROJECT_FILE" || true)"
    [ -n "$PROJECT" ] && info "project: $PROJECT (from $PROJECT_FILE)"
fi
if [ -z "$PROJECT" ]; then
    PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
    [ -n "$PROJECT" ] && info "project: $PROJECT (from gcloud config)"
fi
[ -n "$PROJECT" ] || die \
    "No Google Cloud project to point at." \
    "This script reads the project ./setup_project.sh records. Run that first:" \
    "" \
    "  ./setup_project.sh" \
    "" \
    "Already have a project? Tell this lab about it and re-run:" \
    "  echo YOUR_PROJECT_ID > ~/project_id.txt" \
    "  gcloud config set project YOUR_PROJECT_ID"

gcloud config set project "$PROJECT" -q >/dev/null 2>&1 || true

# Enabling an API that is already on is a no-op, so this is safe to repeat.
enable_api() {
    local api="$1" what="$2"
    gcloud services enable "$api" --project="$PROJECT" -q 2>/dev/null || die \
        "Could not enable $api on $PROJECT." \
        "Usually billing is not on the project yet, or the project is seconds old" \
        "and its IAM policy is still propagating. Wait a minute, then re-run:" \
        "" \
        "  ./setup_project.sh    # confirms billing, waits for the project" \
        "  ./setup_codelab.sh"
    tick "$api  ($what)"
}
enable_api aiplatform.googleapis.com "Gemini · Veo · Memory Bank · RAG Engine"
enable_api vectorsearch.googleapis.com "the vector store behind a RAG Engine corpus"
enable_api run.googleapis.com "Cloud Run, step 9"
enable_api cloudbuild.googleapis.com "Cloud Build, builds the container in step 9"
enable_api artifactregistry.googleapis.com "Artifact Registry, holds the image in step 9"
enable_api cloudtrace.googleapis.com "Cloud Trace, the app's traces"

# ── 3 · the room: the only two questions ────────────────────────────────────
say "2 · The room"

# A previous run's answers are this run's defaults, so re-running never
# clobbers what you chose.
env_get() {
    [ -f .env ] || return 0
    grep -s "^$1=" .env | tail -1 | cut -d= -f2- || true
}
ask() {
    local prompt="$1" default="$2" reply=""
    if [ -t 0 ]; then
        read -r -p "  $prompt [$default]: " reply || reply=""
    else
        printf '  · no terminal — %s takes the default (%s)\n' "$prompt" "$default" >&2
    fi
    reply="$(printf '%s' "${reply:-$default}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    printf '%s' "${reply:-$default}"
}

EVENT_DEFAULT="$(env_get VIBETUBE_EVENT)"; [ -n "$EVENT_DEFAULT" ] || EVENT_DEFAULT="sandbox"
NAME_DEFAULT="$(env_get VIBETUBE_NAME)"
if [ -z "$NAME_DEFAULT" ]; then
    ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
    NAME_DEFAULT="$(printf '%s' "${ACCOUNT%%@*}" | tr '._-' '   ' \
        | awk '{for (i = 1; i <= NF; i++) $i = toupper(substr($i, 1, 1)) substr($i, 2); print}')"
    [ -n "$NAME_DEFAULT" ] || NAME_DEFAULT="Anonymous Creator"
fi

info "the room your videos are published to, and the name they are credited to"
info "press Enter to take the [default] — both answers live in .env, editable later"
VIBETUBE_EVENT="$(ask 'vibetube.dev event code' "$EVENT_DEFAULT")"
VIBETUBE_NAME="$(ask 'Your name, or your channel name' "$NAME_DEFAULT")"
# The platform keeps one video per project and room, and the project it means
# is this Google Cloud project. An id of our own invention would let one project
# publish twice, so this is not a value to derive from a name.
VIBETUBE_PROJECT="$PROJECT"
PREVIOUS_VT_PROJECT="$(env_get VIBETUBE_PROJECT)"
if [ -n "$PREVIOUS_VT_PROJECT" ] && [ "$PREVIOUS_VT_PROJECT" != "$VIBETUBE_PROJECT" ]; then
    info "VIBETUBE_PROJECT was $PREVIOUS_VT_PROJECT; it is the Google Cloud project id, so it becomes $VIBETUBE_PROJECT"
fi
tick "room: $VIBETUBE_EVENT · credited as \"$VIBETUBE_NAME\" · publishing as project $VIBETUBE_PROJECT"

# ── 4 · .env, written whole, previous values kept ───────────────────────────
say "3 · .env"

REAL_VIDEO="$(env_get STUDIO_REAL_VIDEO)"; [ -n "$REAL_VIDEO" ] || REAL_VIDEO=1
VEO_MODEL="$(env_get STUDIO_VEO_MODEL)"; [ -n "$VEO_MODEL" ] || VEO_MODEL="veo-3.1-fast-generate-001"
MANAGED="STUDIO_VERTEX GOOGLE_CLOUD_PROJECT STUDIO_GCP_PROJECT GOOGLE_CLOUD_LOCATION STUDIO_VEO_MODEL STUDIO_VEO_LOCATION GOOGLE_CLOUD_LOCATION_MB GOOGLE_CLOUD_LOCATION_RAG STUDIO_REAL_VIDEO VIBETUBE_URL VIBETUBE_EVENT VIBETUBE_NAME VIBETUBE_PROJECT"

[ -f .env ] && cp .env .env.bak && info "previous .env saved as .env.bak"

# Lines of the previous .env whose key this script does not manage, so a
# variable you added by hand (STUDIO_MODEL, STUDIO_VIDEO_TIMEOUT, ...) is kept.
keep_extra() {
    [ -f .env.bak ] || return 0
    local line key printed=0
    while IFS= read -r line; do
        key="${line%%=*}"
        if ! printf ' %s ' "$MANAGED" | grep -q " $key "; then
            if [ "$printed" -eq 0 ]; then
                echo ""
                echo "# ── kept from your previous .env ──"
                printed=1
            fi
            printf '%s\n' "$line"
        fi
    done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.bak || true)
}
{
    echo "# Written by ./setup_codelab.sh — safe to edit, safe to re-run (your values are kept)."
    echo ""
    echo "# ── auth: Cloud Shell / GEAP via ADC (no keys) ──"
    echo "STUDIO_VERTEX=1"
    echo "GOOGLE_CLOUD_PROJECT=$PROJECT"
    echo "STUDIO_GCP_PROJECT=$PROJECT"
    echo ""
    echo "# ── three services, three locations; they are not interchangeable ──"
    echo "# Gemini → global: dynamic shared quota across regions (agent/platform/config.py)"
    echo "GOOGLE_CLOUD_LOCATION=global"
    echo "# Veo → us-central1: video generation is regional, there is no global endpoint (agent/platform/videogen.py)"
    echo "STUDIO_VEO_MODEL=$VEO_MODEL"
    echo "STUDIO_VEO_LOCATION=us-central1"
    echo "# Memory Bank and RAG Engine → us-central1: Agent Engine and RAG are regional (agent/platform/memory.py, rag.py)"
    echo "GOOGLE_CLOUD_LOCATION_MB=us-central1"
    echo "GOOGLE_CLOUD_LOCATION_RAG=us-central1"
    echo ""
    echo "# ── the render: 1 = real Veo (minutes, real credit), 0 = a stand-in that finishes in seconds ──"
    echo "STUDIO_REAL_VIDEO=$REAL_VIDEO"
    echo ""
    echo "# ── the room's shared platform ──"
    echo "VIBETUBE_URL=https://vibetube.dev"
    echo "VIBETUBE_EVENT=$VIBETUBE_EVENT"
    echo "VIBETUBE_NAME=$VIBETUBE_NAME"
    echo "VIBETUBE_PROJECT=$VIBETUBE_PROJECT"
    # anything else you added by hand survives a re-run
    keep_extra
} > .env.tmp
mv .env.tmp .env
tick "wrote .env — GEAP via ADC on $PROJECT, no API key anywhere"

# Veo is regional and this lab renders for real: confirm the model is served
# where .env points. A metadata GET, no render, no cost.
VEO_TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
VEO_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -H "Authorization: Bearer $VEO_TOKEN" -H "x-goog-user-project: $PROJECT" \
    "https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models/$VEO_MODEL" 2>/dev/null || echo 000)"
if [ "$VEO_STATUS" = "200" ]; then
    tick "Veo: $VEO_MODEL is served in us-central1"
else
    warn "Veo did not confirm in us-central1 (HTTP $VEO_STATUS). Renders may fail; STUDIO_REAL_VIDEO=0 in .env runs cost-free."
fi

ROOM_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://vibetube.dev/api/events/$VIBETUBE_EVENT" 2>/dev/null || echo 000)"
if [ "$ROOM_STATUS" = "200" ]; then
    tick "room reachable: https://vibetube.dev/api/events/$VIBETUBE_EVENT"
else
    warn "the room did not answer (HTTP $ROOM_STATUS). Everything but publishing works without it."
fi

# ── 5 · prove the model answers ─────────────────────────────────────────────
say "4 · Live model call"
uv run python - <<'PY'
import os
from dotenv import load_dotenv
load_dotenv(".env", override=True)
if os.environ.get("STUDIO_VERTEX", "").lower() in ("1", "true"):
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"
    os.environ.pop("GOOGLE_API_KEY", None)
import logging; logging.getLogger("google_genai.models").setLevel(logging.ERROR)   # an advisory about function calling we do not use
from google import genai
model = os.environ.get("STUDIO_MODEL", "gemini-3-flash-preview")
client = genai.Client()          # keep a reference: a temporary client is closed before the call returns
r = client.models.generate_content(model=model, contents="Reply with exactly: vibe studio, ready to roll.")
print(f"  ✓ {model}:", (r.text or "").strip()[:60])
PY

# ── 6 · the state students receive ──────────────────────────────────────────
# A first setup carves the editable files back to their TODO form and clears
# any run state, so the lab starts where a student starts. A later run leaves
# your files alone: re-running this script must never discard your work.
say "5 · Starting state"
# The nine files students edit are not in git. Each one is copied from
# starter/ when it is missing, and an existing one is never touched: a re-run
# of this script keeps your work. scripts/starter.sh is the reset.
placed=0
for f in stage0_prompt/agent.py stage1_fanout/agent.py stage2_direction/agent.py stage3_router/agent.py stage4_memory/agent.py stage5_rag/agent.py stage6_video/agent.py agent/graph.py agent/deliver.py; do
    if [ ! -f "$f" ]; then
        mkdir -p "$(dirname "$f")" && cp "starter/$f" "$f"
        placed=$((placed + 1))
    fi
done
if [ "$placed" -gt 0 ]; then
    tick "$placed editable file(s) put in place from starter/, holding their TODO lines"
else
    info "your files are left as they are"
    info "to reset the lab to the state students receive: scripts/starter.sh"
fi

# ── 7 · the learning center: build the page, start the server in the background ──
say "6 · The learning center"
mkdir -p runs
(cd web && ([ -d node_modules ] || npm install --no-fund --no-audit >/dev/null 2>&1) && npm run build >/dev/null 2>&1) || die \
    "The page did not build." \
    "Run it by hand to see why:  cd web && npm install && npm run build"
tick "page built (web/dist)"

# scripts/start.sh stops an earlier instance on the port before it starts, so a
# re-run replaces the running server instead of adding a second one.
PORT="$PORT" nohup scripts/start.sh > runs/lab.log 2>&1 &
for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$PORT/api/lab/inspector"; then break; fi
    sleep 1
done
if curl -s -o /dev/null "http://localhost:$PORT/api/lab/inspector"; then
    tick "learning center running in the background on http://localhost:$PORT  (log: runs/lab.log)"
    info "Cloud Shell: Web Preview → Change port → $PORT"
    info "stop it with:  scripts/stop.sh"
else
    die "The learning center did not answer on port $PORT within a minute." \
        "Read runs/lab.log, then start it by hand:  scripts/start.sh"
fi

# ── 8 · the two cloud resources, created while you read ─────────────────────
# A corpus takes a minute or two to come up and the bank about twenty seconds.
# Both commands create once and connect ever after, so starting them here costs
# nothing and steps 6 and 7 find them ready. A creation lock in agent/platform
# keeps a click in the lab from creating a second one while these run.
say "7 · Memory Bank and RAG Engine"
if [ -f runs/memorybank.json ] && [ -f runs/ragcorpus.json ]; then
    tick "both are already connected"
else
    [ -f runs/memorybank.json ] || nohup .venv/bin/python -m agent.platform.bank > runs/bank_setup.log 2>&1 &
    [ -f runs/ragcorpus.json ] || nohup .venv/bin/python -m agent.platform.rag > runs/rag_setup.log 2>&1 &
    info "creating them in the background; steps 6 and 7 will find them ready"
    info "logs: runs/bank_setup.log · runs/rag_setup.log"
fi

# ── 9 · preflight, run for you: nothing else to type ────────────────────────
say "8 · Preflight"
info "checking the environment, the APIs, and the learning center"
uv run python scripts/preflight.py || warn "preflight found something to fix; the ✗ lines above say what"

mkdir -p runs

# ── where to go next, spelled out ───────────────────────────────────────────
# Cloud Shell puts the preview host in WEB_HOST; elsewhere it is localhost.
if [ -n "${WEB_HOST:-}" ]; then
    LAB_URL="https://$PORT-$WEB_HOST"
else
    LAB_URL="http://localhost:$PORT"
fi

printf '\n\033[1m%s\033[0m\n' "Setup finished. The learning center is already running."
printf '\n'
printf '  \033[1mOpen this and start at step 1\033[0m\n'
printf '      %s/step/story\n\n' "$LAB_URL"
printf '  It runs in the background. You do not need to start anything else.\n'
printf '      log      runs/lab.log\n'
printf '      stop     scripts/stop.sh\n'
printf '      start    scripts/start.sh\n'
printf '      restart  scripts/restart.sh   after a git pull\n\n'
printf '  Already run for you, and repeatable at any time:\n'
printf '      python scripts/preflight.py     re-check the environment\n'
printf '      ./setup_codelab.sh              re-run this script; your files are kept\n\n'
[ "$UV_WAS_INSTALLED" -eq 1 ] && printf '  uv was just installed. Run this to get it in this shell:  source ~/.local/bin/env\n\n'
[ -n "${WEB_HOST:-}" ] || printf '  In Cloud Shell the link is also under Web Preview → Change port → %s.\n\n' "$PORT"
