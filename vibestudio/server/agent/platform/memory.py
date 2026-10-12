"""The creator's memory - GEAP Agent Engine Memory Bank, in your project.

Memory Bank is long-term memory about a PERSON, scoped by user: it extracts
facts from conversations, consolidates them with what it already holds, and
hands them back by scope. Here the person is the creator, and the facts are
their taste and their standing rules:

    CREATOR_TASTE   which directions this creator picks, and how that moves
    CHANNEL_RULES   standing instructions the creator states

Two ADK callbacks connect it to the workflow (step 6), no new nodes:

    recall_taste   before_model_callback on propose_directions - reads the
                   memories and appends them to the model request
    remember_pick  after_agent_callback on scripter - writes what the creator
                   picked and shipped, so the taste keeps moving

Console:  python -m agent.platform.bank          create or connect the bank
          python -m agent.platform.bank load     seed the creator's history
          python -m agent.platform.bank list     what the bank holds

Documents belong in RAG Engine; a person's
preferences belong here.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os

from . import config

ENGINE_CACHE = config.RUNS / "memorybank.json"
BANK_DISPLAY = "vibestudio-membank"      # the bank is found by this name when the cache is gone
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION_MB", "us-central1")
SCOPE = {"app_name": config.APP, "user_id": config.USER}
TOPICS = {
    "CREATOR_TASTE": "Which video directions this creator picks and passes on, "
                     "and how that preference changes over time.",
    "CHANNEL_RULES": "Standing instructions the creator states for every video "
                     "(style, subjects to avoid, format rules).",
}
_client = None


def project() -> str:
    """YOUR project. STUDIO_GCP_PROJECT or GOOGLE_CLOUD_PROJECT, else the
    Application Default Credentials project (Cloud Shell, or gcloud auth
    application-default login)."""
    p = os.environ.get("STUDIO_GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if p:
        return p
    import google.auth
    _, adc_project = google.auth.default()
    if not adc_project:
        raise RuntimeError("no GCP project found - set STUDIO_GCP_PROJECT in .env "
                           "or run: gcloud auth application-default login")
    return adc_project


def _cli():
    global _client
    if _client is None:
        import vertexai
        _client = vertexai.Client(project=project(), location=LOCATION)
    return _client


def _bank_config():
    """The bank's configuration: its two memory topics. Topics tell
    consolidation what a memory is allowed to be about."""
    from vertexai._genai import types as vt
    topic = vt.MemoryBankCustomizationConfigMemoryTopic
    custom = vt.MemoryBankCustomizationConfigMemoryTopicCustomMemoryTopic
    return vt.AgentEngineConfig(
        display_name=BANK_DISPLAY,
        context_spec=vt.ReasoningEngineContextSpec(
            memory_bank_config=vt.ReasoningEngineContextSpecMemoryBankConfig(
                customization_configs=[vt.MemoryBankCustomizationConfig(
                    memory_topics=[topic(custom_memory_topic=custom(label=k, description=v))
                                   for k, v in TOPICS.items()])])))


def engine_name(create: bool = False) -> str | None:
    """The Agent Engine resource that hosts the bank. STUDIO_MEMORY_BANK in
    the environment wins (the deployed app); otherwise runs/memorybank.json,
    the cache that IS the connection."""
    if os.environ.get("STUDIO_MEMORY_BANK"):
        return os.environ["STUDIO_MEMORY_BANK"]
    if ENGINE_CACHE.exists():
        return json.loads(ENGINE_CACHE.read_text())["name"]
    if not create:
        return None
    with creation_lock("memorybank"):
        if ENGINE_CACHE.exists():           # another process created it while we waited
            return json.loads(ENGINE_CACHE.read_text())["name"]
        # An Agent Engine costs money to keep, and a lost cache file must not
        # buy a second one: reuse the bank of this display name if it is there,
        # the way the RAG corpus is reused.
        for eng in _existing_banks():
            print(f"  reusing the bank already in this project: {eng.split('/')[-1]}")
            ENGINE_CACHE.write_text(json.dumps({"name": eng}))
            return eng
        eng = _cli().agent_engines.create(config=_bank_config())
        ENGINE_CACHE.write_text(json.dumps({"name": eng.api_resource.name}))
        return eng.api_resource.name


def _existing_banks() -> list[str]:
    """Resource names of the Agent Engines in this project whose display name
    is the one this lab creates. Empty when listing is not permitted."""
    try:
        out = []
        for e in _cli().agent_engines.list():
            res = getattr(e, "api_resource", e)
            if getattr(res, "display_name", None) == BANK_DISPLAY and getattr(res, "name", None):
                out.append(res.name)
        return out
    except Exception:
        return []


ON_RETRY = None    # an app may set this to be told about retries (step, attempt, of, wait_s, detail); the lab prints


@contextlib.contextmanager
def creation_lock(name: str):
    """One process at a time may create a shared cloud resource, and the one
    that waits re-reads the cache instead of creating a second. Setup creates
    the bank and the corpus in the background, so a click in the lab can land
    while that is still running."""
    lock = config.RUNS / f".{name}.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def creation_in_progress(name: str) -> bool:
    """Is some process creating this resource right now? The lock file stays
    on disk after its holder is done (removing it would race a waiter), so
    the file's existence says nothing; whether the flock is held does."""
    lock = config.RUNS / f".{name}.lock"
    if not lock.exists():
        return False
    try:
        with lock.open("r+") as fh:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return True                       # held: a creation is under way
            fcntl.flock(fh, fcntl.LOCK_UN)
            return False
    except OSError:
        return False


def _call(label: str, fn, tries: int = 6, wait_s: float = 8.0):
    """Memory Bank answers 500 now and then, in bursts. Retry with a growing
    pause, then let the error through."""
    import time
    last = None
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except Exception as e:
            last = e
            if attempt < tries:
                pause = wait_s * attempt
                print(f"  [memory] {label} failed ({str(e)[:60]}), retry {attempt}/{tries - 1} in {pause:.0f}s")
                if ON_RETRY:
                    ON_RETRY(step=f"Memory Bank {label}", attempt=attempt, of=tries, wait_s=pause, detail=f"{type(e).__name__}: {str(e)[:120]}")
                time.sleep(pause)
    raise last


def _topic(m) -> str:
    for t in (getattr(m, "topics", None) or []):
        label = getattr(t, "custom_memory_topic_label", None) or getattr(t, "managed_memory_topic", None)
        if label:
            return str(label).split(".")[-1]
    fact = getattr(m, "fact", "") or ""
    if fact.startswith("[") and "]" in fact:
        return fact[1:].split("]", 1)[0].strip()
    return "NOTE"


def _row(m) -> dict:
    fact = getattr(m, "fact", "") or ""
    if fact.startswith("[") and "]" in fact:
        fact = fact.split("]", 1)[1]
    ut = getattr(m, "update_time", None)
    return {"id": m.name.split("/")[-1], "topic": _topic(m), "fact": fact.strip(),
            "updated": str(ut)[:19] if ut else ""}


def recall() -> list[dict]:
    """Every memory in the creator's scope, oldest first."""
    name = engine_name()
    if not name:
        return []
    got = _call("retrieve", lambda: list(_cli().agent_engines.memories.retrieve(
        name=name, scope=SCOPE, simple_retrieval_params={})))
    rows = [_row(rm.memory) for rm in got if getattr(rm, "memory", None) and getattr(rm.memory, "fact", None)]
    return sorted(rows, key=lambda r: r["updated"])


def list_all() -> list[dict]:
    """The ledger: everything the bank holds for this scope."""
    return recall()


def remember(text: str) -> list[dict]:
    """Hand one exchange to Memory Bank. It extracts the facts worth keeping,
    consolidates them with the memories it already has, and returns what it
    did: CREATED, UPDATED, or nothing new."""
    name = engine_name()
    if not name:
        raise RuntimeError("no Memory Bank connected - run: python -m agent.platform.bank")
    op = _call("generate", lambda: _cli().agent_engines.memories.generate(
        name=name, scope=SCOPE,
        direct_contents_source={"events": [{"content": {"role": "user", "parts": [{"text": text}]}}]},
        config={"wait_for_completion": True}))
    flags = []
    resp = getattr(op, "response", None)
    for g in (getattr(resp, "generated_memories", None) or []):
        mem = getattr(g, "memory", None)
        flags.append({"action": str(getattr(g, "action", "")).split(".")[-1],
                      "id": (getattr(mem, "name", "") or "").split("/")[-1],
                      "fact": (getattr(mem, "fact", "") or "")[:160]})
    return flags


def forget(memory_id: str) -> None:
    _call("delete", lambda: _cli().agent_engines.memories.delete(name=f"{engine_name()}/memories/{memory_id}"))


def reset() -> int:
    """Delete every memory in the creator's scope. The bank itself stays."""
    rows = recall()
    for r in rows:
        forget(r["id"])
    return len(rows)


# ── the two callbacks ───────────────────────────────────────────────────────

def _lines(facts: list[dict]) -> str:
    return "\n".join(f"- [{f['topic']}] {f['fact']}" for f in facts)


def recall_taste(callback_context, llm_request):
    """before_model_callback for propose_directions: read the creator's
    memories and put them in front of the model, oldest first, so the most
    recent taste is the last thing it reads. Returning None lets the model
    call proceed."""
    try:
        facts = recall()
    except Exception as e:
        print(f"  [memory] recall unavailable ({str(e)[:80]})")
        facts = []
    callback_context.state["memory_facts"] = facts
    if not facts:
        return None
    llm_request.append_instructions([
        "MEMORY - what Memory Bank knows about this creator, oldest first:\n"
        + _lines(facts) + "\n"
        "Lean candidates 1 to 3 toward the most recent CREATOR_TASTE and say so in the "
        "angle. CHANNEL_RULES are hard constraints for candidates 1 to 3. Candidate 4 is "
        "unaffected."])
    return None


def remember_pick(callback_context):
    """after_agent_callback for scripter: the creator picked a direction and a
    script now exists for it. Hand that exchange to Memory Bank so the taste
    keeps moving. Returning None keeps the agent's own reply."""
    st = callback_context.state
    direction, angle = st.get("direction"), st.get("angle")
    if not direction:
        return None
    text = (f"Tonight the creator was offered four video directions and picked "
            f"'{direction}' ({angle}). A script was written for it. "
            f"This is what the creator wants to make right now.")
    try:
        flags = remember(text)
    except Exception as e:
        print(f"  [memory] remember unavailable ({str(e)[:80]})")
        flags = [{"action": "ERROR", "fact": str(e)[:120]}]
    st["memory_written"] = flags
    print(f"  [memory] {', '.join(f['action'] for f in flags) or 'nothing new'}")
    return None
