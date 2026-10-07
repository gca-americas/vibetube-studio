"""`python vibestudio/deploy.py` - ship the app to Cloud Run.

One `gcloud run deploy --source vibestudio`: Cloud Build reads the Dockerfile,
builds the page and the server into one image, and Cloud Run serves it.
The environment the graph needs travels with the deploy, read from the same
places the lab uses, so nothing is copied by hand:

    .env                     GOOGLE_CLOUD_PROJECT, STUDIO_VERTEX, STUDIO_MODEL,
                             STUDIO_REAL_VIDEO, the Veo knobs, VIBETUBE_*
    runs/memorybank.json     -> STUDIO_MEMORY_BANK
    runs/ragcorpus.json      -> STUDIO_RAG_CORPUS

Prints the service URL at the end and keeps it in runs/deploy.json.
Options: --project, --region (default us-central1), --service (default vibestudio).
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent            # vibestudio/
REPO = HERE.parent
RUNS = REPO / "runs"
PASS_THROUGH = ["STUDIO_VERTEX", "STUDIO_MODEL", "STUDIO_IMAGE_MODEL", "STUDIO_REAL_VIDEO", "STUDIO_TRACING", "VIBETUBE_PROJECT",
                "STUDIO_VEO_MODEL", "STUDIO_VEO_LOCATION", "STUDIO_VIDEO_RETRIES", "STUDIO_VIDEO_INTERVAL",
                "STUDIO_VIDEO_TIMEOUT", "VIBETUBE_URL", "VIBETUBE_EVENT", "VIBETUBE_NAME"]


def dotenv() -> dict[str, str]:
    out: dict[str, str] = {}
    p = REPO / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def cached(name: str) -> str:
    p = RUNS / name
    try:
        return json.loads(p.read_text())["name"]
    except (OSError, ValueError, KeyError):
        return ""


RUNTIME_ROLES = ("roles/aiplatform.user", "roles/cloudbuild.builds.builder", "roles/logging.logWriter", "roles/cloudtrace.agent")


def ensure_runtime_account(project: str) -> str | None:
    """The default compute service account builds and runs the service. In an
    organisation's project it starts with no roles, so the build cannot push
    its image and the service cannot call Vertex AI. Grant what is missing,
    idempotently; say what a project Owner has to run when we cannot."""
    def g(*args: str) -> str:
        r = subprocess.run(["gcloud", *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else ""
    number = g("projects", "describe", project, "--format=value(projectNumber)")
    if not number:
        print("  runtime account: could not read the project number; roles not checked"); return None
    sa = f"{number}-compute@developer.gserviceaccount.com"
    held = g("projects", "get-iam-policy", project, "--flatten=bindings[].members", f"--filter=bindings.members:{sa}", "--format=value(bindings.role)").split()
    if "roles/editor" in held or "roles/owner" in held:
        print(f"  runtime account: {sa} (editor)"); return sa
    missing = [r for r in RUNTIME_ROLES if r not in held]
    if not missing:
        print(f"  runtime account: {sa} has its roles"); return sa
    failed = []
    for role in missing:
        r = subprocess.run(["gcloud", "projects", "add-iam-policy-binding", project, f"--member=serviceAccount:{sa}", f"--role={role}", "--condition=None", "-q"], capture_output=True, text=True)
        if r.returncode != 0:
            failed.append(role)
    if failed:
        print(f"  runtime account: {sa} lacks {' '.join(failed)} and this account cannot grant them; the deploy will fail with PERMISSION_DENIED.")
        print("  A project Owner runs:")
        for role in failed:
            print(f"    gcloud projects add-iam-policy-binding {project} --member=serviceAccount:{sa} --role={role}")
    else:
        print(f"  runtime account: {sa} granted {' '.join(missing)}")
    return sa


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)      # the page streams this output
    ap = argparse.ArgumentParser(description="deploy the Vibe Studio app to Cloud Run")
    ap.add_argument("--project", default=None)
    ap.add_argument("--region", default=os.environ.get("STUDIO_DEPLOY_REGION", "us-central1"))
    ap.add_argument("--service", default=os.environ.get("STUDIO_DEPLOY_SERVICE", "vibestudio"))
    a = ap.parse_args()
    env = {**dotenv(), **{k: v for k, v in os.environ.items() if k in PASS_THROUGH or k.startswith("GOOGLE_CLOUD_PROJECT")}}
    project = a.project or env.get("GOOGLE_CLOUD_PROJECT") or env.get("STUDIO_GCP_PROJECT")
    if not project:
        print("no project: set GOOGLE_CLOUD_PROJECT in .env or pass --project"); return 2
    bank = os.environ.get("STUDIO_MEMORY_BANK") or cached("memorybank.json")
    corpus = os.environ.get("STUDIO_RAG_CORPUS") or cached("ragcorpus.json")
    for what, val, cmd in (("Memory Bank", bank, "python -m agent.platform.bank"), ("RAG corpus", corpus, "python -m agent.platform.rag")):
        print(f"  {what}: {val or '(none: run ' + cmd + ' first; the app degrades without it)'}")
    vars_ = {"GOOGLE_CLOUD_PROJECT": project, "STUDIO_GCP_PROJECT": project, "STUDIO_VERTEX": "1",
             "STUDIO_MEMORY_BANK": bank, "STUDIO_RAG_CORPUS": corpus}
    for k in PASS_THROUGH:
        if env.get(k):
            vars_[k] = env[k]
    vars_ = {k: v for k, v in vars_.items() if v}
    for k in ("VIBETUBE_URL", "VIBETUBE_EVENT", "VIBETUBE_NAME", "VIBETUBE_PROJECT"):
        print(f"  {k}: {vars_.get(k) or '(not in .env; the app\'s profile drawer can set it)'}")
    runtime_sa = ensure_runtime_account(project)
    # gcloud splits on commas unless a custom delimiter is declared: ^|^ makes | the separator
    env_arg = "^|^" + "|".join(f"{k}={v}" for k, v in vars_.items())
    cmd = ["gcloud", "run", "deploy", a.service, "--source", str(HERE), "--project", project, "--region", a.region,
           "--labels", "dev-tutorial-codelab=vibetube",
           "--allow-unauthenticated", "--memory", "2Gi", "--cpu", "2", "--timeout", "3600",
           *(["--service-account", runtime_sa] if runtime_sa else []),
           "--concurrency", "40", "--max-instances", "1", "--min-instances", "1", "--session-affinity",
           "--set-env-vars", env_arg, "--quiet"]
    print(f"── deploying {a.service} to Cloud Run · project {project} · region {a.region} ──")
    print("  env: " + ", ".join(k for k in vars_))
    print("  " + " ".join(c if " " not in c else repr(c) for c in cmd[:11]) + " …")
    print("  Cloud Build builds the image (the page and the server); the first deploy takes a few minutes.")
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    url = ""
    assert proc.stdout
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            print("  " + line)
        m = re.search(r"https://[\w.-]+\.run\.app", line)
        if m:
            url = m.group(0)
    code = proc.wait()
    if code != 0:
        print("deploy failed. If the output says PERMISSION_DENIED on artifactregistry, storage, logging or aiplatform, the runtime account above lacks a role; the grants it needs are printed above it.")
        print(f"deploy failed (gcloud exited {code}). Common causes: the Cloud Run and Cloud Build APIs are off "
              f"(gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project {project}), "
              "or the account cannot deploy.")
        return code
    if not url:
        out = subprocess.run(["gcloud", "run", "services", "describe", a.service, "--project", project, "--region", a.region,
                              "--format", "value(status.url)"], capture_output=True, text=True)
        url = out.stdout.strip()
    RUNS.mkdir(exist_ok=True)
    (RUNS / "deploy.json").write_text(json.dumps({"url": url, "service": a.service, "project": project, "region": a.region,
                                                  "at": time.time()}, indent=2))
    print(f"── deployed in {round(time.time() - t0)}s ──")
    print(f"SERVICE_URL={url}")
    print("The service account Cloud Run uses needs GEAP access (roles/aiplatform.user) for Gemini, Memory Bank, "
          "RAG Engine and Veo; the project's default compute account usually has it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
