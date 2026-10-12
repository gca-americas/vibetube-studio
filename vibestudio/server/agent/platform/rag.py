"""The audience's feedback - GEAP RAG Engine, in your project.

RAG Engine is retrieval over DOCUMENTS: you hand it files, it splits them
into passages, embeds each passage with an embedding model, and stores the
vectors in a managed vector store. A query is embedded the same way, and
the passages whose vectors sit nearest come back. Nearby vectors mean
similar meaning, so a comment about "the tiny dragon guarding one sock"
answers a query about "small magic in the kitchen" without sharing a word.

Here the documents are the audience's comments on the channel's past videos
(agent/comments.md), and the workflow reads them through one more node in
the research fan-out (step 7): read_feedback in agent/graph.py.

Console:  python -m agent.platform.rag                 create the corpus (once), or connect
          python -m agent.platform.rag load            upload agent/comments.md; rerun after editing it
          python -m agent.platform.rag query "text"    the passages nearest to a question
          python -m agent.platform.rag list            the files in the corpus
          python -m agent.platform.rag reset           delete every file; the corpus stays

The corpus is a RAG Engine resource in your project. Its name is cached in
runs/ragcorpus.json; that file is the connection. A person's preferences
belong in Memory Bank (step 6); what people wrote belongs here.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import warnings

from . import config
from .memory import _call, creation_lock, project

CORPUS_CACHE = config.RUNS / "ragcorpus.json"
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION_RAG", "us-central1")   # RAG Engine is regional: where a new corpus is tried first
#: Where to try next when the preferred region cannot make a corpus: RAG
#: Engine's serverless backend runs out of indexing capacity in a region now
#: and then ("No available indexing project found"), and a project's Vector
#: Search collections quota is per region, so a region whose quota failed
#: attempts have used up is left behind rather than fought.
FALLBACK_LOCATIONS = ("us-east4", "us-west1", "europe-west4")
DISPLAY = "vibestudio-feedback"
EMBEDDING_MODEL = "text-embedding-005"
COMMENTS_FILE = pathlib.Path(__file__).resolve().parents[1] / "comments.md"   # agent/comments.md, one level up from agent/platform/
CHUNK_TOKENS = 120        # a passage is a few comments, not the whole file
CHUNK_OVERLAP = 20
TOP_K = 5
_inited = False


def _location() -> str:
    """The region the corpus lives in, read from its resource name when one
    is known; the preferred region before there is a corpus."""
    name = os.environ.get("STUDIO_RAG_CORPUS") or (json.loads(CORPUS_CACHE.read_text())["name"] if CORPUS_CACHE.exists() else "")
    parts = name.split("/")
    return parts[parts.index("locations") + 1] if "locations" in parts else LOCATION


_inited_for: str | None = None


def _rag(location: str | None = None):
    """The vertexai.rag module, initialised for the corpus's region."""
    global _inited_for
    import vertexai
    from vertexai import rag
    loc = location or _location()
    if _inited_for != loc:
        vertexai.init(project=project(), location=loc)
        _inited_for = loc
    return rag


def comments() -> list[str]:
    """The comments in agent/comments.md, one per line. A missing file is no
    comments, not an exception: this is read while reporting on the corpus, and
    a raised error there tells the page nothing about the corpus."""
    try:
        text = COMMENTS_FILE.read_text()
    except OSError:
        return []
    return [l[2:].strip() for l in text.splitlines() if l.startswith("- ")]


# ── the corpus ──────────────────────────────────────────────────────────────

def corpus_name(create: bool = False) -> str | None:
    """The corpus resource. STUDIO_RAG_CORPUS in the environment wins (the
    deployed app); otherwise runs/ragcorpus.json, the cache that IS the
    connection. With create=True, reuse a corpus of the same display name in
    the project, else create one."""
    if os.environ.get("STUDIO_RAG_CORPUS"):
        return os.environ["STUDIO_RAG_CORPUS"]
    if CORPUS_CACHE.exists():
        return json.loads(CORPUS_CACHE.read_text())["name"]
    if not create:
        return None
    with creation_lock("ragcorpus"):
        if CORPUS_CACHE.exists():           # another process created it while we waited
            return json.loads(CORPUS_CACHE.read_text())["name"]
        return _create_corpus()


def _api_hint(e: Exception) -> str | None:
    """A disabled API answers 403 with the console URL in it. Say which API and
    how to turn it on, rather than letting the SDK's paragraph through."""
    text = str(e)
    if "has not been used in project" not in text and "is disabled" not in text:
        return None
    for api in ("vectorsearch.googleapis.com", "aiplatform.googleapis.com"):
        if api in text:
            return (f"the {api} API is off in this project.\n"
                    f"  Turn it on, wait a minute for it to propagate, and run this command again:\n"
                    f"    gcloud services enable {api} --project {project()}")
    return None


def _regional_trouble(e: Exception) -> str | None:
    """Why a region cannot make a corpus right now, in a few words; None for
    any other error, which is not the region's fault."""
    text = str(e)
    if "No available indexing project" in text:
        return "RAG Engine has no indexing capacity there at the moment"
    if "CollectionsPerProject" in text or ("RESOURCE_EXHAUSTED" in text and "Collection" in text):
        return "the project's Vector Search collections quota there is used up (failed attempts leave collections behind)"
    return None


def _create_corpus() -> str:
    """Reuse a corpus of this display name in the project, else make one:
    in the preferred region, and when that region cannot - no capacity, or
    its quota spent - in the next, since every later call reads the region
    from the corpus's own name. Called with the creation lock held."""
    import contextlib, io
    tried: list[str] = []
    for region in (LOCATION, *[r for r in FALLBACK_LOCATIONS if r != LOCATION]):
        rag = _rag(region)
        for c in rag.list_corpora():
            if c.display_name == DISPLAY:
                print(f"  reusing the corpus already in this project: {c.name.split('/')[-1]} ({region})")
                CORPUS_CACHE.write_text(json.dumps({"name": c.name}))
                return c.name
        _serverless(region)
        quiet = io.StringIO()                     # the SDK prints DEBUG lines during create
        try:
            with contextlib.redirect_stdout(quiet):
                corpus = _call("create_corpus", lambda: rag.create_corpus(
                    display_name=DISPLAY,
                    description="Vibe Studio: what the audience wrote under the channel's past videos.",
                    backend_config=rag.RagVectorDbConfig(
                        rag_embedding_model_config=rag.RagEmbeddingModelConfig(
                            vertex_prediction_endpoint=rag.VertexPredictionEndpoint(
                                publisher_model=f"publishers/google/models/{EMBEDDING_MODEL}")))),
                    tries=3, wait_s=20.0)
        except Exception as e:
            hint = _api_hint(e)
            if hint is not None:
                raise SystemExit(f"the corpus was not created: {hint}") from None
            why = _regional_trouble(e)
            if why is None:
                raise
            tried.append(f"{region}: {why}")
            print(f"  {region}: {why}; trying the next region")
            continue
        if region != LOCATION:
            print(f"  the corpus lives in {region} rather than {LOCATION}; every call reads the region from its name")
        CORPUS_CACHE.write_text(json.dumps({"name": corpus.name}))
        return corpus.name
    raise RuntimeError("no region could create the corpus:\n  " + "\n  ".join(tried) +
                       "\n  Either wait and run this again, request a higher 'Collections per project' quota for Vector Search "
                       "in one of those regions, or put another region in .env as GOOGLE_CLOUD_LOCATION_RAG.")


def _serverless(location: str | None = None):
    """Put the project's RAG managed database in serverless mode before the
    first corpus. A fresh project defaults to a provisioned mode that is
    capacity-limited in some regions, and corpus creation then fails with
    400 INVALID_ARGUMENT. Per region, idempotent, best effort."""
    location = location or LOCATION
    try:
        import urllib.request
        import google.auth
        import google.auth.transport.requests as grt
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(grt.Request())
        req = urllib.request.Request(
            f"https://{location}-aiplatform.googleapis.com/v1beta1/projects/{project()}"
            f"/locations/{location}/ragEngineConfig",
            method="PATCH",
            data=json.dumps({"ragManagedDbConfig": {"serverless": {}}}).encode(),
            headers={"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=90).read()
        print("  ragEngineConfig: serverless")
    except Exception as e:
        print(f"  ragEngineConfig unchanged ({str(e)[:80]}); creating the corpus anyway")


# ── files ───────────────────────────────────────────────────────────────────

def list_files() -> list[dict]:
    name = corpus_name()
    if not name:
        return []
    rag = _rag()
    return [{"id": f.name.split("/")[-1], "display_name": f.display_name,
             "description": getattr(f, "description", "") or ""}
            for f in rag.list_files(name)]


def load() -> dict:
    """Upload agent/comments.md into the corpus. Rerunnable: a previous copy of
    the file is deleted first, so editing the comments and loading again
    replaces the passages instead of adding to them."""
    name = corpus_name()
    if not name:
        raise RuntimeError("no corpus connected - run: python -m agent.platform.rag")
    rag = _rag()
    for f in list_files():
        if f["display_name"] == COMMENTS_FILE.name:
            rag.delete_file(f"{name}/ragFiles/{f['id']}")
            print(f"  replaced the previous {COMMENTS_FILE.name} (ragFile {f['id']})")
    print(f"  uploading {COMMENTS_FILE.name}: {len(comments())} comments"
          f" -> passages of ~{CHUNK_TOKENS} tokens, embedded with {EMBEDDING_MODEL}")
    rf = _call("upload_file", lambda: rag.upload_file(
        corpus_name=name, path=str(COMMENTS_FILE), display_name=COMMENTS_FILE.name,
        description="the audience's comments on the channel's past videos",
        transformation_config=rag.TransformationConfig(
            chunking_config=rag.ChunkingConfig(chunk_size=CHUNK_TOKENS, chunk_overlap=CHUNK_OVERLAP))),
        tries=4, wait_s=10.0)
    print(f"  ragFile {rf.name.split('/')[-1]} · indexing…")
    probe = "what viewers liked and what they complained about"
    for _ in range(30):                       # indexing finishes a few seconds after the upload
        hits = retrieve(probe, k=3)
        if hits:
            print(f"  indexed: the probe query returned {len(hits)} passages")
            return {"file": rf.name.split("/")[-1], "comments": len(comments()), "probe_hits": len(hits)}
        time.sleep(3)
    print("  uploaded; the index is still building. Query again in a minute.")
    return {"file": rf.name.split("/")[-1], "comments": len(comments()), "probe_hits": 0}


def reset() -> int:
    """Delete every file in the corpus. The corpus itself stays."""
    name = corpus_name()
    rag = _rag()
    files = list_files()
    for f in files:
        rag.delete_file(f"{name}/ragFiles/{f['id']}")
    return len(files)


# ── retrieval ───────────────────────────────────────────────────────────────

def retrieve(query: str, k: int = TOP_K) -> list[dict]:
    """The k passages nearest to `query`: embed the question, find the nearest
    vectors, return their text. Each row: text, score, source."""
    name = corpus_name()
    if not name:
        raise RuntimeError("no corpus connected - run: python -m agent.platform.rag")
    rag = _rag()
    resp = _call("retrieval_query", lambda: rag.retrieval_query(
        rag_resources=[rag.RagResource(rag_corpus=name)], text=query,
        rag_retrieval_config=rag.RagRetrievalConfig(top_k=k)), tries=3, wait_s=4.0)
    rows = []
    for c in (getattr(getattr(resp, "contexts", None), "contexts", None) or []):
        rows.append({"text": (c.text or "").strip(), "score": round(float(c.score or 0), 3),
                     "source": getattr(c, "source_display_name", "") or ""})
    return rows


# ── console ─────────────────────────────────────────────────────────────────

def _print_hits(rows: list[dict]) -> None:
    if not rows:
        print("  (no passages)")
    for i, r in enumerate(rows, 1):
        text = " ".join(r["text"].split())
        print(f"  {i}. score {r['score']:.3f} · {text[:300]}")


def connect() -> None:
    cached = corpus_name()
    if cached:
        print(f"connected (runs/ragcorpus.json):\n  {cached}")
    else:
        print("no corpus cached - looking for one in your project, and creating it if there is none (~20s)…")
        print(f"── ready ──\n  {corpus_name(create=True)}")
    print(f"embedding model: {EMBEDDING_MODEL} · region: {_location()}")
    files = list_files()
    print(f"the corpus holds {len(files)} file(s)")
    for f in files:
        print(f"  ragFile {f['id']} · {f['display_name']}")
    if not files:
        print("next: python -m agent.platform.rag load")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    cmd = argv[0] if argv else ""
    if cmd == "":
        connect()
    elif cmd == "load":
        if not corpus_name():
            print("no corpus yet - run: python -m agent.platform.rag"); return
        print(f"── loading {COMMENTS_FILE.name} into the corpus ──")
        load()
    elif cmd == "query" and len(argv) > 1:
        q = " ".join(argv[1:])
        print(f"── the {TOP_K} passages nearest to: {q!r} ──")
        _print_hits(retrieve(q))
    elif cmd == "list":
        files = list_files()
        print(f"the corpus holds {len(files)} file(s)")
        for f in files:
            print(f"  ragFile {f['id']} · {f['display_name']} · {f['description']}")
    elif cmd == "reset":
        print(f"deleted {reset()} file(s)")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
