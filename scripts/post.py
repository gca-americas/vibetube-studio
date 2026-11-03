"""`python scripts/post.py` - put tonight's video on the wall, through VibeStudio.

Setup deployed VibeStudio to Cloud Run in the background, so the app of
step 9 is live from the first steps. This either has that app run the whole
night from one idea and publish it (--night), or hands it the clip you have
made so far as a finished night and presses publish there. Either way the
app does the one multipart request to the VibeTube room
(vibestudio/server/platform/publish.py), exactly as step 9 teaches - only
earlier.

    the clip     the render delivered in step 8 (runs/state.json), else the
                 newest clip under runs/media/renders. A stand-in render
                 (STUDIO_REAL_VIDEO=0) leaves no file: --night is the way then.
    the title    the script's title, else the direction, else what the agent
                 named the video in step 3

The app's URL comes from runs/deploy.json (setup's deploy, or step 9's). The
room, your name and the platform come from .env (VIBETUBE_EVENT, VIBETUBE_NAME,
VIBETUBE_URL); the room keeps one video per project, so posting again replaces
yours. The page's "Post my video" button runs this command; its record is
runs/post.json.

    python scripts/post.py --night "an idea"    the whole night in VibeStudio, unattended, then the wall
    python scripts/post.py --night ""           the same, from the idea you gave the step-3 agent
    python scripts/post.py                      post the clip there is
    python scripts/post.py --title "..."        a title of your own
    python scripts/post.py --event sandbox      another room, just this once
    python scripts/post.py --app https://...    a VibeStudio of your own (the local one: http://localhost:4700)
    python scripts/post.py --dry-run            say what would go out, send nothing
    python scripts/post.py --status             the last post, and what VibeTube says now
"""
from __future__ import annotations

import argparse
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.platform import drive  # noqa: E402
from server.services import night  # noqa: E402


def _rel(path: str | None) -> str:
    """A path under the repo, said from the repo: runs/media/renders/…"""
    if not path:
        return ""
    try:
        return str(pathlib.Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return path


def _age(ts: float | None) -> str:
    if not ts:
        return ""
    s = int(time.time() - ts)
    return f"{s}s ago" if s < 120 else f"{s // 60} min ago" if s < 7200 else f"{s // 3600} h ago"


def _failed(app: dict, prof: dict, detail: str, **more) -> None:
    night._write({"status": "failed", "at": time.time(), "detail": detail[:200], "app_url": app["url"], "event_code": prof["event_code"],
                  "display_name": prof["display_name"], "platform_url": prof["platform_url"], "project_id": prof["project_id"],
                  "title": "", "clip": "", "video_id": "", "url": "", "attempts": 0, **more})


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)          # the page streams this output
    ap = argparse.ArgumentParser(description="post tonight's video to the VibeTube room, through VibeStudio")
    ap.add_argument("--title", default="", help="the card's title (default: the script's, the direction's, or the agent's)")
    ap.add_argument("--description", default="", help="the card's description")
    ap.add_argument("--event", default="", help="the room's event code (default: VIBETUBE_EVENT in .env)")
    ap.add_argument("--name", default="", help="the name the card credits (default: VIBETUBE_NAME in .env)")
    ap.add_argument("--platform", default="", help="the platform URL (default: VIBETUBE_URL, https://vibetube.dev)")
    ap.add_argument("--app", default="", help="the VibeStudio to post through (default: the deploy's URL in runs/deploy.json)")
    ap.add_argument("--night", default=None, metavar="IDEA", help="run the whole night in VibeStudio from this idea, unattended, and publish it; an empty idea takes the one you gave the step-3 agent")
    ap.add_argument("--dry-run", action="store_true", help="show what would be posted and stop")
    ap.add_argument("--status", action="store_true", help="the last post and what VibeTube says about it now")
    a = ap.parse_args()

    prof = night.profile(event_code=a.event, display_name=a.name, platform_url=a.platform)
    app = night.studio(a.app)

    if a.status:
        rec = night.record()
        print(f"── VibeStudio · {app['status'] or 'not deployed'}" + (f" · {app['url']}" if app["url"] else "") + " ──")
        if not rec:
            print("no post yet: python scripts/post.py --night \"an idea\" runs one in the app and posts it"); return 0
        print(f"── last post · {rec.get('status')} · {_age(rec.get('at'))} ──")
        print(f"  title     {rec.get('title')}")
        if rec.get("idea"):
            print(f"  idea      {rec['idea']}")
        print(f"  through   {rec.get('app_url')}")
        print(f"  room      {rec.get('event_code')} · as {rec.get('display_name')} · project {rec.get('project_id')}")
        print(f"  clip      {_rel(rec.get('clip')) or '(none)'}")
        if rec.get("video_id"):
            print(f"  video id  {rec['video_id']} · {rec.get('url')}")
        if rec.get("detail"):
            print(f"  detail    {rec['detail']}")
        now = night.status_for(rec)
        r = now.get("room") or {}
        print(f"  room now  {r.get('code')} · {'open' if r.get('open') else (r.get('reason') or r.get('state') or 'unknown')}")
        v = now.get("video")
        if v:
            print(f"  on wall   {v['status']} · \"{v['title']}\" by {v['channel']}")
        elif rec.get("video_id"):
            print("  on wall   not listed yet; VibeTube is processing it")
        return 0

    n = drive.run(night.night())
    cl = n["clip"]

    if a.night is not None:
        idea = a.night.strip() or n["idea"]
        print("── one idea, the whole night ──")
        print(f"  idea     {idea or '(none)'}" + ("  (the one you gave the step-3 agent)" if not a.night.strip() and idea else ""))
        print(f"  room     {prof['event_code'] or '(none: VIBETUBE_EVENT in .env, or --event)'} · as {prof['display_name'] or '(no name)'} · project {prof['project_id']}")
        if app["url"]:
            print(f"  studio   {app['url']}  ({app['status'] or 'deployed'}" + (f", by {app['by']}" if app.get("by") else "") + ")")
        if not prof["event_code"]:
            print("no room: set VIBETUBE_EVENT in .env (./setup_codelab.sh asks for it) or pass --event"); return 2
        if not app["url"]:
            if app["status"] == "deploying":
                print("VibeStudio is still being deployed in the background (setup started it; log: runs/deploy_setup.log). Try again in a few minutes.")
            elif app["status"] == "failed":
                print(f"the deploy failed: {app['detail']} · step 9's Deploy button, or python vibestudio/deploy.py, tries again")
            else:
                print("no VibeStudio to run the night in: ./setup_codelab.sh deploys it in the background, python vibestudio/deploy.py does it now, or pass --app")
            return 2
        rm = night.room(prof["event_code"], prof["platform_url"])
        if not rm["open"]:
            print(f"the room {prof['event_code']} is not taking uploads: {rm['reason'] or rm['state'] or 'unknown'} (sandbox always is: --event sandbox)")
            if not a.dry_run:
                return 2
        else:
            print(f"  room     {rm['code']} · {rm['name']} · uploads open")
        state = night.app_state(app["url"])
        if state is None:
            print(f"VibeStudio at {app['url']} does not answer" + (" yet; the deploy is still running" if app["status"] == "deploying" else "; is the service up? (step 9 deploys it again)"))
            return 2
        print(f"  studio   answers · its run is {state.get('status') or 'idle'}")
        if a.dry_run:
            print("dry run: nothing started"); return 0
        try:
            rec = night.run_night(app["url"], idea, prof)
        except RuntimeError as e:
            print(f"── not posted: {e} ──")
            _failed(app, prof, str(e), idea=idea, night="app")
            return 1
        return 0 if rec.get("status") == "done" else 1

    title = a.title.strip() or n["title"] or "Tonight on VibeStudio"
    description = a.description.strip() or n["description"] or "Made in the VibeStudio workbench: the clip from the render desk."

    print("── tonight, as far as it has got ──")
    if cl:
        print(f"  clip     {_rel(cl['path'])}  ({_age(cl['at'])}; {cl['source']})")
    else:
        print("  clip     none yet" + (" (STUDIO_REAL_VIDEO=0: the stand-in render leaves no file)" if not n["real_video"] else ""))
    print(f"  title    {title}  ({n['words_source'] or 'default'})")
    print(f"  room     {prof['event_code'] or '(none: VIBETUBE_EVENT in .env, or --event)'} · as {prof['display_name'] or '(no name)'} · project {prof['project_id']}")
    if app["url"]:
        print(f"  studio   {app['url']}  ({app['status'] or 'deployed'}" + (f", by {app['by']}" if app.get("by") else "") + ")")
    else:
        print(f"  studio   not deployed yet ({app['status'] or 'no runs/deploy.json'})")

    if not cl:
        print("nothing to post yet: step 8 delivers the first clip. Until then, the app can run the whole night for you:  python scripts/post.py --night \"an idea\"")
        return 2
    if not prof["event_code"]:
        print("no room: set VIBETUBE_EVENT in .env (./setup_codelab.sh asks for it) or pass --event")
        return 2
    if not app["url"]:
        if app["status"] == "deploying":
            print("VibeStudio is still being deployed in the background (setup started it; log: runs/deploy_setup.log). Try again in a few minutes.")
        elif app["status"] == "failed":
            print(f"the deploy failed: {app['detail']} · step 9's Deploy button, or python vibestudio/deploy.py, tries again")
        else:
            print("no VibeStudio to post through: ./setup_codelab.sh deploys it in the background, python vibestudio/deploy.py does it now, or pass --app")
        return 2
    rm = night.room(prof["event_code"], prof["platform_url"])
    if not rm["open"]:
        print(f"the room {prof['event_code']} is not taking uploads: {rm['reason'] or rm['state'] or 'unknown'} (sandbox always is: --event sandbox)")
        if not a.dry_run:
            return 2
    else:
        print(f"  room     {rm['code']} · {rm['name']} · uploads open")
    state = night.app_state(app["url"])
    if state is None:
        print(f"VibeStudio at {app['url']} does not answer" + (" yet; the deploy is still running" if app["status"] == "deploying" else "; is the service up? (step 9 deploys it again)"))
        if not a.dry_run:
            return 2
    else:
        print(f"  studio   answers · its run is {state.get('status') or 'idle'}")
    if a.dry_run:
        print("dry run: nothing sent")
        return 0

    try:
        night.hand_over(app["url"], title=title, description=description, clip_path=cl["path"], duration_ms=cl.get("duration_ms"))
    except RuntimeError as e:
        print(f"── not posted: {e} ──")
        _failed(app, prof, str(e), title=title, clip=cl["path"])
        return 1
    try:
        rec = night.press_publish(app["url"], prof, title=title, clip_path=cl["path"])
    except RuntimeError as e:
        print(f"── not posted: {e} ──")
        _failed(app, prof, str(e), title=title, clip=cl["path"])
        return 1
    return 0 if rec.get("status") == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
