"""Make a save visible to the very next ADK run.

The mounted dev UI caches two things per app: the imported agent module and a
Runner built from it. With reload_agents=True, ADK's own file watcher evicts
both a moment after a file changes, but "a moment" is a few seconds on macOS
and a fast student can run before it fires. This module does the eviction
synchronously from the code API, so "saved" means "the next run uses this".

It also answers the question a student cannot otherwise settle: is adk web
running the code I just saved? Each Runner the dev UI builds is stamped with a
fingerprint of the sources it was built from; status() compares that stamp,
and the state of the imported modules, with the files on disk now.
"""
from __future__ import annotations

import hashlib
import importlib
import sys
import time

from agent.platform import config

#: The production modules a student edits, in an order that reloads a module
#: before the ones that import from it. graph.py is last because it binds names
#: from the others at import time (`from .desk import render_desk`): reloading
#: desk alone leaves graph holding the old function, and a stage app that takes
#: its nodes from graph would then run code the student has already replaced.
AGENT_MODULES = ("agent.trends", "agent.cleanup_tools", "agent.desk",
                 "agent.deliver", "agent.graph")


class _Handle:
    server = None          # the DevServer instance, captured at construction


handle = _Handle()


def stage_apps() -> list[str]:
    return sorted(d.name for d in config.ROOT.iterdir()
                  if d.is_dir() and (d / "agent.py").exists() and not d.name.startswith((".", "_")))


# ── fingerprints ────────────────────────────────────────────────────────────

def _agent_files() -> list:
    """The production sources a student can change. agent/platform is left out:
    nothing there is a hole, and its modules hold live handles (state, config)
    that must not be re-created under a running server."""
    return sorted(p for p in (config.ROOT / "agent").glob("*.py"))


def _app_files(app: str) -> list:
    return sorted((config.ROOT / app).rglob("*.py"))


def _digest(paths) -> str:
    h = hashlib.sha1()
    for p in paths:
        try:
            h.update(p.name.encode()); h.update(p.read_bytes())
        except OSError:
            continue
    return h.hexdigest()[:12]


def agent_fp() -> str:
    return _digest(_agent_files())


def saved_at(app: str) -> float:
    """When the newest of the app's sources was last written."""
    stamps = [p.stat().st_mtime for p in _agent_files() + _app_files(app) if p.exists()]
    return max(stamps) if stamps else 0.0


#: What the imported agent.* modules were built from. Set when this process
#: imported them, and again after every reload. Disk can move ahead of it: an
#: edit made in a terminal rather than the page reaches no reload hook.
memory_agent_fp: str = agent_fp()

#: Per app: the fingerprint each live Runner was built from, and when.
loaded: dict[str, dict] = {}
_runner_ids: dict[str, int] = {}


def _combined(app: str, agent_part: str) -> str:
    return f"{agent_part}+{_digest(_app_files(app))}"


def reload_agent_modules(edited: str | None = None) -> None:
    """Re-execute the production modules in place, the edited one first and
    graph last, so every `from .x import y` binds the new objects. In place,
    not evicted: run_state and the live map keep their module handles."""
    order = [m for m in AGENT_MODULES if m != "agent.graph"]
    if edited and edited in order:
        order.remove(edited)
        order.insert(0, edited)
    if "agent.graph" in AGENT_MODULES:
        order.append("agent.graph")
    for name in order:
        mod = sys.modules.get(name)
        if mod is not None:
            importlib.reload(mod)
    global memory_agent_fp
    memory_agent_fp = agent_fp()


def evict(apps: list[str] | None = None) -> list[str]:
    """Drop stage apps from the dev UI's caches: the next run builds a fresh
    Runner from a fresh import."""
    srv = handle.server
    if srv is None:
        return []
    apps = apps if apps is not None else stage_apps()
    for app in apps:
        srv.agent_loader.remove_agent_from_cache(app)   # drops stage_x.* from sys.modules too
        srv.runners_to_clean.add(app)                   # next run builds a fresh Runner
    return apps


def after_save(rel_path: str) -> list[str]:
    """Reload the edited production module and its dependants in place, then
    drop every stage app from the dev UI's caches. Returns the apps evicted."""
    if rel_path.startswith("agent/") and rel_path.endswith(".py"):
        reload_agent_modules(rel_path[:-3].replace("/", "."))
    return evict()


def note_runner(app: str, runner) -> None:
    """Called by the dev UI server each time it hands out a Runner. A Runner
    not seen before was just built, so it is stamped with what it was built
    from: the modules as they are in memory, and the app's files on disk."""
    if _runner_ids.get(app) == id(runner):
        return
    _runner_ids[app] = id(runner)
    loaded[app] = {"fp": _combined(app, memory_agent_fp), "at": time.time()}


def status(app: str) -> dict:
    """Is adk web running the code on disk for this app?

    current  a Runner exists and was built from these exact files
    fresh    no Runner is cached (or it is marked to be dropped); the next run
             imports the files as they are now
    stale    something in memory is behind the files: the imported modules,
             or the cached Runner. refresh() puts it right.
    """
    disk = _combined(app, agent_fp())
    srv = handle.server
    cached = bool(srv and app in srv.runner_dict and app not in srv.runners_to_clean)
    stamp = loaded.get(app)
    base = {"app": app, "cached": cached, "saved_at": saved_at(app),
            "attached": srv is not None,          # False means no save can reach the dev UI
            "loaded_at": stamp["at"] if (cached and stamp) else None}
    if memory_agent_fp != agent_fp():
        return {**base, "status": "stale",
                "detail": "the agent modules in memory are older than the files (an edit outside the page?)"}
    if not cached:
        return {**base, "status": "fresh", "detail": "the next run imports your files as they are now"}
    if stamp and stamp["fp"] == disk:
        return {**base, "status": "current", "detail": "the cached Runner was built from these files"}
    return {**base, "status": "stale", "detail": "the cached Runner was built before your last save"}


def refresh(app: str) -> dict:
    """Make adk web current for this app: reload the modules, drop the cache."""
    try:
        reload_agent_modules()
    except Exception as e:  # a module that no longer imports
        return {**status(app), "status": "error", "detail": f"{type(e).__name__}: {e}"[:300]}
    evict([app])
    return status(app)
