"""Tonight's video, as far as it has got: what the student has made so far
that can go on the wall, and the way it gets there - through VibeStudio.

Step 9 deploys VibeStudio to Cloud Run, and setup_codelab.sh now starts that
deploy in the background during setup, so the production app is live from the
opening steps. A student can either:
  1. Give VibeStudio an idea and let it run the full workflow unattended
     (POST /api/night/auto -> research, direction pick, policy gate, script,
     Veo render, and VibeTube publish), from step 1 onward; or
  2. Hand VibeStudio a clip rendered in step 8 (or rendered on the spot by Veo
     from the script/reply in steps 3-7) via POST /api/night/import and press
     publish there (POST /api/publish).

    night()                 -> {"clip": ..., "title": ..., "description": ..., "shots": ..., "idea": ...}
    render_clip(...)        -> (path, duration_ms) rendered by Veo when words exist before step 8
    run_night(app, ...)     -> unattended full workflow + publish in VibeStudio
    profile(**overrides)    -> room, display name, platform URL, project id (.env, then runs/post.json)
    studio()                -> where the app is: runs/deploy.json, lock state, and URL
    hand_over(app, ...)     -> multipart import of a finished clip into VibeStudio
    press_publish(app, ...) -> trigger /api/publish on VibeStudio and follow until done; writes runs/post.json
    room(code) · video(code, id)
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import time
from typing import Any

from agent.platform import config, drive

ROOT = config.ROOT
RUNS = config.RUNS
RENDERS = pathlib.Path(os.environ.get("STUDIO_VIDEO_DIR") or (RUNS / "media" / "renders"))
RECORD = RUNS / "post.json"                 # the last post: what went out, what came back
DEPLOY_RECORD = RUNS / "deploy.json"        # where the app is (vibestudio/deploy.py writes it)
CLIP_MS = 8000

# sandbox apps whose sessions can hold a script, direction, or reply, newest stage first
GRAPH_APPS = ("stage6_video", "stage5_rag", "stage4_memory", "stage3_router", "stage2_direction")
SOLO_APP = "stage0_prompt"
ALL_IDEA_APPS = (*GRAPH_APPS, "stage1_fanout", SOLO_APP)

_SKIP_IDEAS = {
    "1", "2", "3", "4",
    "skip the questions, just describe the video",
    "skip the questions, just describe the video.",
}


# ── small readers ───────────────────────────────────────────────────────────

def _json(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def _newest(folder: pathlib.Path, pattern: str, skip=lambda p: False) -> pathlib.Path | None:
    try:
        files = [p for p in folder.glob(pattern) if p.is_file() and not skip(p)]
    except OSError:
        return None
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def _web(path: pathlib.Path) -> str:
    """The URL the lab server serves a file under runs/media at."""
    try:
        rel = path.resolve().relative_to((RUNS / "media").resolve())
    except ValueError:
        return ""
    return "/static/" + rel.as_posix()


def _texts(ev) -> list[str]:
    out: list[str] = []
    for attr in ("content", "message"):
        msg = getattr(ev, attr, None)
        for p in getattr(msg, "parts", None) or []:
            t = getattr(p, "text", None)
            if t:
                out.append(t)
    return out


# ── the session store: script, direction, solo reply, idea ──────────────────

async def _newest_session(app: str):
    """The newest session of one sandbox app across every user, or None."""
    svc = drive.svc()
    best = None
    for user in drive.users(app):
        try:
            resp = await svc.list_sessions(app_name=app, user_id=user)
        except Exception:
            continue
        for meta in resp.sessions:
            t = getattr(meta, "last_update_time", 0) or 0
            if best is None or t > best[0]:
                best = (t, user, meta.id)
    if best is None:
        return None
    try:
        return await svc.get_session(app_name=app, user_id=best[1], session_id=best[2])
    except Exception:
        return None


def _node_name(ev) -> str | None:
    info = getattr(ev, "node_info", None)
    path = getattr(info, "path", None) if info is not None else None
    if not path and isinstance(info, dict):
        path = info.get("path")
    return path.rsplit("/", 1)[-1].split("@")[0] if path else None


def _script_from_event(ev) -> dict | None:
    o = getattr(ev, "output", None)
    if isinstance(o, dict) and (o.get("title") or o.get("shots")):
        return o
    for text in _texts(ev):
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict) and (parsed.get("title") or parsed.get("shots")):
            return parsed
    return None


async def words() -> dict:
    """Title, description, style, opening_line, and shots from the newest run
    that has them: graph sessions first (scripter JSON, then persisted
    direction), then step 3's stage0_prompt reply."""
    out = {"title": "", "description": "", "opening_line": "", "style": "", "shots": [], "source": ""}
    for app in GRAPH_APPS:
        sess = await _newest_session(app)
        if sess is None:
            continue
        st = dict(getattr(sess, "state", None) or {})
        for ev in reversed(list(getattr(sess, "events", None) or [])):
            if _node_name(ev) == "scripter":
                s = _script_from_event(ev)
                if s:
                    title = str(s.get("title") or "").strip()
                    description = str(s.get("description") or "").strip()
                    opening_line = str(s.get("opening_line") or "").strip()
                    style = str(s.get("style") or "").strip()
                    shots = [str(sh.get("description", "") if isinstance(sh, dict) else sh).strip()
                             for sh in (s.get("shots") or []) if sh][:3]
                    if title:
                        out.update(title=title, description=description, opening_line=opening_line,
                                   style=style, shots=shots, source=f"{app} · the script")
                        return out
        direction = str(st.get("direction") or "").strip()
        if direction:
            out.update(title=direction, description=str(st.get("angle") or "").strip(),
                       source=f"{app} · the direction")
            return out
    sess = await _newest_session(SOLO_APP)
    if sess is not None:
        events = list(getattr(sess, "events", None) or [])
        for ev in reversed(events):
            if getattr(ev, "author", "") == "user":
                continue
            text = "\n".join(_texts(ev))
            named = title_from_reply(text)
            shots = shots_from_reply(text)
            if named or shots:
                out.update(title=named or "Tonight on VibeStudio", shots=shots,
                           source=f"{SOLO_APP} · the agent's reply")
                return out
    return out


def _clean_idea(raw: str) -> str:
    cleaned = re.sub(r"^\s*tonight['\u2019]?s\s+idea\s*:\s*", "", raw.strip(), flags=re.I).strip()
    if not cleaned or cleaned.lower() in _SKIP_IDEAS:
        return ""
    return cleaned[:300]


async def last_idea() -> str:
    """The newest idea prompt the student typed in step 3 or a workflow step,
    as the default for an unattended night; "" when there was none."""
    best: tuple[float, str] | None = None
    for app in ALL_IDEA_APPS:
        sess = await _newest_session(app)
        if sess is None:
            continue
        ts = float(getattr(sess, "last_update_time", 0) or 0)
        for ev in reversed(list(getattr(sess, "events", None) or [])):
            if getattr(ev, "author", "") != "user":
                continue
            idea = _clean_idea(" ".join(_texts(ev)))
            if idea:
                if best is None or ts >= best[0]:
                    best = (ts, idea)
                break
    return best[1] if best else ""


def shots_from_reply(text: str) -> list[str]:
    """The shots as the step 3 agent described them ("**Shot 1:** …"), up to
    three, for a render prompt."""
    shots: list[str] = []
    for line in text.splitlines():
        m = re.match(r"^\s*(?:[-*•]\s*|\d+[.)]\s*)?\**\s*shot\s*\d+\s*\**\s*[:.\-–]\s*\**\s*(.+?)\s*\**\s*$", line, re.I)
        if m and len(m.group(1)) > 8:
            shots.append(m.group(1).strip())
    return shots[:3]


def title_from_reply(text: str) -> str:
    """The video's title as the step 3 agent wrote it: a "Video:" or "Title:"
    line (heading, bold, or plain), else a short markdown heading."""
    for line in text.splitlines():
        m = re.match(r"^\s*(?:#+\s*|\*\*)?\s*(?:video\s+title|title|video)\s*:?\s*\*{0,2}\s*:?\s*(.+?)\s*\**\s*$", line, re.I)
        if m:
            t = m.group(1).strip().strip("*\"“”'").strip()
            if 3 <= len(t) <= 80:
                return t
    for line in text.splitlines():
        m = re.match(r"^\s*#{1,4}\s+(.+?)\s*$", line)
        if m:
            t = m.group(1).strip().strip("*\"“”'").strip()
            if 3 <= len(t) <= 60 and not t.lower().startswith(("shot", "the plan", "the direction")):
                return t
    return ""


# ── the rendered clip ───────────────────────────────────────────────────────

def clip() -> dict | None:
    """The clip that would be posted, or None when none has been rendered yet."""
    st = _json(config.STATE)
    rec = st.get("render") or {}
    p = pathlib.Path(rec["path"]) if rec.get("path") else None
    if rec.get("status") == "done" and p is not None and p.exists():
        return {"path": str(p), "url": rec.get("url") or _web(p), "prebaked": bool(rec.get("prebaked")),
                "duration_ms": rec.get("duration_ms") or CLIP_MS, "at": p.stat().st_mtime,
                "source": "runs/state.json · delivered in step 8"}
    p = _newest(RENDERS, "*.mp4")
    if p is None:
        return None
    return {"path": str(p), "url": _web(p), "prebaked": p.name.startswith("standin_"), "duration_ms": CLIP_MS,
            "at": p.stat().st_mtime, "source": "runs/media/renders · the newest clip"}


async def night() -> dict:
    """Everything the panel shows before the button is pressed."""
    w = await words()
    idea = await last_idea()
    cl = clip()
    from agent.platform import videogen
    return {
        "clip": cl,
        "title": w["title"],
        "description": w["description"],
        "opening_line": w["opening_line"],
        "style": w["style"],
        "shots": w["shots"],
        "words_source": w["source"],
        "idea": idea,
        "real_video": config.REAL_VIDEO,
        "veo_model": videogen.MODEL,
    }


def render_clip(*, title: str, description: str, shots: list[str], style: str = "", opening_line: str = "",
                say=print, timeout_s: float = 420, poll_s: float = 15) -> tuple[str, int | None]:
    """Render a clip via Veo from the title/shots gathered in steps 3-7 when no
    step 8 clip is on disk yet. Uses agent/platform/videogen.start and check
    directly without modifying videogen.py."""
    from agent.platform import videogen
    script = {
        "title": title,
        "description": description,
        "opening_line": opening_line,
        "style": style,
        "shots": shots or [f"{title}: one clear, filmable scene in motion."],
    }
    rec = videogen.start(script, retries=3, interval_s=20)
    say(f"  {rec.get('model')} · 16:9 · 720p")
    say(f"  prompt: {rec.get('prompt', '')[:160]}…")
    say(f"  operation {rec['operation'][-40:]} · a minute or three; this line is the receipt, as in step 8")
    t0 = time.time()
    n = 0
    st: dict = {"done": False}
    while time.time() - t0 < timeout_s:
        time.sleep(poll_s)
        n += 1
        st = videogen.check(rec["operation"], retries=3, interval_s=20)
        if st.get("done"):
            break
        say(f"  check {n}: not yet · {int(time.time() - t0)}s")
    if not st.get("done"):
        raise RuntimeError(f"Veo has not finished after {int(timeout_s)}s")
    if st.get("error"):
        raise RuntimeError(f"Veo did not render it: {st['error']}")
    if not st.get("path"):
        raise RuntimeError("Veo returned no file (is STUDIO_REAL_VIDEO=0?)")
    say(f"  clip ready · {_rel(st['path'])} · {int(time.time() - t0)}s")
    return st["path"], st.get("duration_ms")


# ── unattended run in VibeStudio ────────────────────────────────────────────

def run_night(app: str, idea: str, prof: dict, *, say=print, timeout_s: float = 1200, poll_s: float = 3) -> dict:
    """One idea in, the card on the wall out: the deployed VibeStudio runs the
    full workflow (POST /api/night/auto - the same graph and Runner as a run by
    hand, with direction_gate answered with candidate 1 and publish triggered
    when the render finishes), followed from here until the card is on VibeTube.
    Writes runs/post.json."""
    import httpx
    rec = {
        "status": "posting", "at": time.time(), "app_url": app, "title": "", "idea": idea,
        "event_code": prof["event_code"], "display_name": prof["display_name"],
        "platform_url": prof["platform_url"], "project_id": prof["project_id"],
        "clip": "", "attempts": 0, "video_id": "", "url": "", "detail": "", "night": "app",
    }
    _write(rec)
    say(f"── the whole workflow, in VibeStudio · {app} ──")
    say(f"  idea     {idea or '(none: the graph picks from the trends and the backlog)'}")
    say(f"  room     {prof['event_code']} · as {prof['display_name'] or 'Vibe Studio creator'}")
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as c:
            r = c.post(f"{app}/api/night/auto", json={
                "idea": idea,
                "publish": True,
                "event_code": prof["event_code"],
                "display_name": prof["display_name"],
                "platform_url": prof["platform_url"],
            })
            if r.status_code == 404:
                raise RuntimeError("this VibeStudio cannot run unattended: it was deployed before this change; deploy again (step 9, or python vibestudio/deploy.py)")
            if r.status_code != 200:
                try:
                    detail = r.json().get("detail", r.text[:160])
                except ValueError:
                    detail = r.text[:160]
                raise RuntimeError(f"the app did not start the run: {r.status_code} {detail}")
            run_id = r.json()["run_id"]
            say(f"  run {run_id} started; the readers go first")
            t0 = time.time()
            seen: set[str] = set()
            last_line = ""
            checks = 0
            while time.time() - t0 < timeout_s:
                time.sleep(poll_s)
                st = c.get(f"{app}/api/state").json()
                auto = c.get(f"{app}/api/night/auto/{run_id}").json()
                if st.get("run_id") != run_id:
                    raise RuntimeError("another run took over the app")
                for node in st.get("nodes_seen") or []:
                    if node not in seen:
                        seen.add(node)
                        extra = ""
                        if node == "propose_directions" and st.get("candidates"):
                            extra = f" · {len(st['candidates'])} directions"
                        if node == "policy_check" and st.get("route"):
                            extra = f" · {st['route']}" + (" → quarantine cleans it" if st["route"] == "BLOCK" else "")
                        if node == "scripter" and (st.get("script") or {}).get("title"):
                            extra = f" · \"{st['script']['title']}\""
                        say(f"  · {node}{extra}")
                if auto.get("picked") and "picked" not in seen:
                    seen.add("picked")
                    say(f"── the gate: {len(st.get('candidates') or [])} directions; the first is taken for you: \"{auto['picked']}\" ──")
                if st.get("status") == "rendering":
                    n = (st.get("render") or {}).get("checks") or 0
                    if n != checks:
                        checks = n
                        line = f"  rendering · Veo · check {n} · {int(time.time() - t0)}s"
                        if line != last_line:
                            say(line)
                            last_line = line
                stage = auto.get("stage", "")
                if st.get("status") == "failed" or stage == "failed":
                    detail = st.get("error") or auto.get("detail") or "the run failed"
                    rec.update(status="failed", detail=detail[:200], title=(st.get("script") or {}).get("title", ""))
                    say(f"── not posted: {detail[:200]} ──")
                    return _write(rec)
                if stage == "superseded":
                    raise RuntimeError("another run took over the app")
                if st.get("status") == "done" and "released" not in seen:
                    seen.add("released")
                    render = st.get("render") or {}
                    say(f"── rendered · clip {render.get('url', '')} ──")
                    rec.update(
                        title=(st.get("script") or {}).get("title") or (st.get("direction") or {}).get("title") or "",
                        clip=f"{app}{render.get('url', '')}" if render.get("url") else "",
                    )
                    _write(rec)
                if stage == "publishing" and "publishing" not in seen:
                    seen.add("publishing")
                    say(f"── publish, in the app · room {prof['event_code']} ──")
                pub = st.get("publish") or {}
                rec["attempts"] = pub.get("attempts") or rec["attempts"]
                if stage == "published":
                    rec.update(
                        status="done",
                        video_id=str(auto.get("video_id") or pub.get("video_id") or ""),
                        url=auto.get("url") or pub.get("url") or "",
                        detail="",
                        done_at=time.time(),
                    )
                    say(f"  200 · video id {rec['video_id'] or '(none)'} · attempt {rec['attempts'] or 1}")
                    say(f"── on the wall · {rec['url']} ──")
                    say("  VibeTube processes the file for a minute or three; your video card appears once processing finishes.")
                    return _write(rec)
                if stage == "done":
                    rec.update(status="done", detail="the run finished in the app (not published)", done_at=time.time())
                    return _write(rec)
    except RuntimeError:
        raise
    except Exception as e:
        rec.update(status="failed", detail=f"{type(e).__name__}: {str(e)[:160]}")
        say(f"── not posted: {rec['detail']} ──")
        return _write(rec)
    rec.update(status="failed", detail=f"the run is still going after {int(timeout_s)}s; the app's page shows where it is")
    say(f"── {rec['detail']} ──")
    return _write(rec)


# ── the room and the profile ────────────────────────────────────────────────

def profile(**overrides: str | None) -> dict:
    """Who posts where: .env (VIBETUBE_*), then what the last post used
    (runs/post.json), then what the caller typed. The project id is the Google
    Cloud project, as the app does it: one video per project and room."""
    rec = _json(RECORD)
    prof = {
        "platform_url": os.environ.get("VIBETUBE_URL") or "https://vibetube.dev",
        "event_code": rec.get("event_code") or os.environ.get("VIBETUBE_EVENT", ""),
        "display_name": rec.get("display_name") or os.environ.get("VIBETUBE_NAME", ""),
        "project_id": os.environ.get("VIBETUBE_PROJECT") or os.environ.get("STUDIO_GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT", ""),
    }
    for k, v in overrides.items():
        if k in prof and isinstance(v, str) and v.strip():
            prof[k] = v.strip()
    prof["platform_url"] = prof["platform_url"].rstrip("/")
    if not prof["project_id"]:
        prof["project_id"] = re.sub(r"[^a-z0-9]+", "-", f"{prof['display_name'] or 'creator'}-{prof['event_code'] or 'room'}".lower()).strip("-")
    return prof


def room(code: str, platform: str = "https://vibetube.dev") -> dict:
    """Is there a room with this code, and is its upload window open."""
    import httpx
    out = {"code": code, "name": "", "open": False, "state": "", "reason": "", "url": f"{platform}/e/{code}"}
    if not code:
        return out
    try:
        r = httpx.get(f"{platform}/api/events/{code}", timeout=10)
    except Exception as e:
        out.update(state="unreachable", reason=str(e)[:100])
        return out
    if r.status_code != 200:
        out.update(state=str(r.status_code), reason="no room with this code; codes are case-sensitive" if r.status_code == 404 else r.text[:100])
        return out
    ev = r.json()
    out.update(name=ev.get("name", ""), open=bool(ev.get("uploadOpen")), state=ev.get("uploadState") or "", reason=ev.get("reason") or "")
    return out


def video(code: str, video_id: str, platform: str = "https://vibetube.dev") -> dict | None:
    """The card VibeTube lists under this id in this room, or None."""
    import httpx
    if not code or not video_id:
        return None
    try:
        rows = httpx.get(f"{platform}/api/events/{code}/videos", timeout=15).json()
    except Exception:
        return None
    rows = rows if isinstance(rows, list) else rows.get("videos") or []
    v = next((row for row in rows if str(row.get("id")) == str(video_id)), None)
    if not v:
        return None
    thumb = v.get("thumbnailUrl") or ""
    if thumb.startswith("/"):
        thumb = platform + thumb
    return {
        "id": str(video_id),
        "status": v.get("status", ""),
        "title": v.get("title", ""),
        "channel": v.get("channelName", ""),
        "thumbnail_url": thumb,
        "watch_url": f"{platform}/e/{code}?v={video_id}",
        "project_id": v.get("projectId", ""),
    }


# ── the studio: where the app is ────────────────────────────────────────────

def studio(given: str | None = None) -> dict:
    """The VibeStudio the post goes through: the URL given, else the last one
    used, else the deploy's (runs/deploy.json), else STUDIO_APP_URL; and what
    the deploy record says - deploying since when, done, failed."""
    dep = _json(DEPLOY_RECORD)
    rec = _json(RECORD)
    url = ((given or "").strip() or rec.get("app_url") or dep.get("url") or os.environ.get("STUDIO_APP_URL", "")).rstrip("/")
    status = dep.get("status") or ("done" if dep.get("url") else "")
    try:
        from agent.platform.memory import creation_in_progress
        deploying = creation_in_progress("deploy")
    except Exception:
        deploying = False
    if deploying and status != "deploying":
        status = "deploying"
    if status == "deploying" and not deploying and dep.get("status") == "deploying":
        status = "interrupted"                       # the lock is gone but the record never ended: the process died
    return {
        "url": url,
        "status": status,
        "by": dep.get("by", ""),
        "started_at": dep.get("started_at"),
        "at": dep.get("at"),
        "detail": dep.get("detail", ""),
        "project": dep.get("project", ""),
        "region": dep.get("region", ""),
    }


def app_state(app: str, timeout: float = 20) -> dict | None:
    """The app's /api/state, or None when it does not answer."""
    import httpx
    try:
        r = httpx.get(f"{app}/api/state", timeout=timeout, follow_redirects=True)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


# ── the hand-over and the publish, through the app ──────────────────────────

def _rel(path: str | None) -> str:
    """A path under the repo, said from the repo."""
    if not path:
        return ""
    try:
        return str(pathlib.Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return path


def _write(rec: dict) -> dict:
    RUNS.mkdir(exist_ok=True)
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    RECORD.write_text(json.dumps(rec, indent=2, ensure_ascii=False))
    return rec


def hand_over(app: str, *, title: str, description: str, clip_path: str | None,
              thumbnail_path: str | None = None, duration_ms: int | None = None, say=print) -> dict:
    """Hand a rendered clip to VibeStudio via multipart POST {app}/api/night/import.
    The app writes the mp4 (and optional PNG thumbnail) where its own renders
    land and sets its run state to done so /api/publish can post it."""
    import httpx
    say(f"── handing the clip to VibeStudio · {app} ──")
    say(f"  title        {title}")
    say(f"  clip         {_rel(clip_path)}" if clip_path else "  clip         (none)")
    if thumbnail_path:
        say(f"  thumbnail    {_rel(thumbnail_path)}")
    if not clip_path:
        raise RuntimeError("nothing to hand over: no rendered clip (.mp4)")
    files: dict = {
        "clip": (pathlib.Path(clip_path).name, open(clip_path, "rb"), "video/mp4"),
    }
    if thumbnail_path:
        files["thumbnail"] = (pathlib.Path(thumbnail_path).name, open(thumbnail_path, "rb"), "image/png")
    data = {
        "title": title,
        "description": description,
        "source": "the workbench",
        "duration_ms": str(duration_ms or CLIP_MS),
    }
    try:
        r = httpx.post(f"{app}/api/night/import", data=data, files=files, timeout=180, follow_redirects=True)
    except httpx.HTTPError as e:
        raise RuntimeError(f"cannot reach VibeStudio at {app}: {type(e).__name__}: {str(e)[:120]}") from e
    finally:
        for _, (_, fh, _) in files.items():
            fh.close()
    if r.status_code == 404:
        raise RuntimeError("this VibeStudio has no /api/night/import: it was deployed before this change; deploy again (step 9, or python vibestudio/deploy.py)")
    if r.status_code != 200:
        try:
            detail = r.json().get("detail", r.text[:160])
        except ValueError:
            detail = r.text[:160]
        raise RuntimeError(f"the app refused the clip: {r.status_code} {detail}")
    out = r.json()
    say(f"  the app took it as run {out.get('run_id')} · clip {out.get('render', {}).get('url')}")
    return out


def press_publish(app: str, prof: dict, *, title: str, clip_path: str,
                  thumbnail_path: str | None = None, say=print, wait_s: float = 150, poll_s: float = 2.0) -> dict:
    """Set the app's profile (the room, the name, the platform) and press
    publish there, then follow its publish record until it is done, needs
    confirming, or failed. Writes runs/post.json."""
    import httpx
    rec = {
        "status": "posting", "at": time.time(), "app_url": app, "title": title,
        "event_code": prof["event_code"], "display_name": prof["display_name"],
        "platform_url": prof["platform_url"], "project_id": prof["project_id"],
        "clip": clip_path, "thumbnail": thumbnail_path or "",
        "attempts": 0, "video_id": "", "url": "", "detail": "",
    }
    _write(rec)
    say(f"── publish, in the app · room {prof['event_code']} · as {prof['display_name'] or 'Vibe Studio creator'} ──")
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as c:
            r = c.put(f"{app}/api/profile", json={
                "event_code": prof["event_code"],
                "display_name": prof["display_name"],
                "platform_url": prof["platform_url"],
            })
            if r.status_code != 200:
                raise RuntimeError(f"the app refused the profile: {r.status_code} {r.text[:120]}")
            r = c.post(f"{app}/api/publish", json={"confirm": False})
            if r.status_code != 200:
                try:
                    detail = r.json().get("detail", r.text[:160])
                except ValueError:
                    detail = r.text[:160]
                raise RuntimeError(f"the app did not start the publish: {r.status_code} {detail}")
            say("  the app is uploading the clip to VibeTube")
            t0 = time.time()
            pub: dict = {}
            while time.time() - t0 < wait_s:
                time.sleep(poll_s)
                st = c.get(f"{app}/api/state").json()
                pub = st.get("publish") or {}
                rec["attempts"] = pub.get("attempts") or rec["attempts"]
                if pub.get("status") in ("done", "failed", "needs_confirm"):
                    break
                if pub.get("detail") and pub.get("detail") != rec.get("detail"):
                    rec["detail"] = pub["detail"]
                    say(f"  {pub['detail']}")
                _write(rec)
    except RuntimeError:
        raise
    except Exception as e:
        rec.update(status="failed", detail=f"{type(e).__name__}: {str(e)[:160]}")
        say(f"── not posted: {rec['detail']} ──")
        return _write(rec)
    if pub.get("status") == "done":
        rec.update(status="done", video_id=str(pub.get("video_id") or ""), url=pub.get("url") or "", detail="", done_at=time.time())
        say(f"  200 · video id {rec['video_id'] or '(none)'} · attempt {rec['attempts'] or 1}")
        say(f"── on the wall · {rec['url']} ──")
        say("  VibeTube processes the file for a minute or three; your video card appears once processing finishes.")
    elif pub.get("status") in ("failed", "needs_confirm"):
        rec.update(status="failed", detail=pub.get("detail") or pub.get("status"))
        say(f"── not posted: {rec['detail']} ──")
    else:
        rec.update(status="failed", detail=f"the app is still publishing after {int(wait_s)}s; check again in a moment")
        say(f"── {rec['detail']} ──")
    return _write(rec)


def record() -> dict:
    """The last post, as runs/post.json keeps it."""
    return _json(RECORD)


def status_for(rec: dict) -> dict[str, Any]:
    """What VibeTube says about the last post: the room now and the card."""
    out: dict[str, Any] = {"room": None, "video": None}
    platform = rec.get("platform_url") or "https://vibetube.dev"
    code = rec.get("event_code") or ""
    if code:
        out["room"] = room(code, platform)
    vid = rec.get("video_id")
    if code and vid:
        out["video"] = video(code, vid, platform)
    return out
