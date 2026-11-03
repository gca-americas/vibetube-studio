"""Post my video, end to end, through a VibeStudio of our own and against a
VibeTube of our own: a clip is handed to the app (POST /api/night/import);
publish is pressed there (POST /api/publish); the app makes the multipart
request to the room; the record, the room, and the card read back what the fake
received; and unattended mode (POST /api/night/auto) + scripts/post.py CLI are
exercised. No external network, no model calls, nothing written under runs/
(everything runs inside a temporary folder).

    python checks/verify_post.py
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib
from email.parser import BytesParser
from email.policy import default as email_default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("STUDIO_VERTEX", "1")

from server.services import night  # noqa: E402

ok = True


def tick(name, cond, hint=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"   → {hint}"))
    ok = ok and bool(cond)


def png(w: int, h: int, rgb=(240, 120, 20)) -> bytes:
    """A minimal valid solid-color PNG."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def fake_mp4(payload: bytes = b"fake-veo-video-stream") -> bytes:
    """Minimal ftyp box + payload bytes representing an mp4 clip for upload tests."""
    ftyp = b"\x00\x00\x00\x14ftypisom\x00\x00\x02\x00isom"
    return ftyp + payload * 64


class FakeVibeTube(BaseHTTPRequestHandler):
    """The three routes the lab uses: the room, its videos, and the upload."""
    received: list[dict] = []
    room_open = True

    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/events/") and self.path.endswith("/videos"):
            code = self.path.split("/")[3]
            rows = [
                {
                    "id": r["id"],
                    "eventId": code,
                    "title": r["title"],
                    "status": "ready",
                    "channelName": r["displayName"],
                    "projectId": r["projectId"],
                    "thumbnailUrl": f"/thumbs/{r['id']}.png" if r.get("thumb") else "",
                }
                for r in self.received
                if r["event"] == code
            ]
            return self._send(200, rows)
        if self.path.startswith("/thumbs/"):
            vid = self.path.split("/")[-1].removesuffix(".png")
            r = next((x for x in self.received if x["id"] == vid), None)
            if r is None or not r.get("thumb"):
                return self._send(404, {"detail": "no thumbnail"})
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(r["thumb"])))
            self.end_headers()
            self.wfile.write(r["thumb"])
            return
        if self.path.startswith("/api/events/"):
            code = self.path.split("/")[3]
            if code == "nowhere":
                return self._send(404, {"detail": "event not found"})
            return self._send(
                200,
                {
                    "code": code,
                    "name": code.title(),
                    "uploadOpen": self.room_open,
                    "uploadState": "open" if self.room_open else "closed",
                    "reason": None if self.room_open else "The upload window for this showroom has closed.",
                },
            )
        self._send(404, {"detail": "nope"})

    def do_POST(self):
        if not (self.path.startswith("/api/events/") and self.path.endswith("/videos")):
            return self._send(404, {"detail": "nope"})
        code = self.path.split("/")[3]
        if code == "nowhere":
            return self._send(404, {"detail": "event not found"})
        if not self.room_open:
            return self._send(403, {"detail": "uploads are closed"})
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        msg = BytesParser(policy=email_default).parsebytes(
            b"Content-Type: " + self.headers.get("Content-Type", "").encode() + b"\r\n\r\n" + body
        )
        form = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True) for part in msg.iter_parts()}
        text = lambda k: (form.get(k) or b"").decode()  # noqa: E731
        rec = {
            "id": f"v_{len(self.received) + 1:04d}",
            "event": code,
            "title": text("title"),
            "description": text("description"),
            "duration": text("duration"),
            "displayName": text("displayName"),
            "projectId": text("projectId"),
            "video": form.get("videoFile") or b"",
            "thumb": form.get("thumbnailFile") or b"",
        }
        # one video per project and room: a new post replaces the old one
        self.received[:] = [r for r in self.received if not (r["event"] == code and r["projectId"] == rec["projectId"])]
        self.received.append(rec)
        self._send(200, {"id": rec["id"], "status": "processing"})


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_json(url: str, timeout: float = 10):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def start_app(tmp: pathlib.Path, platform: str) -> tuple[subprocess.Popen, str]:
    """A VibeStudio of our own: copied to a temporary folder (so its runs/ is
    there, not the repo's), pointed at FakeVibeTube, tracing off."""
    src = ROOT / "vibestudio"
    dst = tmp / "vibestudio"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "dist", "runs", "__pycache__", "*.pyc", ".env"))
    # Shorten publish retry pause inside the temporary copy so 403/404 retry tests complete in <1s
    pub_py = dst / "server" / "platform" / "publish.py"
    pub_py.write_text(pub_py.read_text().replace("PAUSE_S = 4.0", "PAUSE_S = 0.05"))
    port = free_port()
    env = {
        **os.environ,
        "STUDIO_VERTEX": "1",
        "STUDIO_TRACING": "0",
        "STUDIO_REAL_VIDEO": "0",
        "GOOGLE_CLOUD_PROJECT": "verify-project",
        "STUDIO_GCP_PROJECT": "verify-project",
        "VIBETUBE_PROJECT": "verify-project",
        "STUDIO_MEMORY_BANK": "projects/verify-project/locations/us-central1/reasoningEngines/1",
        "STUDIO_RAG_CORPUS": "projects/verify-project/locations/us-central1/ragCorpora/1",
        "VIBETUBE_URL": platform,
        "VIBETUBE_EVENT": "sandbox",
        "VIBETUBE_NAME": "Verify Bot",
        "PORT": str(port),
        "PYTHONPATH": str(tmp),
    }
    env.pop("GOOGLE_API_KEY", None)
    log = (tmp / "app.log").open("w")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "vibestudio.server.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(tmp),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            break
        try:
            get_json(f"{url}/api/state", timeout=2)
            return proc, url
        except Exception:
            time.sleep(0.25)
    proc.terminate()
    raise RuntimeError("the app did not come up: " + (tmp / "app.log").read_text()[-1500:])


def main() -> int:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="vibe-post-"))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeVibeTube)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    platform = f"http://127.0.0.1:{srv.server_port}"
    # point night module paths at the sandbox folder so nothing under runs/ is touched
    night.RENDERS = tmp / "renders"
    night.RENDERS.mkdir(parents=True, exist_ok=True)
    night.RECORD = tmp / "post.json"
    night.DEPLOY_RECORD = tmp / "deploy.json"
    clip = tmp / "renders" / "verify-clip.mp4"
    clip.write_bytes(fake_mp4())
    thumb = tmp / "thumb.png"
    thumb.write_bytes(png(160, 90))
    said: list[str] = []
    proc = None
    try:
        # 1. studio() deploy record & lock states
        os.environ.pop("STUDIO_APP_URL", None)
        tick("studio(): nothing deployed yet", night.studio()["url"] == "" and night.studio()["status"] == "")
        night.DEPLOY_RECORD.write_text(json.dumps({"status": "deploying", "by": "setup", "started_at": time.time()}))
        tick("studio(): a deploying record with no lock holder is 'interrupted'", night.studio()["status"] == "interrupted")
        night.DEPLOY_RECORD.write_text(json.dumps({"status": "done", "by": "setup", "url": "https://vibestudio-x.run.app", "at": time.time()}))
        st = night.studio()
        tick("studio(): a done record names the app", st["url"] == "https://vibestudio-x.run.app" and st["status"] == "done" and st["by"] == "setup")
        tick("studio(): a URL given wins", night.studio("http://127.0.0.1:1/")["url"] == "http://127.0.0.1:1")
        tick("app_state(): no app there is None", night.app_state("http://127.0.0.1:9", timeout=1) is None)

        # 2. room() probe
        r = night.room("sandbox", platform)
        tick("room(): open room reported accurately", r["open"] and r["name"] == "Sandbox")

        # 3. Live VibeStudio server + hand_over + press_publish
        proc, app = start_app(tmp, platform)
        tick(f"VibeStudio answers at {app}", night.app_state(app) is not None)
        tick("…and starts idle", (night.app_state(app) or {}).get("status") == "idle")
        health = get_json(f"{app}/api/health")
        tick("…/api/health reports ok", health.get("ok") is True)

        out = night.hand_over(
            app,
            title="Verify night",
            description="a check",
            clip_path=str(clip),
            thumbnail_path=str(thumb),
            say=said.append,
        )
        tick("hand_over(): the app took the clip and thumbnail", out.get("ok") and out["run_id"].startswith("import_"), json.dumps(out)[:200])
        st = night.app_state(app) or {}
        tick("…its run is done, with the title", st.get("status") == "done" and st.get("script", {}).get("title") == "Verify night", json.dumps(st)[:300])
        tick(
            "…the render is on its disk and served byte-for-byte",
            st.get("render", {}).get("status") == "done"
            and urllib.request.urlopen(app + st["render"]["url"], timeout=10).read() == clip.read_bytes(),
        )
        tick(
            "…the thumbnail is served byte-for-byte",
            st.get("thumbnail_url", "").startswith("/static/thumbs/")
            and urllib.request.urlopen(app + st["thumbnail_url"], timeout=10).read() == thumb.read_bytes(),
        )
        tick("…and it is in the app's history", any(i.get("title") == "Verify night" for i in get_json(f"{app}/api/history")["items"]))

        prof = night.profile(platform_url=platform, event_code="sandbox", display_name="Verify Bot")
        prof["project_id"] = "verify-project"
        rec = night.press_publish(app, prof, title="Verify night", clip_path=str(clip), thumbnail_path=str(thumb), say=said.append, poll_s=0.1)
        tick("press_publish(): done with a video id", rec["status"] == "done" and rec["video_id"] == "v_0001", json.dumps(rec)[:200])
        tick("the record is on disk and names the app", json.loads(night.RECORD.read_text())["app_url"] == app)
        got = FakeVibeTube.received[-1]
        tick("FakeVibeTube received the clip's bytes from the app", got["video"] == clip.read_bytes())
        tick("…and the optional thumbnailFile bytes", got["thumb"] == thumb.read_bytes())
        tick(
            "…title, duration 0:08, displayName, projectId",
            (got["title"], got["duration"], got["displayName"], got["projectId"]) == ("Verify night", "0:08", "Verify Bot", "verify-project"),
            str({k: got[k] for k in ("title", "duration", "displayName", "projectId")}),
        )
        st = night.app_state(app) or {}
        tick("the app's own publish record says done", (st.get("publish") or {}).get("status") == "done" and str(st["publish"].get("video_id")) == "v_0001")
        tick("the watch URL names the room and the id", rec["url"] == f"{platform}/e/sandbox?v=v_0001")

        v = night.video("sandbox", "v_0001", platform)
        tick("video() finds the card on VibeTube", bool(v) and v["status"] == "ready" and v["channel"] == "Verify Bot")

        # 4. Second hand-over without thumbnail replaces the video for the project
        out = night.hand_over(app, title="No thumb", description="", clip_path=str(clip), thumbnail_path=None, say=said.append)
        st = night.app_state(app) or {}
        tick("a second hand-over replaces the run (no thumbnail this time)", st.get("script", {}).get("title") == "No thumb" and st.get("thumbnail_url") == "")
        rec = night.press_publish(app, prof, title="No thumb", clip_path=str(clip), say=said.append, poll_s=0.1)
        tick("without a thumbnail, POST has no thumbnailFile", rec["status"] == "done" and FakeVibeTube.received[-1]["thumb"] == b"")
        tick("one video per project and room: the new post replaced the old", len([r for r in FakeVibeTube.received if r["event"] == "sandbox"]) == 1)

        # 5. Validation & failure paths
        try:
            urllib.request.urlopen(
                urllib.request.Request(f"{app}/api/night/import", method="POST", data=b"", headers={"Content-Type": "multipart/form-data; boundary=x"}),
                timeout=10,
            )
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        tick("an import without a clip is refused (422)", code == 422, str(code))

        FakeVibeTube.room_open = False
        rec = night.press_publish(app, prof, title="x", clip_path=str(clip), say=said.append, poll_s=0.1)
        tick("a closed room: failed, with the platform's 403 reason", rec["status"] == "failed" and "403" in rec["detail"], rec["detail"])
        FakeVibeTube.room_open = True
        prof2 = dict(prof, event_code="nowhere")
        rec = night.press_publish(app, prof2, title="x", clip_path=str(clip), say=said.append, poll_s=0.1)
        tick("a wrong event code: 404, with hint to check the event code", rec["status"] == "failed" and "check the event code" in rec["detail"], rec["detail"])

        # 6. render_clip() with Veo stubbed (without modifying videogen.py) + text helpers
        from agent.platform import videogen as vg
        calls = {"start": 0, "check": 0}
        real_start, real_check = vg.start, vg.check
        fake_clip = tmp / "renders" / "veo-fake.mp4"
        fake_clip.write_bytes(clip.read_bytes())

        def fake_start(script, **kw):
            calls["start"] += 1
            prompt = vg.build_prompt(script)
            assert f"Title: {script.get('title', '')}." in prompt and vg.NO_TEXT in prompt
            return {"operation": "projects/x/operations/op-1", "model": "veo-fake", "prompt": prompt}

        def fake_check(op, **kw):
            calls["check"] += 1
            if calls["check"] < 3:
                return {"done": False, "operation": op}
            return {"done": True, "operation": op, "path": str(fake_clip), "url": "/static/renders/veo-fake.mp4", "duration_ms": 8000}

        vg.start, vg.check = fake_start, fake_check
        try:
            said_r: list[str] = []
            path, dur = night.render_clip(title="Verify night", description="desc", shots=["shot one scene", "shot two scene"], say=said_r.append, poll_s=0.01)
            tick("render_clip(): submits receipt, polls checks, returns clip", path == str(fake_clip) and dur == 8000 and calls == {"start": 1, "check": 3}, str(calls))
            tick("…logs each check and completion", any("check 1: not yet" in l for l in said_r) and any("clip ready" in l for l in said_r))
            vg.check = lambda op, **kw: {"done": True, "operation": op, "error": "the model returned no video (filtered or empty)"}
            try:
                night.render_clip(title="x", description="", shots=[], say=said_r.append, poll_s=0.01)
                refused = ""
            except RuntimeError as e:
                refused = str(e)
            tick("a Veo refusal raises with Veo's reason", "did not render" in refused, refused)
            tick(
                "shots_from_reply(): parses up to three shots from step 3 reply",
                night.shots_from_reply("**Shot 1:** a tiny robot sorts socks.\n* **Shot 2:** soap bubbles float up.\n- Shot 3: folded shirts stack neatly.\nShot 4: dropped")
                == ["a tiny robot sorts socks.", "soap bubbles float up.", "folded shirts stack neatly."],
            )
            tick(
                "title_from_reply() & _clean_idea(): parses title and strips step 3 prefix",
                night.title_from_reply("### Midnight Laundry Bot\n**Shot 1:** sorting socks in warm light.") == "Midnight Laundry Bot"
                and night._clean_idea("tonight's idea: a tiny robot doing laundry at midnight") == "a tiny robot doing laundry at midnight"
                and night._clean_idea("skip the questions, just describe the video") == "",
            )
        finally:
            vg.start, vg.check = real_start, real_check

        # 7. run_night() unattended workflow + publish against scripted FakeNight
        class FakeNight(BaseHTTPRequestHandler):
            steps = [
                {"status": "running", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback"], "active": "join_research", "candidates": [], "render": {}, "publish": {}, "script": {}},
                {"status": "waiting_pick", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions"], "active": None,
                 "candidates": [{"title": "Midnight Spin Cycle"}, {"title": "B"}, {"title": "C"}, {"title": "D"}], "render": {}, "publish": {}, "script": {}},
                {"status": "running", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter"], "active": "render_desk",
                 "candidates": [{"title": "Midnight Spin Cycle"}], "route": "OK", "script": {"title": "Midnight Spin Cycle"}, "render": {}, "publish": {}},
                {"status": "rendering", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter", "render_desk"], "active": None,
                 "candidates": [{"title": "Midnight Spin Cycle"}], "script": {"title": "Midnight Spin Cycle"}, "render": {"status": "pending", "checks": 2}, "publish": {}},
                {"status": "done", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter", "render_desk", "store_video"], "active": None,
                 "candidates": [{"title": "Midnight Spin Cycle"}], "script": {"title": "Midnight Spin Cycle"}, "render": {"status": "done", "url": "/static/renders/r.mp4", "checks": 3}, "publish": {"status": "publishing", "attempts": 1}},
                {"status": "done", "run_id": "run_7", "nodes_seen": [], "active": None, "candidates": [], "script": {"title": "Midnight Spin Cycle"}, "render": {"status": "done", "url": "/static/renders/r.mp4"},
                 "publish": {"status": "done", "video_id": "v_night", "url": f"{platform}/e/sandbox?v=v_night", "attempts": 1}},
            ]
            stages = ["running", "running", "picked", "picked", "publishing", "published"]
            n = 0
            posted: list[dict] = []

            def log_message(self, *a):
                pass

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                if self.path == "/api/night/auto":
                    FakeNight.posted.append(body)
                    return self._send(200, {"ok": True, "run_id": "run_7"})
                self._send(404, {"detail": "nope"})

            def do_GET(self):
                if self.path == "/api/state":
                    i = min(FakeNight.n, len(FakeNight.steps) - 1)
                    FakeNight.n += 1
                    return self._send(200, FakeNight.steps[i])
                if self.path.startswith("/api/night/auto/"):
                    i = min(max(FakeNight.n - 1, 0), len(FakeNight.stages) - 1)
                    st_name = FakeNight.stages[i]
                    return self._send(
                        200,
                        {
                            "run_id": "run_7",
                            "stage": st_name,
                            "picked": "Midnight Spin Cycle" if i >= 2 else "",
                            "video_id": "v_night" if st_name == "published" else "",
                            "url": f"{platform}/e/sandbox?v=v_night" if st_name == "published" else "",
                        },
                    )
                self._send(404, {"detail": "nope"})

        fake_app = ThreadingHTTPServer(("127.0.0.1", 0), FakeNight)
        threading.Thread(target=fake_app.serve_forever, daemon=True).start()
        fapp = f"http://127.0.0.1:{fake_app.server_port}"
        said_n: list[str] = []
        try:
            rec = night.run_night(fapp, "a tiny robot doing laundry", prof, say=said_n.append, poll_s=0.01)
            tick(
                "run_night(): started the run in VibeStudio with idea, room, and platform_url",
                FakeNight.posted
                and FakeNight.posted[0]["idea"] == "a tiny robot doing laundry"
                and FakeNight.posted[0]["event_code"] == "sandbox"
                and FakeNight.posted[0]["platform_url"] == platform,
            )
            tick(
                "…followed it to the wall: done, with video_id and title",
                rec["status"] == "done" and rec["video_id"] == "v_night" and rec["title"] == "Midnight Spin Cycle" and rec["night"] == "app",
                json.dumps(rec)[:200],
            )
            tick(
                "…logged readers, gate auto-pick, Veo checks, render completion, and publish",
                any("· scan_trends" in l for l in said_n)
                and any("the first is taken for you" in l and "Midnight Spin Cycle" in l for l in said_n)
                and any("rendering · Veo · check" in l for l in said_n)
                and any("── rendered" in l for l in said_n)
                and any("on the wall" in l for l in said_n),
                "\n".join(said_n)[:600],
            )
            tick("…record points at the app's clip and app_url", rec["clip"] == f"{fapp}/static/renders/r.mp4" and json.loads(night.RECORD.read_text())["app_url"] == fapp)
        finally:
            fake_app.shutdown()

        # 8. CLI scripts/post.py --dry-run (both modes) against live VibeStudio + FakeVibeTube
        cli_env = {
            **os.environ,
            "STUDIO_VERTEX": "1",
            "STUDIO_VIDEO_DIR": str(tmp / "renders"),
            "VIBETUBE_URL": platform,
            "VIBETUBE_EVENT": "sandbox",
            "VIBETUBE_NAME": "CLI Tester",
            "VIBETUBE_PROJECT": "cli-project",
        }
        dry1 = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "post.py"), "--app", app, "--dry-run"],
            cwd=str(ROOT),
            env=cli_env,
            capture_output=True,
            text=True,
            timeout=20,
        )
        tick("scripts/post.py --dry-run (workbench clip) exits 0", dry1.returncode == 0 and "dry run: nothing sent" in dry1.stdout, dry1.stdout + dry1.stderr)

        dry2 = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "post.py"), "--app", app, "--night", "a robot folding socks", "--dry-run"],
            cwd=str(ROOT),
            env=cli_env,
            capture_output=True,
            text=True,
            timeout=20,
        )
        tick("scripts/post.py --night ... --dry-run exits 0", dry2.returncode == 0 and "dry run: nothing started" in dry2.stdout, dry2.stdout + dry2.stderr)

        # 9. profile() precedence: .env -> runs/post.json -> explicit overrides
        os.environ["VIBETUBE_EVENT"] = "fromenv"
        os.environ["VIBETUBE_NAME"] = "Env Name"
        os.environ["VIBETUBE_PROJECT"] = "env-project"
        night.RECORD.unlink(missing_ok=True)
        p = night.profile()
        tick("profile() reads .env", (p["event_code"], p["display_name"], p["project_id"]) == ("fromenv", "Env Name", "env-project"))
        night.RECORD.write_text(json.dumps({"event_code": "lastroom", "display_name": "Last Name"}))
        p = night.profile()
        tick("…the last post's room and name win over .env", (p["event_code"], p["display_name"]) == ("lastroom", "Last Name"))
        p = night.profile(event_code="  typed  ", display_name="")
        tick("…and explicit overrides win over both; blanks are ignored", (p["event_code"], p["display_name"]) == ("typed", "Last Name"))
        tick("the log output is readable", any(line.startswith("── handing the clip") for line in said) and any("on the wall" in line for line in said))
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print("\nPOST VERIFY: " + ("all video-publishing checks passed" if ok else "NOT OK - see the ✗ lines"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
