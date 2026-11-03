"""Tonight's night, as far as it has got: what the student has made so far
that can go on the wall, and the way it gets there - through VibeStudio.

The lab's last step publishes from VibeStudio on Cloud Run (step 9), and
setup now deploys that app in the background, so it is live from step 1 or
2. The wall does not have to wait for step 9: from step 3 on, the deployed
app can run the whole night from one idea and publish it; from step 8 on,
the clip the delivery brought back can be posted as it is. This module
reads the night back from where the lab leaves it, hands it to the app
(POST /api/night/import, or POST /api/night/auto for a whole night), and
presses publish there: the app does the one request to the room, exactly
as step 9 teaches. Nothing here calls a model.

    night()                 -> {"clip": ..., "title": ..., "description": ..., "idea": ...}
    profile(**overrides)    -> the room, the name, the platform, the project id (.env, then runs/post.json)
    studio()                -> where the app is: runs/deploy.json, and whether it answers
    run_night(app, idea)    -> the whole night in the app, followed to the wall
    hand_over(app, ...)     -> the clip into the app, as a finished night
    press_publish(app, ...) -> the app's publish, followed until it is done; the record lands in runs/post.json
    room(code) · video(code, id)

Where things come from, in order:

    clip      runs/state.json["render"] when delivered and on disk (step 8), else the
              newest mp4 under runs/media/renders. STUDIO_REAL_VIDEO=0 leaves no file,
              so a stand-in run has no clip to post: the whole night in the app is the
              way onto the wall then.
    title     the scripter's title in the newest graph session (step 5 on), else its
              direction, else the title the step-3 agent gave the video in its reply.
    idea      what the student told the step-3 agent, as the default for a whole night.
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

# the sandbox apps whose sessions can hold a title or a direction; the one
# with the render first, since the clip (when there is one) came from it
GRAPH_APPS = ("stage6_video", "stage5_rag", "stage4_memory", "stage3_router", "stage2_direction")
SOLO_APP = "stage0_prompt"


# ── small readers ───────────────────────────────────────────────────────────

def _json(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def _newest(folder: pathlib.Path, pattern: str) -> pathlib.Path | None:
    try:
        files = [p for p in folder.glob(pattern) if p.is_file()]
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


# ── the session store: a title, an idea ─────────────────────────────────────

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
    return path.rsplit("/", 1)[-1].split("@")[0] if path else None


def _texts(ev) -> list[str]:
    msg = getattr(ev, "content", None) or getattr(ev, "message", None)
    return [p.text for p in (getattr(msg, "parts", None) or []) if getattr(p, "text", None)]


def _script_of(ev) -> dict | None:
    """The scripter's Script, when this event carries one: as the node's
    output, or as the JSON text the agent node answered with."""
    o = getattr(ev, "output", None)
    if isinstance(o, dict) and o.get("title") and "shots" in o:
        return o
    for text in _texts(ev):
        try:
            s = json.loads(text)
        except (ValueError, TypeError):
            continue
        if isinstance(s, dict) and s.get("title") and "shots" in s:
            return s
    return None


async def words() -> dict:
    """A title and a description for the card, from the newest run that has
    one: the graph sessions first (the scripter's title, else the direction),
    then the step-3 agent's reply, where it named the video. Each value says
    where it came from."""
    out = {"title": "", "description": "", "source": ""}
    for app in GRAPH_APPS:
        sess = await _newest_session(app)
        if sess is None:
            continue
        for ev in reversed(list(getattr(sess, "events", None) or [])):
            if _node_name(ev) != "scripter":
                continue
            s = _script_of(ev)
            if s:
                out.update(title=str(s.get("title") or "").strip(), description=str(s.get("description") or "").strip(),
                           source=f"{app} · the script")
                return out
        st = dict(getattr(sess, "state", None) or {})
        direction = (st.get("direction") or "").strip()
        if direction:
            out.update(title=direction, source=f"{app} · the direction")
            return out
    sess = await _newest_session(SOLO_APP)
    if sess is not None:
        for ev in reversed(list(getattr(sess, "events", None) or [])):
            if getattr(ev, "author", "") == "user":
                continue
            named = title_from_reply("\n".join(_texts(ev)))
            if named:
                out.update(title=named, source=f"{SOLO_APP} · the agent's reply")
                return out
    return out


async def last_idea() -> str:
    """The idea the student gave the step-3 agent, as the default for a
    whole night in the app; "" when there was none."""
    sess = await _newest_session(SOLO_APP)
    if sess is None:
        return ""
    for ev in reversed(list(getattr(sess, "events", None) or [])):
        if getattr(ev, "author", "") != "user":
            continue
        text = " ".join(_texts(ev)).strip()
        if text:
            return text[:300]
    return ""


def title_from_reply(text: str) -> str:
    """The video's title as the step-3 agent wrote it, when it did: a
    "Video:" or "Title:" line (heading, bold, or plain), else a short heading."""
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


# ── the clip ────────────────────────────────────────────────────────────────

def clip() -> dict | None:
    """The clip that would be the video, or None when the lab has not
    rendered one yet (or rendered a stand-in, which leaves no file)."""
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
    return {"path": str(p), "url": _web(p), "prebaked": False, "duration_ms": CLIP_MS,
            "at": p.stat().st_mtime, "source": "runs/media/renders · the newest clip"}


async def night() -> dict:
    """Everything the panel shows before a button is pressed."""
    w = await words()
    idea = await last_idea()
    return {"clip": clip(), "title": w["title"], "description": w["description"], "words_source": w["source"],
            "idea": idea, "real_video": config.REAL_VIDEO}


# ── the whole night, in the app ─────────────────────────────────────────────

def run_night(app: str, idea: str, prof: dict, *, say=print, timeout_s: float = 1200, poll_s: float = 3) -> dict:
    """One idea in, the card on the wall out: the app runs the whole night
    (POST /api/night/auto - the same graph and Runner as a night run by hand,
    the gate answered with its first direction, the publish pressed when the
    night is released) and this follows it from here, a line per step, until
    the card is on the wall. The record is runs/post.json."""
    import httpx
    rec = {"status": "posting", "at": time.time(), "app_url": app, "title": "", "idea": idea, "event_code": prof["event_code"],
           "display_name": prof["display_name"], "platform_url": prof["platform_url"], "project_id": prof["project_id"],
           "clip": "", "attempts": 0, "video_id": "", "url": "", "detail": "", "night": "app"}
    _write(rec)
    say(f"── the whole night, in VibeStudio · {app} ──")
    say(f"  idea     {idea or '(none: the graph picks from the trends and the backlog)'}")
    say(f"  room     {prof['event_code']} · as {prof['display_name'] or 'Vibe Studio creator'}")
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as c:
            r = c.post(f"{app}/api/night/auto", json={"idea": idea, "publish": True, "event_code": prof["event_code"], "display_name": prof["display_name"]})
            if r.status_code == 404:
                raise RuntimeError("this VibeStudio cannot run a night unattended: it was deployed before this change; deploy again (step 9, or python vibestudio/deploy.py)")
            if r.status_code != 200:
                try:
                    detail = r.json().get("detail", r.text[:160])
                except ValueError:
                    detail = r.text[:160]
                raise RuntimeError(f"the app did not start the night: {r.status_code} {detail}")
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
                            say(line); last_line = line
                stage = auto.get("stage", "")
                if st.get("status") == "failed" or stage == "failed":
                    detail = st.get("error") or auto.get("detail") or "the night failed"
                    rec.update(status="failed", detail=detail[:200], title=(st.get("script") or {}).get("title", ""))
                    say(f"── not posted: {detail[:200]} ──")
                    return _write(rec)
                if stage == "superseded":
                    raise RuntimeError("another run took over the app")
                if st.get("status") == "done" and "released" not in seen:
                    seen.add("released")
                    render = st.get("render") or {}
                    say(f"── released · clip {render.get('url') or '(none)'}{' (the stand-in: no file)' if render.get('prebaked') else ''} ──")
                    rec.update(title=(st.get("script") or {}).get("title") or (st.get("direction") or {}).get("title") or "",
                               clip=f"{app}{render.get('url', '')}" if render.get("url") else "")
                    _write(rec)
                if stage == "publishing" and "publishing" not in seen:
                    seen.add("publishing")
                    say(f"── publish, in the app · room {prof['event_code']} ──")
                pub = st.get("publish") or {}
                rec["attempts"] = pub.get("attempts") or rec["attempts"]
                if stage == "published":
                    rec.update(status="done", video_id=str(auto.get("video_id") or pub.get("video_id") or ""), url=auto.get("url") or pub.get("url") or "",
                               detail="", done_at=time.time())
                    say(f"  200 · video id {rec['video_id'] or '(none)'} · attempt {rec['attempts'] or 1}")
                    say(f"── on the wall · {rec['url']} ──")
                    say("  VibeTube processes the file for a minute or three; the card appears on the wall once it is ready.")
                    return _write(rec)
                if stage == "done":
                    rec.update(status="done", detail="the night is released in the app (not published)", done_at=time.time())
                    return _write(rec)
    except RuntimeError:
        raise
    except Exception as e:
        rec.update(status="failed", detail=f"{type(e).__name__}: {str(e)[:160]}")
        say(f"── not posted: {rec['detail']} ──")
        return _write(rec)
    rec.update(status="failed", detail=f"the night is still going after {int(timeout_s)}s; the app's page shows where it is")
    say(f"── {rec['detail']} ──")
    return _write(rec)


# ── the room and the profile ────────────────────────────────────────────────

def profile(**overrides: str | None) -> dict:
    """Who posts where: .env (VIBETUBE_*), then what the last post used
    (runs/post.json), then what the caller typed. The project id is the Google
    Cloud project, as the app does it: one video per project and room."""
    rec = _json(RECORD)
    prof = {"platform_url": os.environ.get("VIBETUBE_URL") or "https://vibetube.dev",
            "event_code": rec.get("event_code") or os.environ.get("VIBETUBE_EVENT", ""),
            "display_name": rec.get("display_name") or os.environ.get("VIBETUBE_NAME", ""),
            "project_id": os.environ.get("VIBETUBE_PROJECT") or os.environ.get("STUDIO_GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT", "")}
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
    return {"id": str(video_id), "status": v.get("status", ""), "title": v.get("title", ""), "channel": v.get("channelName", ""),
            "thumbnail_url": thumb, "watch_url": f"{platform}/e/{code}?v={video_id}", "project_id": v.get("projectId", "")}


# ── the studio: where the app is ────────────────────────────────────────────

def studio(given: str | None = None) -> dict:
    """The VibeStudio the night goes through: the URL given, else the last one
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
    return {"url": url, "status": status, "by": dep.get("by", ""), "started_at": dep.get("started_at"), "at": dep.get("at"),
            "detail": dep.get("detail", ""), "project": dep.get("project", ""), "region": dep.get("region", "")}


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
    RECORD.write_text(json.dumps(rec, indent=2, ensure_ascii=False))
    return rec


def hand_over(app: str, *, title: str, description: str, clip_path: str, duration_ms: int | None = None, say=print) -> dict:
    """The clip into the app: one multipart POST to {app}/api/night/import
    with the clip and the title. The app writes the file where its own
    renders land and its run state becomes a done night."""
    import httpx
    say(f"── handing the night to VibeStudio · {app} ──")
    say(f"  title        {title}")
    say(f"  clip         {_rel(clip_path)}")
    if not clip_path or not pathlib.Path(clip_path).exists():
        raise RuntimeError("nothing to hand over: no clip on disk")
    data = {"title": title, "description": description, "source": "the workbench", "duration_ms": str(duration_ms or CLIP_MS)}
    with open(clip_path, "rb") as fh:
        files = {"clip": (pathlib.Path(clip_path).name, fh, "video/mp4")}
        try:
            r = httpx.post(f"{app}/api/night/import", data=data, files=files, timeout=180, follow_redirects=True)
        except httpx.HTTPError as e:
            raise RuntimeError(f"cannot reach VibeStudio at {app}: {type(e).__name__}: {str(e)[:120]}") from e
    if r.status_code == 404:
        raise RuntimeError("this VibeStudio has no /api/night/import: it was deployed before this change; deploy again (step 9, or python vibestudio/deploy.py)")
    if r.status_code != 200:
        try:
            detail = r.json().get("detail", r.text[:160])
        except ValueError:
            detail = r.text[:160]
        raise RuntimeError(f"the app refused the night: {r.status_code} {detail}")
    out = r.json()
    say(f"  the app took it as run {out.get('run_id')} · clip {out.get('render', {}).get('url')}")
    return out


def press_publish(app: str, prof: dict, *, title: str, clip_path: str, say=print, wait_s: float = 150) -> dict:
    """Set the app's profile (the room, the name) and press publish there, then
    follow its publish record until it is done, needs confirming, or failed.
    The app does the request to the room; this only watches. The record of
    what was sent and what came back is runs/post.json."""
    import httpx
    rec = {"status": "posting", "at": time.time(), "app_url": app, "title": title, "event_code": prof["event_code"],
           "display_name": prof["display_name"], "platform_url": prof["platform_url"], "project_id": prof["project_id"],
           "clip": clip_path, "attempts": 0, "video_id": "", "url": "", "detail": ""}
    _write(rec)
    say(f"── publish, in the app · room {prof['event_code']} · as {prof['display_name'] or 'Vibe Studio creator'} ──")
    try:
        with httpx.Client(timeout=30, follow_redirects=True) as c:
            r = c.put(f"{app}/api/profile", json={"event_code": prof["event_code"], "display_name": prof["display_name"], "platform_url": prof["platform_url"]})
            if r.status_code != 200:
                raise RuntimeError(f"the app refused the profile: {r.status_code} {r.text[:120]}")
            r = c.post(f"{app}/api/publish", json={"confirm": False})
            if r.status_code != 200:
                try:
                    detail = r.json().get("detail", r.text[:160])
                except ValueError:
                    detail = r.text[:160]
                raise RuntimeError(f"the app did not start the publish: {r.status_code} {detail}")
            say("  the app is posting the clip")
            t0 = time.time()
            pub: dict = {}
            while time.time() - t0 < wait_s:
                time.sleep(3)
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
        say("  VibeTube processes the file for a minute or three; the card appears on the wall once it is ready.")
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
    """What VibeTube says about the last post: the room now, and the card.
    Network, so not for every snapshot."""
    out: dict[str, Any] = {"room": None, "video": None}
    platform = rec.get("platform_url") or "https://vibetube.dev"
    code = rec.get("event_code") or ""
    if code:
        out["room"] = room(code, platform)
    vid = rec.get("video_id")
    if code and vid:
        out["video"] = video(code, vid, platform)
    return out
