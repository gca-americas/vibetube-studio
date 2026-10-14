"""Wire types. The TypeScript mirror is web/src/lib/types.ts."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

class WorkerExit(BaseModel):
    verb: str
    code: int
    at: float


class RunSnapshot(BaseModel):
    """What the lab pages watch: which worker is busy, how the last one
    exited, and a timestamp that changes whenever a watched file changes."""
    busy: str | None
    last_exit: WorkerExit | None
    updated_at: float


class Ack(BaseModel):
    ok: bool
    verb: str | None = None
    detail: str = ""


class CodeFile(BaseModel):
    path: str
    content: str
    validation: dict[str, Any]
    symbol: str | None = None
    span: list[int] | None = None


class CodeWrite(BaseModel):
    path: str
    content: str
    symbol: str | None = None


class CodeAnswer(BaseModel):
    """The answer a hint shows, to be written into the file: the whole
    top-level symbol, or a fragment of it (an argument, a statement)."""
    path: str
    symbol: str
    text: str
