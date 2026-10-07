"""One command, all the ticks - run this before the lab starts.
Run: python scripts/preflight.py [--ping]   (--ping spends one tiny model call)"""
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ok = True


def tick(name, cond, hint=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"   → {hint}"))
    ok = ok and bool(cond)


v = sys.version_info
tick(f"python {v.major}.{v.minor}", (3, 12) <= (v.major, v.minor) < (3, 13),
     "use the repo venv: uv sync && source .venv/bin/activate")
try:
    import greenlet  # noqa: F401
    tick("greenlet (async sqlite)", True)
except ImportError:
    tick("greenlet (async sqlite)", False, "uv sync")

from agent.platform import config  # noqa: E402
if os.environ.get("STUDIO_VERTEX", "").lower() in ("1", "true"):   # same rule as agent/platform/config.py
    tick("auth path A: Vertex via ADC (STUDIO_VERTEX=1)", True)
else:
    tick("auth path B: GOOGLE_API_KEY set", bool(os.environ.get("GOOGLE_API_KEY")),
         "cp .env.example .env — path A (Cloud Shell) or paste an AI Studio key")

if "--ping" in sys.argv:
    try:
        from google import genai
        r = genai.Client(api_key=os.environ["GOOGLE_API_KEY"]).models.generate_content(
            model=config.MODEL, contents="reply exactly: OK")
        tick(f"model ping ({config.MODEL})", "OK" in (r.text or ""), "check the key")
    except Exception as e:
        tick(f"model ping ({config.MODEL})", False, str(e)[:70])

no_mb = os.environ.get("STUDIO_NO_MB")
try:
    import google.auth
    _, adc_project = google.auth.default()
    tick(f"Google Cloud ADC (project {adc_project})", bool(adc_project))
except Exception as e:
    tick("Google Cloud ADC", False, f"gcloud auth application-default login   ({str(e)[:50]})")
if no_mb:
    print("  - Memory Bank: skipped (STUDIO_NO_MB=1 — notes fall back to empty)")
else:
    try:
        import vertexai  # noqa: F401
        tick("Memory Bank SDK", True)
    except ImportError:
        tick("Memory Bank SDK", False, "uv sync")

# the four stage apps the workflow act grows through - adk web lists them
for app in ("stage0_prompt", "stage1_fanout", "stage2_direction", "stage3_router",
            "stage4_memory", "stage5_rag", "stage6_video"):
    try:
        mod = __import__(f"{app}.agent", fromlist=["root_agent"])
        n = getattr(getattr(mod.root_agent, "graph", None), "edges", None)
        label = f"{app} loads" + (f" ({len(n)} edges)" if n is not None else "")
        tick(label, True)
    except Exception as e:
        tick(f"{app} loads", False, str(e)[:70])

# ── the tools and the services the lab calls ────────────────────────────────
import shutil
import subprocess
import urllib.request

tick("node and npm (build the learning center's page)", bool(shutil.which("node") and shutil.which("npm")),
     "Cloud Shell has them; on a laptop install Node 20 or newer")
tick("learning center page built (web/dist)", (ROOT / "web" / "dist" / "index.html").exists(),
     "./setup_codelab.sh   (or: cd web && npm install && npm run build)")

project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
if shutil.which("gcloud") and project:
    try:
        out = subprocess.run(["gcloud", "services", "list", "--enabled", f"--project={project}", "--format=value(config.name)"],
                             capture_output=True, text=True, timeout=60).stdout.split()
        for api, what in (("aiplatform.googleapis.com", "Gemini, Veo, Memory Bank, RAG Engine"),
                          ("vectorsearch.googleapis.com", "the vector store a RAG corpus is built on"),
                          ("run.googleapis.com", "Cloud Run"),
                          ("cloudbuild.googleapis.com", "Cloud Build"), ("artifactregistry.googleapis.com", "Artifact Registry"),
                          ("cloudtrace.googleapis.com", "Cloud Trace")):
            tick(f"{api} enabled ({what})", api in out, f"gcloud services enable {api} --project={project}   (./setup_codelab.sh does this)")
    except Exception as e:
        tick("APIs enabled", False, f"could not list services: {str(e)[:60]}")
else:
    tick("APIs enabled", False, "gcloud and GOOGLE_CLOUD_PROJECT are needed to check; run ./setup_project.sh then ./setup_codelab.sh")

# The two cloud resources: setup creates them in the background, so "not yet"
# is a normal answer minutes after setup and never a failure.
for label, cache, lock, step in (("Memory Bank", "memorybank.json", ".memorybank.lock", "6"),
                                 ("RAG corpus", "ragcorpus.json", ".ragcorpus.lock", "7")):
    if (ROOT / "runs" / cache).exists():
        print(f"  ✓ {label} connected")
    elif (ROOT / "runs" / lock).exists():
        print(f"  - {label}: still being created in the background")
    else:
        print(f"  - {label}: not created yet (step {step} creates it)")

# step 9 runs as the default compute account; in an organisation's project it may hold nothing
try:
    import subprocess
    _proj = os.environ.get("GOOGLE_CLOUD_PROJECT") or ""
    _num = subprocess.run(["gcloud", "projects", "describe", _proj, "--format=value(projectNumber)"], capture_output=True, text=True, timeout=20).stdout.strip() if _proj else ""
    if _num:
        _sa = f"{_num}-compute@developer.gserviceaccount.com"
        _held = subprocess.run(["gcloud", "projects", "get-iam-policy", _proj, "--flatten=bindings[].members", f"--filter=bindings.members:{_sa}", "--format=value(bindings.role)"], capture_output=True, text=True, timeout=30).stdout.split()
        _need = ["roles/aiplatform.user", "roles/cloudbuild.builds.builder", "roles/logging.logWriter", "roles/cloudtrace.agent"]
        _missing = [] if ("roles/editor" in _held or "roles/owner" in _held) else [r for r in _need if r not in _held]
        tick(f"step 9 runtime account {_sa} has its roles", not _missing, "missing " + " ".join(_missing) + " · ./setup_codelab.sh grants them (needs a project Owner)")
except Exception:
    pass

port = os.environ.get("PORT", "4600")
try:
    with urllib.request.urlopen(f"http://localhost:{port}/api/lab/inspector", timeout=3) as r:
        up = r.status == 200
except Exception:
    up = False
tick(f"learning center running on port {port}", up, "./setup_codelab.sh starts it in the background; or scripts/start.sh")

if up:
    # A pull moves the checkout, not a running interpreter.
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/api/lab/version", timeout=3) as r:
            v = json.loads(r.read())
    except Exception:
        v = {}
    if v.get("stale"):
        print(f"  ! it is running {v['running']}, the checkout is at {v['head']}")
        print("    run scripts/restart.sh to load the code you pulled")
    elif v.get("running"):
        print(f"  · code {v['running']} \u00b7 {v.get('subject', '')[:56]}")

print("\nPREFLIGHT " + ("GREEN" if ok else "NOT READY - fix the ✗ lines above"))
if up:
    # Cloud Shell exposes WEB_HOST for its web preview; elsewhere localhost is the link
    host = os.environ.get("WEB_HOST", "")
    link = f"https://{port}-{host}/step/story" if host else f"http://localhost:{port}/step/story"
    print(f"\nOpen step 1 here:  {link}")
sys.exit(0 if ok else 1)
