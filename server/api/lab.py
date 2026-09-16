"""/api/lab: verification for the hands-on steps.

Each endpoint reads the same ADK session store the dev UI writes to and
answers a concrete question the step asked the student to produce evidence
for. Nothing here greps source or trusts the page; it reads events.
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from collections import Counter

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent.platform import config, drive

from ..services.workers import workers

ROOT = config.ROOT
router = APIRouter(prefix="/api/lab", tags=["lab"])

STAGE_APPS = ["stage0_prompt", "stage1_fanout", "stage2_direction", "stage3_router", "stage4_memory", "stage5_rag", "stage6_video"]


@router.get("/events")
async def events():
    """The lab's SSE stream: a snapshot on connect, worker log lines, and a
    fresh snapshot whenever a watched file changes."""
    from ..services.events import stream
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/trends")
def trends():
    """The trend feed the step 3b page shows: the same pool scan_trends draws from."""
    from agent.trends import sample_trends
    return {"trends": sample_trends()}


@router.get("/inspector")
async def inspector():
    """Is the mounted ADK dev UI ready, and which apps will it list."""
    apps = [a for a in STAGE_APPS if (ROOT / a / "agent.py").exists()]
    return {"up": True, "url": "/inspector/dev-ui/", "apps": apps}


def _texts(ev) -> list[str]:
    msg = getattr(ev, "message", None) or getattr(ev, "content", None)
    return [p.text for p in (getattr(msg, "parts", None) or []) if getattr(p, "text", None)]


async def _sessions(app_name: str):
    svc = drive.svc()
    out = []
    for user in drive.users(app_name):
        try:
            resp = await svc.list_sessions(app_name=app_name, user_id=user)
        except Exception:
            continue
        for meta in resp.sessions:
            s = await svc.get_session(app_name=app_name, user_id=user, session_id=meta.id)
            if s is not None:
                out.append((user, s))
    out.sort(key=lambda us: getattr(us[1], "last_update_time", 0) or 0)
    return out


def tools_wired(path=ROOT / "stage0_prompt" / "agent.py") -> list[str]:
    """Names in the `tools=[...]` list of the Agent(...) call, read from the
    file on disk. This is what the student edits in step 3."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "Agent":
            for kw in node.keywords:
                if kw.arg == "tools" and isinstance(kw.value, ast.List):
                    return [e.id for e in kw.value.elts if isinstance(e, ast.Name)]
    return []


@router.get("/stage0")
async def stage0():
    """Evidence for step 3, read from the file and the session store: which
    tools are wired, whether the agent ran, and which tools it called."""
    sessions = await _sessions("stage0_prompt")
    calls: Counter = Counter()
    user_msgs: list[str] = []
    replies: list[str] = []
    for _, s in sessions:
        for ev in s.events:
            for f in ev.get_function_calls() or []:
                calls[f.name] += 1
            if getattr(ev, "author", "") == "user":
                user_msgs += _texts(ev)
            else:
                replies += _texts(ev)
    last_reply = replies[-1] if replies else ""
    wired = tools_wired()
    return {
        "tools_wired": wired,
        "tools_complete": {"check_trends", "read_backlog"} <= set(wired),
        "sessions": len(sessions),
        "latest_session_id": sessions[-1][1].id if sessions else None,
        "tool_calls": dict(calls),
        "called_trends": calls.get("check_trends", 0) > 0,
        "called_backlog": calls.get("read_backlog", 0) > 0,
        "turns": len(user_msgs),
        "last_reply": last_reply[:1200],
    }


EXPECTED_FANOUT = {("START", "scan_trends", "join_research"),
                   ("START", "read_backlog", "join_research")}


def join_defined(path=ROOT / "stage1_fanout" / "agent.py") -> bool:
    """Is join_research assigned a JoinNode(...) call in the file on disk."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return False
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "join_research" for t in node.targets):
            call = node.value
            if isinstance(call, ast.Call):
                fn = call.func
                name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
                return name == "JoinNode"
    return False


def workflow_edges(path) -> list[tuple[str, ...]]:
    """The chains in the `edges=[...]` list of the Workflow(...) call, as
    tuples of names. Dict targets (routers) are rendered as 'route:{...}'."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "Workflow":
            for kw in node.keywords:
                if kw.arg == "edges" and isinstance(kw.value, ast.List):
                    out = []
                    for el in kw.value.elts:
                        if isinstance(el, ast.Tuple):
                            names = []
                            for e in el.elts:
                                if isinstance(e, ast.Name):
                                    names.append(e.id)
                                elif isinstance(e, ast.Dict):
                                    names.append("route:{" + ", ".join(
                                        getattr(k, "value", "?") for k in e.keys) + "}")
                            out.append(tuple(names))
                    return out
    return []


def _node_name(ev) -> str | None:
    info = getattr(ev, "node_info", None)
    path = getattr(info, "path", None) if info is not None else None
    if not path and isinstance(info, dict):
        path = info.get("path")
    if not path:
        return None
    return path.rsplit("/", 1)[-1].split("@")[0]


@router.get("/stage1")
async def stage1():
    """Evidence for step 4b: the edge list in stage1_fanout/agent.py, and what
    the workflow's sessions show about which nodes ran and what they output."""
    edges = workflow_edges(ROOT / "stage1_fanout" / "agent.py")
    sessions = await _sessions("stage1_fanout")
    nodes: list[str] = []
    bundle = ""
    backlog_count = None
    runs = 0
    for _, sess in sessions:
        for ev in sess.events:
            name = _node_name(ev)
            if not name:
                continue
            if name == "stage1_fanout":
                continue
            if name not in nodes:
                nodes.append(name)
            out = getattr(ev, "output", None)
            if name == "join_research" and isinstance(out, dict):
                bundle = json.dumps(out, ensure_ascii=False, indent=1)
                runs += 1
            if name == "read_backlog" and isinstance(out, dict):
                backlog_count = len(out.get("backlog") or [])
    return {
        "edges": [list(e) for e in edges],
        "edges_complete": set(edges) == EXPECTED_FANOUT,
        "join_defined": join_defined(),
        "sessions": len(sessions),
        "runs": runs,
        "nodes_ran": nodes,
        "readers_ran": {"scan_trends", "read_backlog"} <= set(nodes),
        "joined": "join_research" in nodes,
        "backlog_count": backlog_count,
        "bundle": bundle[:2000],
    }


CHAIN_PROPOSER = ("join_research", "propose_directions")
CHAIN_GATE = CHAIN_PROPOSER + ("direction_gate",)


def proposer_defined(path=ROOT / "stage2_direction" / "agent.py") -> bool:
    """Is propose_directions assigned an Agent(...) call in the stage 2 file."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return False
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "propose_directions" for t in node.targets):
            call = node.value
            if isinstance(call, ast.Call):
                fn = call.func
                name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
                return name in ("Agent", "LlmAgent")
    return False
CHAIN_PERSIST = CHAIN_GATE + ("persist_direction",)


def proposer_mode(path=ROOT / "agent" / "graph.py") -> str:
    """The `mode=` keyword on propose_directions = Agent(...), or the default
    an agent takes when used as a workflow node."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return "?"
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "propose_directions" for t in node.targets):
            call = node.value
            if isinstance(call, ast.Call):
                for kw in call.keywords:
                    if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                        return str(kw.value.value)
            return "single_turn (default for a node)"
    return "?"


def gate_has_request_input(path=ROOT / "agent" / "graph.py") -> bool:
    """Does direction_gate yield a RequestInput(...)? Read from the AST."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "direction_gate":
            for sub in ast.walk(node):
                if isinstance(sub, ast.Yield) and isinstance(sub.value, ast.Call) \
                        and getattr(sub.value.func, "id", "") == "RequestInput":
                    return True
    return False


@router.get("/stage2")
async def stage2():
    """Evidence for steps 4c and 4d: the edge list in stage2_direction/agent.py,
    which nodes ran, whether the graph suspended on a RequestInput and was
    answered, and what the latest session's state holds."""
    edges = workflow_edges(ROOT / "stage2_direction" / "agent.py")
    tail = next((e for e in edges if e and e[0] == "join_research"), ())
    sessions = await _sessions("stage2_direction")
    nodes: list[str] = []
    asked = answered = 0
    state: dict = {}
    proposed: list[str] = []
    for _, sess in sessions:
        for ev in sess.events:
            name = _node_name(ev)
            if name and name != "stage2_direction" and name not in nodes:
                nodes.append(name)
            if name == "propose_directions":
                for text in _texts(ev):
                    try:
                        cands = json.loads(text).get("candidates") or []
                    except (ValueError, AttributeError):
                        continue
                    proposed = [c.get("title", "") for c in cands if isinstance(c, dict)]
            for f in ev.get_function_calls() or []:
                if f.name == "adk_request_input":
                    asked += 1
            for r in ev.get_function_responses() or []:
                if r.name == "adk_request_input":
                    answered += 1
    if sessions:
        state = dict(sessions[-1][1].state or {})
    cands = state.get("candidates") or []
    return {
        "edges": [list(e) for e in edges],
        "chain": list(tail),
        "proposer_defined": proposer_defined(),
        "proposer_wired": tuple(tail[: len(CHAIN_PROPOSER)]) == CHAIN_PROPOSER,
        "gate_wired": tuple(tail[: len(CHAIN_GATE)]) == CHAIN_GATE,
        "persist_wired": tuple(tail[: len(CHAIN_PERSIST)]) == CHAIN_PERSIST,
        "gate_has_request_input": gate_has_request_input(),
        "proposer_mode": proposer_mode(),
        "sessions": len(sessions),
        "nodes_ran": nodes,
        "asked": asked,
        "answered": answered,
        "candidates": [c.get("title", "") for c in cands if isinstance(c, dict)],
        "proposed_titles": proposed,
        "direction": state.get("direction"),
        "user_prefs": state.get("user:prefs"),
        "state_keys": sorted(k for k in state.keys() if not k.startswith("_")),
    }


@router.get("/stage2/load")
async def stage2_load():
    return await _load_app("stage2_direction")


@router.get("/stage3/load")
async def stage3_load():
    return await _load_app("stage3_router")


@router.get("/stage4/load")
async def stage4_load():
    return await _load_app("stage4_memory")


@router.get("/stage5/load")
async def stage5_load():
    return await _load_app("stage5_rag")


@router.get("/stage6/load")
async def stage6_load():
    return await _load_app("stage6_video")


@router.get("/loaded/{app}")
async def loaded(app: str):
    """Is adk web running the code on disk for this app? current, fresh or
    stale, with when the files were saved and when the Runner was built."""
    if app not in STAGE_APPS:
        raise HTTPException(404, f"unknown app {app!r}")
    from ..services import reload as agent_reload
    return agent_reload.status(app)


@router.post("/loaded/{app}/refresh")
async def refresh_loaded(app: str):
    """Make adk web current for this app: reload the agent modules in place
    and drop the cached Runner, then report as /loaded does."""
    if app not in STAGE_APPS:
        raise HTTPException(404, f"unknown app {app!r}")
    from ..services import reload as agent_reload
    return agent_reload.refresh(app)


@router.get("/load/{app}")
async def any_load(app: str):
    """Load any stage app in a fresh interpreter: the check every run panel offers."""
    if app not in STAGE_APPS:
        raise HTTPException(404, f"unknown app {app!r}")
    return await _load_app(app)


async def _load_app(app: str):
    """Import a stage app in a fresh interpreter and report whether the
    Workflow accepts it. Anything ADK refuses shows up here as the same
    validation error adk web would raise."""
    import asyncio
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-c",
        # ADK leaves .graph as None on a Workflow whose edge list is still empty,
        # so an app with no edges yet must not be reported as an agent.
        f"import {app}.agent as m; r = m.root_agent; g = getattr(r, 'graph', None); "
        f"print(len(g.edges) if g is not None else "
        f"('0' if type(r).__name__ == 'Workflow' else 'agent:' + str(len(getattr(r, 'tools', []) or []))))",
        cwd=str(ROOT), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=90)
    except asyncio.TimeoutError:
        proc.kill()
        return {"ok": False, "error": "import timed out"}
    if proc.returncode == 0:
        said = out.decode().strip()
        if said.startswith("agent:"):
            return {"ok": True, "edges": None, "tools": int(said[6:] or 0), "error": ""}
        return {"ok": True, "edges": int(said or 0), "error": ""}
    text = err.decode(errors="replace")
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    # pydantic prints the ADK message on a "Value error, ..." line and then a
    # docs footer; the message is the part worth showing.
    said = [l for l in lines if l.startswith("Value error,")]
    meaningful = [l for l in lines if not l.startswith("For further information visit")]
    msg = said[-1].removeprefix("Value error,").strip() if said else (meaningful[-1] if meaningful else text)
    return {"ok": False, "error": msg[:600]}


def _assigned_call(path, name: str) -> str | None:
    """For `name = Something(...)` at module level, the callee's name; for
    `def name(...)`, "def"; None when neither is present."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return "def"
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            call = node.value
            if isinstance(call, ast.Call):
                fn = call.func
                return fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", None)
            return None
    return None


def _mode_kw(path, name: str) -> str | None:
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets) and isinstance(node.value, ast.Call):
            for kw in node.value.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    return str(kw.value.value)
    return None


def state_write_wired(path=ROOT / "agent" / "graph.py") -> bool:
    """Does persist_direction yield `Event(state=...)`."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return False
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "persist_direction":
            for sub in ast.walk(node):
                if isinstance(sub, ast.Yield) and isinstance(sub.value, ast.Call):
                    fn = sub.value.func
                    name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
                    if name == "Event" and any(kw.arg == "state" for kw in sub.value.keywords):
                        return True
    return False


def policy_route_wired(path=ROOT / "agent" / "graph.py") -> bool:
    """Does policy_check end in `return Event(..., route=...)`."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return False
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "policy_check":
            for sub in ast.walk(node):
                if isinstance(sub, ast.Return) and isinstance(sub.value, ast.Call):
                    fn = sub.value.func
                    name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", "")
                    if name == "Event" and any(kw.arg == "route" for kw in sub.value.keywords):
                        return True
    return False


@router.get("/stage3")
async def stage3():
    """Evidence for steps 5a and 5b: what stage3_router/agent.py defines and
    wires, and what its sessions show: routes taken, quarantine's tool calls,
    the cleaned direction, the script."""
    path = ROOT / "stage3_router" / "agent.py"
    edges = workflow_edges(path)
    tail = next((e for e in edges if e and e[0] == "join_research"), ())
    route_edge = next((e for e in edges if e and e[0] == "policy_check" and len(e) > 1 and e[1].startswith("route:")), ())
    scripter_call = _assigned_call(path, "scripter")
    quarantine_call = _assigned_call(path, "quarantine")
    quarantine_mode = _mode_kw(path, "quarantine")
    if quarantine_call == "def":
        quarantine_kind = "function"
    elif quarantine_call in ("Agent", "LlmAgent"):
        quarantine_kind = "task agent" if quarantine_mode == "task" else f"agent ({quarantine_mode or 'single_turn'})"
    else:
        quarantine_kind = None

    sessions = await _sessions("stage3_router")
    state: dict = dict(sessions[-1][1].state or {}) if sessions else {}
    nodes: list[str] = []
    routes: list[str] = []
    tool_calls: dict[str, int] = {}
    cleaned: dict | None = None            # from the latest session where quarantine finished a task
    cleaned_script_title = ""              # the script written in that same session, after the cleanup
    blocked_message = ""
    script_title = ""
    for _, sess in sessions:
        finished_task = False
        sess_cleaned: dict | None = None
        sess_script = ""
        for ev in sess.events:
            name = _node_name(ev)
            if name and name != "stage3_router" and name not in nodes:
                nodes.append(name)
            route = getattr(getattr(ev, "actions", None), "route", None)
            if name == "policy_check" and route:
                routes.append(route)
            if name == "quarantine":
                for f in ev.get_function_calls() or []:
                    tool_calls[f.name] = tool_calls.get(f.name, 0) + 1
                    if f.name == "finish_task":
                        finished_task = True
                out = getattr(ev, "output", None)
                # the 5b placeholder also outputs a dict with a title, flagged blocked; only a
                # task agent's finish_task output counts as a cleaned direction
                if finished_task and isinstance(out, dict) and out.get("title") and not out.get("blocked"):
                    sess_cleaned = {k: out.get(k, "") for k in ("title", "angle", "hook")}
                for text in _texts(ev):
                    if "blocked" in text.lower():
                        blocked_message = text[:200]
            if name == "scripter":
                for text in _texts(ev):
                    try:
                        title = json.loads(text).get("title", "")
                    except (ValueError, AttributeError):
                        continue
                    if title:
                        script_title = title
                        if sess_cleaned:
                            sess_script = title
        if sess_cleaned:
            cleaned, cleaned_script_title = sess_cleaned, sess_script
    return {
        "edges": [list(e) for e in edges],
        "chain": list(tail),
        "router_wired": bool(tail) and tail[-1] == "policy_check",
        "routes_wired": bool(route_edge) and "OK" in route_edge[1] and "BLOCK" in route_edge[1],
        "reroute_wired": any(tuple(e[:2]) == ("quarantine", "scripter") for e in edges),
        "scripter_defined": scripter_call in ("Agent", "LlmAgent"),
        "persist_wired": "direction_gate" in tail and "persist_direction" in tail and tail.index("persist_direction") == tail.index("direction_gate") + 1,
        "state_write_wired": state_write_wired(),
        "policy_route_wired": policy_route_wired(),
        "quarantine_kind": quarantine_kind,
        "sessions": len(sessions),
        "nodes_ran": nodes,
        "routes": routes,
        "ok_runs": routes.count("OK"),
        "block_runs": routes.count("BLOCK"),
        "tool_calls": tool_calls,
        "cleaned": cleaned,
        "cleaned_script_title": cleaned_script_title,
        "blocked_message": blocked_message,
        "script_title": script_title,
        "direction": state.get("direction"),
        "angle": state.get("angle"),
        "hook": state.get("hook"),
        "user_prefs": state.get("user:prefs"),
        "state_keys": sorted(k for k in state.keys() if not k.startswith("_")),
    }


def _callback_kw(path, agent_name: str, kw: str) -> str | None:
    """The name passed as `kw=` on `agent_name = Agent(...)`, or None."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == agent_name for t in node.targets) and isinstance(node.value, ast.Call):
            for k in node.value.keywords:
                if k.arg == kw:
                    return k.value.id if isinstance(k.value, ast.Name) else ast.unparse(k.value)
    return None


@router.get("/memory")
async def memory_bank():
    """The bank itself: connected or not, and everything it holds for the
    creator's scope. One network call; the page asks on a click."""
    from agent.platform import memory
    engine = memory.engine_name()
    if not engine:
        return {"connected": False, "engine": None, "memories": []}
    import asyncio
    try:
        rows = await asyncio.to_thread(memory.list_all)
    except Exception as e:
        return {"connected": True, "engine": engine, "memories": [], "error": str(e)[:200]}
    return {"connected": True, "engine": engine, "memories": rows}


@router.get("/stage4")
async def stage4():
    """Evidence for step 6: the two callbacks in stage4_memory/agent.py, the
    bank connection, and what the latest run read and wrote."""
    from agent.platform import memory
    path = ROOT / "stage4_memory" / "agent.py"
    recall = _callback_kw(path, "propose_directions", "before_model_callback")
    remember = _callback_kw(path, "scripter", "after_agent_callback")
    sessions = await _sessions("stage4_memory")
    nodes: list[str] = []
    proposed: list[str] = []
    state: dict = {}
    for _, sess in sessions:
        for ev in sess.events:
            name = _node_name(ev)
            if name and name != "stage4_memory" and name not in nodes:
                nodes.append(name)
            if name == "propose_directions":
                for text in _texts(ev):
                    try:
                        cands = json.loads(text).get("candidates") or []
                    except (ValueError, AttributeError):
                        continue
                    proposed = [c.get("title", "") for c in cands if isinstance(c, dict)]
    if sessions:
        state = dict(sessions[-1][1].state or {})
    facts = state.get("memory_facts") or []
    return {
        "bank_connected": bool(memory.engine_name()),
        "recall_wired": recall == "recall_taste",
        "remember_wired": remember == "remember_pick",
        "recall_kw": recall,
        "remember_kw": remember,
        "sessions": len(sessions),
        "nodes_ran": nodes,
        "proposed_titles": proposed,
        "memory_facts": facts,
        "memory_written": state.get("memory_written") or [],
        "direction": state.get("direction"),
    }


BANK_CMDS = {"connect": [], "load": ["load"], "list": ["list"], "reset": ["reset"]}


@router.post("/bank/{cmd}")
async def bank_run(cmd: str):
    """Run `python -m agent.platform.bank <cmd>` as a worker. Its output streams on the
    event bus as log lines with verb "bank"; the page shows them live."""
    from ..services.workers import workers
    if cmd not in BANK_CMDS:
        raise HTTPException(404, f"unknown bank command {cmd!r}")
    if "bank" in workers.running():
        return {"ok": False, "detail": "a bank command is still running"}
    ok, detail = await workers.start("bank", *BANK_CMDS[cmd], exclusive=False)
    return {"ok": ok, "detail": detail, "cmd": cmd, "run": workers.run_id("bank")}


@router.get("/bank/status")
async def bank_status():
    from ..services.workers import workers
    last = workers.last_exit() or {}
    return {"running": "bank" in workers.running(),
            "run": workers.run_id("bank"),
            "last_exit": last if last.get("verb") == "bank" else None}


# ── step 7 · RAG Engine ──────────────────────────────────────────────────────

@router.get("/rag")
async def rag_corpus():
    """The corpus: connected or not, and the files it holds. One network
    call; the page asks on a click."""
    from agent.platform import rag
    name = rag.corpus_name()
    if not name:
        return {"connected": False, "corpus": None, "files": [], "comments": len(rag.comments())}
    import asyncio
    try:
        files = await asyncio.to_thread(rag.list_files)
    except Exception as e:
        return {"connected": True, "corpus": name, "files": [], "comments": len(rag.comments()), "error": str(e)[:200]}
    return {"connected": True, "corpus": name, "files": files, "comments": len(rag.comments())}


FEEDBACK_EDGE = ("START", "read_feedback", "join_research")


@router.get("/stage5")
async def stage5():
    """Evidence for step 7b: the third reader's edge in stage5_rag/agent.py,
    the corpus connection, and what the latest run retrieved and proposed."""
    from agent.platform import rag
    edges = workflow_edges(ROOT / "stage5_rag" / "agent.py")
    sessions = await _sessions("stage5_rag")
    nodes: list[str] = []
    proposed: list[dict] = []
    feedback: dict = {}
    for _, sess in sessions:
        for ev in sess.events:
            name = _node_name(ev)
            if name and name != "stage5_rag" and name not in nodes:
                nodes.append(name)
            out = getattr(ev, "output", None)
            if name == "read_feedback" and isinstance(out, dict):
                feedback = out
            if name == "propose_directions":
                for text in _texts(ev):
                    try:
                        cands = json.loads(text).get("candidates") or []
                    except (ValueError, AttributeError):
                        continue
                    proposed = [{"title": c.get("title", ""), "angle": c.get("angle", ""),
                                 "sources": sorted({e.get("source", "") for e in (c.get("evidence") or []) if isinstance(e, dict)})}
                                for c in cands if isinstance(c, dict)]
    return {
        "corpus_connected": bool(rag.corpus_name()),
        "feedback_wired": FEEDBACK_EDGE in edges,
        "edges": [list(e) for e in edges],
        "sessions": len(sessions),
        "nodes_ran": nodes,
        "feedback_ran": "read_feedback" in nodes,
        "feedback_query": feedback.get("query"),
        "feedback_passages": feedback.get("feedback") or [],
        "feedback_note": feedback.get("note"),
        "proposed": proposed,
        "cited_feedback": any("feedback" in c["sources"] for c in proposed),
    }


RAG_CMDS = {"connect": [], "load": ["load"], "list": ["list"], "reset": ["reset"], "query": ["query"]}


@router.post("/rag/{cmd}")
async def rag_run(cmd: str, body: dict | None = None):
    """Run `python -m agent.platform.rag <cmd>` as a worker. Output streams on the event
    bus as log lines with verb "rag". `query` takes {"text": ...}."""
    from ..services.workers import workers
    if cmd not in RAG_CMDS:
        raise HTTPException(404, f"unknown rag command {cmd!r}")
    args = list(RAG_CMDS[cmd])
    if cmd == "query":
        text = ((body or {}).get("text") or "").strip()
        if not text:
            raise HTTPException(400, "query needs text")
        args.append(text)
    if "rag" in workers.running():
        return {"ok": False, "detail": "a rag command is still running"}
    ok, detail = await workers.start("rag", *args, exclusive=False)
    return {"ok": ok, "detail": detail, "cmd": cmd, "run": workers.run_id("rag")}


@router.get("/rag/status")
async def rag_status():
    from ..services.workers import workers
    last = workers.last_exit() or {}
    return {"running": "rag" in workers.running(),
            "run": workers.run_id("rag"),
            "last_exit": last if last.get("verb") == "rag" else None}


# ── step 8 · the video ───────────────────────────────────────────────────────

def tool_wrapped(path, agent_name: str, tool_fn: str) -> str | None:
    """How `tool_fn` appears in the tools=[...] of the Agent assigned to
    `agent_name`: "LongRunningFunctionTool" when wrapped, "plain" when bare,
    None when absent."""
    try:
        tree = ast.parse(path.read_text())
    except (OSError, SyntaxError):
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == agent_name for t in node.targets) and isinstance(node.value, ast.Call):
            for kw in node.value.keywords:
                if kw.arg == "tools" and isinstance(kw.value, ast.List):
                    for el in kw.value.elts:
                        if isinstance(el, ast.Name) and el.id == tool_fn:
                            return "plain"
                        if isinstance(el, ast.Call) and any(isinstance(a, ast.Name) and a.id == tool_fn for a in el.args):
                            return getattr(el.func, "id", None) or ast.unparse(el.func)
    return None


RENDER_CHAIN = ("scripter", "render_desk", "store_video")


@router.get("/stage6")
async def stage6():
    """Evidence for step 8: the wrapper and the last chain in stage6_video/agent.py,
    and the latest session's render: pending (a call with no final response),
    delivered (render_url in state), or not started."""
    from agent.platform import state as run_state
    path = ROOT / "stage6_video" / "agent.py"
    wrapped = tool_wrapped(path, "render_desk", "render_submit")
    edges = workflow_edges(path)
    from checks.holes import HOLES
    _, d_anchor, d_snippet = HOLES["DELIVER_RESPONSE"]
    deliver_src = (ROOT / "agent" / "deliver.py").read_text()
    deliver_wired = d_anchor not in deliver_src and "function_response=FunctionResponse(" in deliver_src and "function_response=None" not in deliver_src
    sessions = await _sessions("stage6_video")
    nodes: list[str] = []
    pending: dict | None = None
    submitted: dict | None = None
    st: dict = {}
    session: dict | None = None
    if sessions:
        user, sess = sessions[-1]
        session = {"id": sess.id, "user": user}
        st = dict(sess.state or {})
        lr, calls, receipts, latest = set(), {}, {}, {}
        for ev in sess.events:
            name = _node_name(ev)
            if name and name != "stage6_video" and name not in nodes:
                nodes.append(name)
            if getattr(ev, "long_running_tool_ids", None):
                lr |= set(ev.long_running_tool_ids)
            for f in ev.get_function_calls() or []:
                calls[f.id] = (f.name, dict(f.args or {}))
            for r in ev.get_function_responses() or []:
                resp = r.response if isinstance(r.response, dict) else {}
                latest[r.id] = resp
                if resp.get("status") == "pending":
                    receipts[r.id] = resp                  # the receipt: the tool's own return value
        for cid in lr:
            name, args = calls.get(cid, ("", {}))
            if name != "render_submit":
                continue
            submitted = {"call_id": cid, "prompt": (args.get("prompt") or "")[:300],
                         "operation": receipts.get(cid, {}).get("operation", ""),
                         "final": latest.get(cid, {}).get("status", "")}
            if latest.get(cid, {}).get("status") == "pending":
                pending = submitted
    render = run_state.load().get("render") or {}
    return {
        "tool": wrapped,                          # "LongRunningFunctionTool" | "plain" | None
        "tool_wrapped": wrapped == "LongRunningFunctionTool",
        "deliver_wired": deliver_wired,
        "chain_wired": RENDER_CHAIN in edges,
        "sessions": len(sessions),
        "session": session,                       # the latest session: the dev UI opens it by id
        "nodes_ran": nodes,
        "desk_ran": "render_desk" in nodes,
        "submitted": submitted,
        "pending": pending,
        "delivered": "render_url" in st,
        "render_url": st.get("render_url") or "",
        "render_status": st.get("render_status") or "",
        "store_video_ran": "store_video" in nodes,
        "render_file": render if render.get("operation") == (submitted or {}).get("operation") else {},
        "real_video": config.REAL_VIDEO,
    }


VIDEO_CMDS = {"deliver": [], "status": ["status"]}


@router.post("/video/{cmd}")
async def video_run(cmd: str):
    """Run `python -m agent.deliver [status]` as a worker; output streams on
    the event bus with verb "deliver"."""
    from ..services.workers import workers
    if cmd not in VIDEO_CMDS:
        raise HTTPException(404, f"unknown video command {cmd!r}")
    if "deliver" in workers.running():
        return {"ok": False, "detail": "a deliver command is still running"}
    ok, detail = await workers.start("deliver", *VIDEO_CMDS[cmd], exclusive=False)
    return {"ok": ok, "detail": detail, "cmd": cmd, "run": workers.run_id("deliver")}


@router.get("/video/status")
async def video_status():
    from ..services.workers import workers
    last = workers.last_exit() or {}
    return {"running": "deliver" in workers.running(),
            "run": workers.run_id("deliver"),
            "last_exit": last if last.get("verb") == "deliver" else None}


# ── step 9 · deploy the app ──────────────────────────────────────────────────

DEPLOY_SCRIPT = ROOT / "vibestudio" / "deploy.py"
DEPLOY_RECORD = config.RUNS / "deploy.json"


@router.post("/deploy")
async def deploy_run():
    """Run `python vibestudio/deploy.py` as a worker; its output streams on the
    event bus with verb "deploy". The service URL lands in runs/deploy.json."""
    from ..services.workers import workers
    if "deploy" in workers.running():
        return {"ok": False, "detail": "a deploy is still running"}
    ok, detail = await workers.start_script("deploy", str(DEPLOY_SCRIPT))
    return {"ok": ok, "detail": detail}


@router.get("/deploy/status")
async def deploy_status():
    from ..services.workers import workers
    last = workers.last_exit() or {}
    record = {}
    if DEPLOY_RECORD.exists():
        try:
            record = json.loads(DEPLOY_RECORD.read_text())
        except ValueError:
            record = {}
    return {"running": "deploy" in workers.running(),
            "last_exit": last if last.get("verb") == "deploy" else None,
            "url": record.get("url", ""), "service": record.get("service", ""), "project": record.get("project", ""),
            "region": record.get("region", ""), "at": record.get("at"),
            "gcloud_project": os.environ.get("GOOGLE_CLOUD_PROJECT", ""),
            "app_built": (ROOT / "vibestudio" / "web" / "dist" / "index.html").exists()}


# ── jumping between steps: the registry, from the page ──────────────────────

@router.get("/holes")
async def holes_status():
    """Every registered hole: "open" while its TODO line is in the file,
    "filled" once the answer is."""
    from checks.holes import HOLES
    out = {}
    for name, (rel, anchor, snippet) in HOLES.items():
        try:
            src = (ROOT / rel).read_text()
        except OSError:
            out[name] = "missing"
            continue
        first = snippet.splitlines()[0].strip()
        out[name] = "open" if anchor in src else "filled" if (snippet in src or first in src) else "unknown"
    return out


QUARANTINE_SKELETON = """quarantine = Agent(
    name="quarantine",
    model=config.MODEL,
    instruction=QUARANTINE_INSTRUCTION,
    # TODO: QUARANTINE - add mode="task", tools=[find_policy_hits, suggest_replacement], output_schema=CleanedDirection
)"""


@router.post("/quarantine/skeleton")
async def quarantine_skeleton():
    """Step 5c, edit 1: put the Agent skeleton in place of the 5b placeholder
    function, so the student adds the three arguments instead of typing the
    whole node. Idempotent: an Agent already in place is left alone."""
    from checks.holes import HOLES
    from ..services import reload as agent_reload
    from ..services.events import bus
    from .code import _splice, _write, symbol_span
    rel, _, _ = HOLES["QUARANTINE"]
    p = ROOT / rel
    src = p.read_text()
    if _assigned_call(p, "quarantine") in ("Agent", "LlmAgent"):
        return {"ok": True, "state": "agent"}
    # the placeholder, however the student has formatted it: replace the whole
    # top-level definition, found by name
    span = symbol_span(src, "quarantine")
    if span is None:
        return {"ok": False, "state": "missing", "detail": "quarantine is not defined in stage3_router/agent.py; paste the complete node from the hints"}
    _write(p, _splice(src, span, QUARANTINE_SKELETON + "\n"))
    agent_reload.after_save(rel)
    bus.mark_dirty()
    return {"ok": True, "state": "skeleton"}


def _git(*args: str) -> str:
    import subprocess
    try:
        r = subprocess.run(["git", *args], cwd=config.ROOT, capture_output=True,
                           text=True, timeout=5)
        return r.stdout.strip()
    except Exception:
        return ""


#: The commit this process loaded its code from. A pull moves the checkout but
#: not a running interpreter, so this is the only honest answer to "does the
#: server have the fix I just pulled".
RUNNING_COMMIT = _git("rev-parse", "--short", "HEAD")


@router.get("/version")
async def version():
    """What this server is running, and whether the checkout has moved since."""
    head = _git("rev-parse", "--short", "HEAD")
    return {"running": RUNNING_COMMIT, "head": head,
            "stale": bool(head and RUNNING_COMMIT and head != RUNNING_COMMIT),
            "subject": _git("log", "-1", "--format=%s")}


WORKER_VERBS = ("bank", "rag", "deliver", "deploy")


@router.get("/worker/{verb}/log")
async def worker_log(verb: str):
    """The whole output of the last run of one console command, from
    runs/<verb>_run.log. The page reads this when a command finishes, because
    a proxy that buffers the event stream can hold the live lines back."""
    if verb not in WORKER_VERBS:
        raise HTTPException(404, f"unknown worker {verb!r}")
    path = config.RUNS / f"{verb}_run.log"
    if not path.exists():
        return {"verb": verb, "lines": []}
    text = path.read_text(errors="replace")
    return {"verb": verb, "lines": [l for l in text.splitlines() if l.strip()]}


@router.get("/holes/plan")
async def holes_plan():
    """Every shipped hole in lab order, with the page it belongs to, its
    name for a person, and whether it is open or filled. The catch-up bar
    at the top of each page fills the ones from earlier pages."""
    from checks.holes import HOLES, LABEL, PAGE
    from scripts.carve import SHIP_HOLES
    state = await holes_status()
    return [{"name": n, "page": PAGE[n], "label": LABEL[n], "state": state.get(n, "unknown")}
            for n in SHIP_HOLES if n in HOLES]


@router.post("/holes/fill")
async def holes_fill(body: dict):
    """Write the registry's answer into the file for each named hole: what
    scripts/rescue.py does, for a student who jumps in at a later step."""
    from checks.holes import HOLES
    from ..services import reload as agent_reload
    from ..services.events import bus
    from .code import _write
    names = [n for n in (body.get("names") or []) if n in HOLES]
    filled = []
    for name in names:
        rel, anchor, snippet = HOLES[name]
        p = ROOT / rel
        src = p.read_text()
        if anchor not in src:
            continue
        _write(p, src.replace(anchor, snippet, 1))
        agent_reload.after_save(rel)
        filled.append(name)
    bus.mark_dirty()
    return {"filled": filled}
