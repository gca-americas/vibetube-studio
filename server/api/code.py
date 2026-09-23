"""/api/code: read and write the files the lab asks students to edit, from the
browser. Only an allowlist is reachable, Python is syntax-checked before it
is written, and the result of that check travels back so the editor can show
it inline.
"""
from __future__ import annotations

import ast

from fastapi import APIRouter, HTTPException

from agent.platform import config

from pydantic import BaseModel

from ..schemas import CodeFile, CodeWrite
from ..services import reload as agent_reload
from ..services.events import bus

router = APIRouter(prefix="/api/code", tags=["code"])

# path -> (editable, description)
FILES = {
    "stage0_prompt/agent.py": (True, "The single-prompt agent: add its two research tools"),
    "stage1_fanout/agent.py": (True, "Stage 1 sandbox: declare the fan-out edges"),
    "stage2_direction/agent.py": (True, "Stage 2 sandbox: the proposer, the human input node, persist_direction"),
    "stage3_router/agent.py": (True, "step 5: the router, the scripter, and quarantine"),
    "stage4_memory/agent.py": (True, "step 6: the same graph with memory callbacks"),
    "stage5_rag/agent.py": (True, "step 7: the same graph with a third reader"),
    "agent/comments.md": (True, "The audience's comments: the RAG Engine corpus"),
    "agent/platform/rag.py": (False, "The RAG Engine client and console: corpus, load, retrieve"),
    "stage6_video/agent.py": (True, "step 8: the same graph with the render desk"),
    "agent/desk.py": (False, "The render desk: render_submit and the LongRunningFunctionTool"),
    "agent/deliver.py": (True, "The delivery console: find the pending call, wait for Veo, answer by id"),
    "agent/platform/videogen.py": (False, "Veo: one script in, one clip out, with retries"),
    "agent/graph.py": (True, "The workflow: direction_gate (RequestInput) and the edge list (two TODO edges)"),
    "agent/backlog.txt": (True, "The creator's backlog: one idea per line"),
    "agent/platform/bank.py": (False, "The Memory Bank console: create, load, list"),
    "agent/platform/memory.py": (False, "The Memory Bank client and the two callbacks"),
    "agent/policy_words.txt": (True, "The policy gate's word list, read at decision time"),
}


def _resolve(path: str):
    if path not in FILES:
        raise HTTPException(404, f"{path} is not exposed to the editor")
    return config.ROOT / path


def validate(path: str, content: str) -> dict:
    if path.endswith(".py"):
        try:
            ast.parse(content, filename=path)
        except SyntaxError as e:
            return {"valid": False, "message": f"SyntaxError: {e.msg}", "line": e.lineno,
                    "offset": e.offset, "text": (e.text or "").rstrip()}
        return {"valid": True, "message": "Python syntax OK"}
    return {"valid": True, "message": "OK"}


def symbol_span(content: str, symbol: str) -> tuple[int, int] | None:
    """1-based inclusive line span of a top-level `def symbol` or `symbol = ...`."""
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return None
    lines = content.splitlines()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == symbol:
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            return start, _extend_over_body_comments(lines, node.end_lineno or node.lineno)
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == symbol for t in node.targets):
            return node.lineno, node.end_lineno or node.lineno
    return None


def _extend_over_body_comments(lines: list[str], end: int) -> int:
    """ast stops a def at its last statement; indented comment lines right after
    it (a TODO left for the student) belong to the body and must stay visible."""
    while end < len(lines):
        nxt = lines[end]
        if nxt.strip().startswith("#") and nxt.startswith((" ", "\t")):
            end += 1
        else:
            break
    return end


def _write(p, content: str) -> None:
    """Write the file and drop its cached bytecode. Python keys a .pyc on the
    source's mtime (whole seconds) and size, so two saves inside one second
    that keep the length - mode="chat" to mode="task" - would otherwise be
    served the stale module by the reload and by the load check."""
    p.write_text(content)
    for pyc in (p.parent / "__pycache__").glob(f"{p.stem}.*.pyc"):
        try:
            pyc.unlink()
        except OSError:
            pass


def _slice(content: str, span: tuple[int, int]) -> str:
    lines = content.splitlines(keepends=True)
    return "".join(lines[span[0] - 1 : span[1]])


def _splice(content: str, span: tuple[int, int], new: str) -> str:
    lines = content.splitlines(keepends=True)
    if not new.endswith("\n"):
        new += "\n"
    return "".join(lines[: span[0] - 1]) + new + "".join(lines[span[1] :])


@router.get("/files")
async def files():
    return [{"path": p, "editable": e, "description": d} for p, (e, d) in FILES.items()]


@router.get("", response_model=CodeFile)
async def read(path: str, symbol: str | None = None) -> CodeFile:
    """The whole file, or with `symbol`, just that top-level function or
    assignment. The editor shows the part the step is about."""
    p = _resolve(path)
    content = p.read_text()
    v = validate(path, content)
    if symbol:
        span = symbol_span(content, symbol)
        if span is None:
            raise HTTPException(404, f"{symbol} not found at top level of {path}")
        return CodeFile(path=path, content=_slice(content, span), validation=v, symbol=symbol, span=list(span))
    return CodeFile(path=path, content=content, validation=v)


class CodeReset(BaseModel):
    path: str
    symbol: str | None = None


@router.post("/reset", response_model=CodeFile)
async def reset(body: CodeReset) -> CodeFile:
    """Put the block back as the lab shipped it: the same top-level symbol's
    lines from starter/<path>, spliced over the live file. Without a symbol,
    the whole file. When the live file no longer parses or has lost the
    symbol, the whole shipped file is restored, and the answer says so."""
    editable, _ = FILES.get(body.path, (False, ""))
    p = _resolve(body.path)
    if not editable:
        raise HTTPException(403, f"{body.path} is read-only in this lab")
    shipped = config.ROOT / "starter" / body.path
    if not shipped.exists():
        raise HTTPException(404, f"no shipped version of {body.path}")
    fresh_full = shipped.read_text()
    note = ""
    if body.symbol:
        s_span = symbol_span(fresh_full, body.symbol)
        if s_span is None:
            raise HTTPException(404, f"{body.symbol} is not in the shipped {body.path}")
        fresh = _slice(fresh_full, s_span)
        current = p.read_text()
        c_span = symbol_span(current, body.symbol)
        if c_span is None:
            new_full = fresh_full
            note = f"the file no longer parsed or had lost {body.symbol}; the whole file is back as shipped"
        else:
            new_full = _splice(current, c_span, fresh)
    else:
        fresh, new_full = fresh_full, fresh_full
    _write(p, new_full)
    agent_reload.after_save(body.path)
    bus.mark_dirty()
    v = validate(body.path, new_full)
    if note:
        v = {**v, "message": note}
    span = symbol_span(new_full, body.symbol) if body.symbol else None
    return CodeFile(path=body.path, content=fresh, validation=v, symbol=body.symbol, span=list(span) if span else None)


@router.post("", response_model=CodeFile)
async def write(body: CodeWrite) -> CodeFile:
    """Write the whole file, or with `symbol`, replace just that top-level
    definition. The span is located again at save time, so edits elsewhere
    in the file cannot make the splice land on the wrong lines."""
    editable, _ = FILES.get(body.path, (False, ""))
    p = _resolve(body.path)
    if not editable:
        raise HTTPException(403, f"{body.path} is read-only in this lab")
    if body.symbol:
        current = p.read_text()
        span = symbol_span(current, body.symbol)
        if span is None:
            return CodeFile(path=body.path, content=body.content, symbol=body.symbol,
                            validation={"valid": False, "message": f"{body.symbol} not found in the file on disk"})
        new_full = _splice(current, span, body.content)
        v = validate(body.path, new_full)
        if not v["valid"]:
            # line numbers relative to the snippet the editor shows
            if v.get("line"):
                v["line"] = v["line"] - span[0] + 1
            return CodeFile(path=body.path, content=body.content, validation=v, symbol=body.symbol, span=list(span))
        if symbol_span(new_full, body.symbol) is None:
            return CodeFile(path=body.path, content=body.content, symbol=body.symbol,
                            validation={"valid": False, "message": f"the edit removed `{body.symbol}`; keep its name"})
        _write(p, new_full)
        agent_reload.after_save(body.path)
        bus.mark_dirty()
        return CodeFile(path=body.path, content=body.content, validation=v, symbol=body.symbol, span=list(span))
    v = validate(body.path, body.content)
    if not v["valid"]:
        # return the diagnosis without writing: a syntax error must not reach
        # a file the running graph imports
        return CodeFile(path=body.path, content=body.content, validation=v)
    _write(p, body.content)
    agent_reload.after_save(body.path)
    bus.mark_dirty()            # the live map re-imports graph.py on mtime
    return CodeFile(path=body.path, content=body.content, validation=v)
