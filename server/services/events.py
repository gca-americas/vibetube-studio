"""The event bus behind /api/lab/events.

Subscribers hold an asyncio.Queue. Anything that changes the run (a worker
writing a file, a worker starting or exiting) is turned into a fresh snapshot
and published to every subscriber. A watcher task detects file changes by
fingerprint, so state written by worker subprocesses reaches the page without
the page polling.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from typing import Any

from agent.platform import config

WATCHED = [config.STATE, config.RUNS / "sessions.db",
           config.RUNS / "ui_last.json", config.RUNS / "memorybank.json",
           config.RUNS / "ragcorpus.json", config.RUNS / "deploy.json", config.RUNS / "post.json"]
POLL_S = 0.5
HEARTBEAT_S = 10.0


def fingerprint() -> tuple:
    out = []
    for p in WATCHED:
        try:
            s = os.stat(p)
            out.append((s.st_mtime_ns, s.st_size))
        except OSError:
            out.append(None)
    return tuple(out)


class Bus:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()
        self._dirty = asyncio.Event()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:   # a stalled client; drop its oldest
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(event)

    def mark_dirty(self) -> None:
        """Ask the watcher to publish a snapshot on its next tick."""
        self._dirty.set()

    @property
    def subscribers(self) -> int:
        return len(self._subs)


bus = Bus()


async def watcher(snapshot_fn) -> None:
    """Poll the run files; on any change publish a snapshot to subscribers.

    `snapshot_fn` is an async callable returning a pydantic model. It runs
    only when something changed (or on the heartbeat) and only when someone
    is listening, so an idle server does no work.
    """
    last_fp = None
    last_sent = 0.0
    while True:
        try:
            await asyncio.wait_for(bus._dirty.wait(), timeout=POLL_S)
        except asyncio.TimeoutError:
            pass
        bus._dirty.clear()
        if not bus.subscribers:
            last_fp = None          # force a fresh snapshot for the next listener
            continue
        fp = fingerprint()
        now = time.time()
        if fp != last_fp or now - last_sent > HEARTBEAT_S:
            last_fp, last_sent = fp, now
            try:
                snap = await snapshot_fn()
                bus.publish({"type": "snapshot", "data": snap.model_dump(by_alias=True)})
            except Exception as e:  # never let a bad read kill the stream
                bus.publish({"type": "log", "verb": "server", "at": now,
                             "line": f"snapshot failed: {type(e).__name__}: {str(e)[:120]}"})


def sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def snapshot():
    """The light snapshot the lab pages watch."""
    from ..schemas import RunSnapshot
    from .workers import workers
    last = workers.last_exit()
    return RunSnapshot(busy=workers.busy(), last_exit=last if last and "verb" in last else None,
                       updated_at=time.time())


async def stream():
    """The SSE generator: a snapshot on connect, then every published event.

    Cloud Shell reaches this through a proxy that buffers a streaming response
    until it has enough bytes, which holds a command's output back for tens of
    seconds. The padding below fills that buffer at once so everything after it
    is delivered as it is produced, and the heartbeat keeps it flushed."""
    q = bus.subscribe()
    try:
        yield ":" + " " * 2048 + "\n\n"        # defeat a buffering proxy
        snap = await snapshot()
        yield sse({"type": "snapshot", "data": snap.model_dump(by_alias=True)})
        while True:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_S)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield sse(ev)
    finally:
        bus.unsubscribe(q)
