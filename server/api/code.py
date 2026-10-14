"""/api/code: read and write the files the lab asks students to edit, from the
browser. Only an allowlist is reachable, Python is syntax-checked before it
is written, and the result of that check travels back so the editor can show
it inline.
"""
from __future__ import annotations

import ast
import re

from fastapi import APIRouter, HTTPException

from agent.platform import config

from pydantic import BaseModel

from ..schemas import CodeAnswer, CodeFile, CodeWrite
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


def _stray_lines(block: str, symbol: str) -> str | None:
    """A message when a block holds code outside its symbol, else None. Blank
    lines and comments around the symbol are fine; a statement is not."""
    try:
        tree = ast.parse(block)
    except SyntaxError:
        return None                       # validate() reports syntax on its own
    lines = block.splitlines()
    own = symbol_span(block, symbol)
    if own is None:
        return f"this editor holds `{symbol}` alone; keep that name"
    del tree
    # anything but blank lines outside the symbol's own lines, comments included:
    # a comment above the def is harmless to Python and still vanishes from view
    outside = [i for i, l in enumerate(lines, 1) if l.strip() and (i < own[0] or i > own[1])]
    if not outside:
        return None
    first = outside[0]
    shown = lines[first - 1].strip()
    where = "above" if first < own[0] else "below"
    return (f"line {first} is {where} `{symbol}` and would be written into the file where this editor cannot show it: "
            f"`{shown[:60]}`. Keep this block to `{symbol}` alone; an import belongs at the top of the file.")


_OPEN, _CLOSE = "([{", ")]}"


def _balanced_end(lines: list[str], start: int) -> int:
    """Index of the line where every bracket opened from lines[start] on has
    closed again. Strings and comments are skipped well enough for the lab's
    files; a block that never closes ends at the last line."""
    depth = 0
    opened = False
    for i in range(start, len(lines)):
        quote = None
        for ch in lines[i]:
            if quote:
                if ch == quote:
                    quote = None
                continue
            if ch in "\"'":
                quote = ch
            elif ch == "#":
                break
            elif ch in _OPEN:
                depth += 1
                opened = True
            elif ch in _CLOSE:
                depth -= 1
        if depth <= 0 and (opened or i > start):
            return i
    return len(lines) - 1


def place_answer(block: str, symbol: str, text: str, path: str) -> str | None:
    """The symbol's block with the answer written into it, or None when the
    answer has no place there. A whole-symbol answer replaces the block. A
    fragment replaces the registered TODO line(s) of a hole in the block
    when they are still there, else the lines from the one that starts the
    way the fragment does (`edges=[`, `tools=[`, `yield Event(`) through the
    line where its brackets close."""
    from checks.holes import HOLES
    head = next((l.strip() for l in text.splitlines() if l.strip()), "")
    if head.startswith((f"{symbol} =", f"{symbol}=", f"def {symbol}(", f"async def {symbol}(", "@")):
        return text if text.endswith("\n") else text + "\n"
    if text.strip() and text.strip() in block:
        return block
    lines = block.splitlines(keepends=True)
    anchors = [a for rel, a, _ in HOLES.values() if rel == path and a in block]
    # a fragment that opens something named (`edges=[`, `tools=[`, `yield Event(`)
    # replaces that something, from the line it starts on to the line its brackets close
    m = re.match(r"[^\(\[\{]*[\(\[\{]", head)
    prefix = m.group(0) if m and m.group(0).strip("([{ ") else None
    hit = next((i for i, l in enumerate(lines) if prefix and l.strip().startswith(prefix)), None)
    if hit is not None:
        end = _balanced_end([l.rstrip("\n") for l in lines], hit)
        span = "".join(lines[hit : end + 1])
        # ...unless a hole's TODO is still in the block and the fragment belongs to it: the TODO line
        # itself opens the thing (`tools=[render_submit])  # TODO`), or sits elsewhere than the thing
        # found (a TODO comment above a placeholder). Then the registry's answer is to replace the TODO.
        hit_in_anchor = any(lines[hit].rstrip("\n") in a for a in anchors)
        anchor_in_span = any(a in span for a in anchors)
        if not hit_in_anchor and (not anchors or anchor_in_span):
            new = text if text.endswith("\n") else text + "\n"
            return "".join(lines[:hit]) + new + "".join(lines[end + 1 :])
    if anchors:
        return block.replace(anchors[0], text.rstrip("\n"), 1)
    return None
    prefix = m.group(0)
    lines = block.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.strip().startswith(prefix):
            end = _balanced_end([l.rstrip("\n") for l in lines], i)
            new = text if text.endswith("\n") else text + "\n"
            return "".join(lines[:i]) + new + "".join(lines[end + 1 :])
    return None


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
    err = agent_reload.after_save_report(body.path)
    bus.mark_dirty()
    v = validate(body.path, new_full)
    if err:
        v = {**v, "import_error": err}
    if note:
        v = {**v, "message": note}
    span = symbol_span(new_full, body.symbol) if body.symbol else None
    return CodeFile(path=body.path, content=fresh, validation=v, symbol=body.symbol, span=list(span) if span else None)


@router.post("/answer", response_model=CodeFile)
async def answer(body: CodeAnswer) -> CodeFile:
    """Write a hint's answer into the file, over whatever the student has in
    that symbol, and reload the agent: what the last hint does when clicked.
    The response is the symbol's block as the editor should now show it."""
    editable, _ = FILES.get(body.path, (False, ""))
    p = _resolve(body.path)
    if not editable:
        raise HTTPException(403, f"{body.path} is read-only in this lab")
    current = p.read_text()
    span = symbol_span(current, body.symbol)
    if span is None:
        # the file no longer parses or has lost the symbol: start from the shipped block
        shipped = config.ROOT / "starter" / body.path
        if not shipped.exists():
            raise HTTPException(409, f"{body.symbol} is not in {body.path} and there is no shipped copy to start from; reset the block first")
        current = shipped.read_text()
        span = symbol_span(current, body.symbol)
        if span is None:
            raise HTTPException(409, f"{body.symbol} is not in the shipped {body.path}")
    block = _slice(current, span)
    placed = place_answer(block, body.symbol, body.text, body.path)
    if placed is None:
        # the student's block no longer has a place for it: the shipped block does
        shipped = config.ROOT / "starter" / body.path
        if shipped.exists():
            fresh = shipped.read_text()
            f_span = symbol_span(fresh, body.symbol)
            if f_span:
                placed = place_answer(_slice(fresh, f_span), body.symbol, body.text, body.path)
    if placed is None:
        raise HTTPException(409, f"could not place the answer in {body.symbol} of {body.path}")
    new_full = _splice(current, span, placed)
    _write(p, new_full)
    err = agent_reload.after_save_report(body.path)
    bus.mark_dirty()
    v = validate(body.path, new_full)
    if err:
        v = {**v, "import_error": err}
    new_span = symbol_span(new_full, body.symbol)
    content = _slice(new_full, new_span) if new_span else placed
    return CodeFile(path=body.path, content=content, validation=v, symbol=body.symbol, span=list(new_span) if new_span else None)


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
        # The editor shows one block. Anything typed above or below that block
        # would be written into the file where no editor shows it: an import
        # that does not exist, say, breaking every later save with the broken
        # line out of sight. The block has to be the symbol and nothing else.
        stray = _stray_lines(body.content, body.symbol)
        if stray is not None:
            return CodeFile(path=body.path, content=body.content, symbol=body.symbol,
                            validation={"valid": False, "message": stray})
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
        err = agent_reload.after_save_report(body.path)
        bus.mark_dirty()
        if err:
            v = {**v, "import_error": err}
        return CodeFile(path=body.path, content=body.content, validation=v, symbol=body.symbol, span=list(span))
    v = validate(body.path, body.content)
    if not v["valid"]:
        # return the diagnosis without writing: a syntax error must not reach
        # a file the running graph imports
        return CodeFile(path=body.path, content=body.content, validation=v)
    _write(p, body.content)
    err = agent_reload.after_save_report(body.path)
    bus.mark_dirty()            # the live map re-imports graph.py on mtime
    if err:
        v = {**v, "import_error": err}
    return CodeFile(path=body.path, content=body.content, validation=v)
