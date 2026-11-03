"""`python scripts/post.py` - put your video on the VibeTube wall, through VibeStudio.

Setup deployed VibeStudio to Cloud Run in the background, so the production app
from step 9 is live from the opening steps. From here you can either:
  - run the full workflow unattended in VibeStudio from an idea (`--night "..."`)
    and publish the rendered clip directly to VibeTube; or
  - hand VibeStudio what you have made in the workbench (`POST /api/night/import`)
    and press publish there (`POST /api/publish`), using the same multipart
    upload (`vibestudio/server/platform/publish.py`) as the deployed app.

    the clip     the render delivered in step 8 (runs/state.json), else the
                 newest clip under runs/media/renders, else (when STUDIO_REAL_VIDEO=1
                 and a script or reply exists from steps 3-7) one rendered now
                 by Veo from that title and shot list
    the title    the script's title, else the direction, else what the agent
                 named the video in step 3

The app's URL comes from runs/deploy.json (setup's deploy, or step 9's). The
room, your name and the platform come from .env (VIBETUBE_EVENT, VIBETUBE_NAME,
VIBETUBE_URL); the room keeps one video per project, so posting again replaces
yours. The top bar's "Post my video" button runs this command; its record is
runs/post.json.

    python scripts/post.py --night "an idea"    run the full workflow in VibeStudio, then publish
    python scripts/post.py --night ""           same, using the idea from step 3 (or trends + backlog)
    python scripts/post.py                      post the clip from the workbench (or render from steps 3-7)
    python scripts/post.py --title "..."        override the card's title
    python scripts/post.py --event sandbox      post to another room, just this once
    python scripts/post.py --app https://...    use a custom VibeStudio URL (local: http://localhost:4700)
    python scripts/post.py --dry-run            show what would go out, send nothing
    python scripts/post.py --status             the last post, and what VibeTube says now
"""
from __future__ import annotations

import argparse
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.platform import config, drive  # noqa: E402
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


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)          # the page streams this output
    ap = argparse.ArgumentParser(description="post your video to the VibeTube room, through VibeStudio")
    ap.add_argument("--title", default="", help="the card's title (default: the script's, the direction's, or the agent's)")
    ap.add_argument("--description", default="", help="the card's description")
    ap.add_argument("--event", default="", help="the room's event code (default: VIBETUBE_EVENT in .env)")
    ap.add_argument("--name", default="", help="the name the card credits (default: VIBETUBE_NAME in .env)")
    ap.add_argument("--platform", default="", help="the platform URL (default: VIBETUBE_URL, https://vibetube.dev)")
    ap.add_argument("--app", default="", help="the VibeStudio to post through (default: the deploy's URL in runs/deploy.json)")
    ap.add_argument("--night", default=None, metavar="IDEA",
                    help="run the full workflow in VibeStudio from this idea, unattended, and publish it; an empty idea uses the one from step 3")
    ap.add_argument("--dry-run", action="store_true", help="show what would be posted and stop")
    ap.add_argument("--status", action="store_true", help="the last post and what VibeTube says about it now")
    a = ap.parse_args()

    prof = night.profile(event_code=a.event, display_name=a.name, platform_url=a.platform)
    app = night.studio(a.app)

    if a.status:
        rec = night.record()
        print(f"── VibeStudio · {app['status'] or 'not deployed'}" + (f" · {app['url']}" if app["url"] else "") + " ──")
        if not rec:
            print("no post yet: python scripts/post.py posts what there is")
            return 0
        print(f"── last post · {rec.get('status')} · {_age(rec.get('at'))} ──")
        print(f"  title     {rec.get('title')}")
        print(f"  through   {rec.get('app_url')}")
        print(f"  room      {rec.get('event_code')} · as {rec.get('display_name')} · project {rec.get('project_id')}")
        print(f"  clip      {_rel(rec.get('clip'))}")
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
        print("── one idea, the whole workflow ──")
        print(f"  idea     {idea or '(none)'}" + ("  (from your earlier step)" if not a.night.strip() and idea else ""))
        print(f"  room     {prof['event_code'] or '(none: VIBETUBE_EVENT in .env, or --event)'} · as {prof['display_name'] or '(no name)'} · project {prof['project_id']}")
        if app["url"]:
            print(f"  studio   {app['url']}  ({app['status'] or 'deployed'}" + (f", by {app['by']}" if app.get("by") else "") + ")")
        if not prof["event_code"]:
            print("no room: set VIBETUBE_EVENT in .env (./setup_codelab.sh asks for it) or pass --event")
            return 2
        if not app["url"]:
            print("no VibeStudio to run the workflow in: ./setup_codelab.sh deploys it in the background, python vibestudio/deploy.py does it now, or pass --app")
            return 2
        rm = night.room(prof["event_code"], prof["platform_url"])
        if not rm["open"]:
            print(f"the room {prof['event_code']} is not taking uploads: {rm['reason'] or rm['state'] or 'unknown'} (sandbox always is: --event sandbox)")
            if not a.dry_run:
                return 2
        state = night.app_state(app["url"])
        if state is None:
            print(f"VibeStudio at {app['url']} does not answer")
            return 2
        print(f"  studio   answers · its run is {state.get('status') or 'idle'}")
        if a.dry_run:
            print("dry run: nothing started")
            return 0
        try:
            rec = night.run_night(app["url"], idea, prof)
        except RuntimeError as e:
            print(f"── not posted: {e} ──")
            night._write({
                "status": "failed", "at": time.time(), "detail": str(e)[:200], "app_url": app["url"],
                "event_code": prof["event_code"], "display_name": prof["display_name"],
                "platform_url": prof["platform_url"], "project_id": prof["project_id"],
                "title": "", "idea": idea, "clip": "", "video_id": "", "url": "", "attempts": 0, "night": "app",
            })
            return 1
        return 0 if rec.get("status") == "done" else 1

    has_words = bool(a.title.strip() or n["title"] or n["shots"])
    can_render = not cl and config.REAL_VIDEO and has_words
    title = a.title.strip() or n["title"] or "Tonight on VibeStudio"
    description = a.description.strip() or n["description"] or "Made in the VibeStudio workbench."

    print("── workbench video, as far as it has got ──")
    if cl:
        print(f"  clip     {_rel(cl['path'])}  ({_age(cl['at'])}; {cl['source']})" + ("  · stand-in" if cl["prebaked"] else ""))
    elif can_render:
        print(f"  clip     none yet: Veo renders one now ({n['veo_model']}, a minute or three)" + (f"; {len(n['shots'])} shots as the prompt" if n["shots"] else ""))
    else:
        print("  clip     none yet")
    print(f"  title    {title}  ({n['words_source'] or 'default'})")
    print(f"  room     {prof['event_code'] or '(none: VIBETUBE_EVENT in .env, or --event)'} · as {prof['display_name'] or '(no name)'} · project {prof['project_id']}")
    if app["url"]:
        print(f"  studio   {app['url']}  ({app['status'] or 'deployed'}" + (f", by {app['by']}" if app.get("by") else "") + ")")
    else:
        print(f"  studio   not deployed yet ({app['status'] or 'no runs/deploy.json'})")

    if not cl and not can_render:
        print('nothing rendered in the workbench yet: run step 8 to render a clip, or run `python scripts/post.py --night "your idea"` to run the full workflow in VibeStudio')
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

    clip_path = cl["path"] if cl else None
    duration_ms = (cl or {}).get("duration_ms")
    if not clip_path and can_render:
        print("── rendering clip with Veo from your workbench script ──")
        try:
            clip_path, duration_ms = night.render_clip(
                title=title,
                description=description,
                shots=n["shots"],
                style=n["style"],
                opening_line=n["opening_line"],
            )
        except Exception as e:
            print(f"── not posted: {str(e)[:200]} ──")
            night._write({
                "status": "failed", "at": time.time(), "detail": str(e)[:200], "app_url": app["url"],
                "event_code": prof["event_code"], "display_name": prof["display_name"],
                "platform_url": prof["platform_url"], "project_id": prof["project_id"],
                "title": title, "clip": "", "video_id": "", "url": "", "attempts": 0,
            })
            return 1
    try:
        night.hand_over(app["url"], title=title, description=description, clip_path=clip_path, duration_ms=duration_ms)
    except RuntimeError as e:
        print(f"── not posted: {e} ──")
        night._write({
            "status": "failed", "at": time.time(), "detail": str(e)[:200], "app_url": app["url"],
            "event_code": prof["event_code"], "display_name": prof["display_name"],
            "platform_url": prof["platform_url"], "project_id": prof["project_id"],
            "title": title, "clip": clip_path or "", "video_id": "", "url": "", "attempts": 0,
        })
        return 1
    try:
        rec = night.press_publish(app["url"], prof, title=title, clip_path=clip_path or "")
    except RuntimeError as e:
        print(f"── not posted: {e} ──")
        night._write({
            "status": "failed", "at": time.time(), "detail": str(e)[:200], "app_url": app["url"],
            "event_code": prof["event_code"], "display_name": prof["display_name"],
            "platform_url": prof["platform_url"], "project_id": prof["project_id"],
            "title": title, "clip": clip_path or "", "video_id": "", "url": "", "attempts": 0,
        })
        return 1
    return 0 if rec.get("status") == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
