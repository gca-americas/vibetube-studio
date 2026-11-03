"""Post my video, end to end, through a VibeStudio of our own and against a
VibeTube of our own: the clip is handed to the app (POST /api/night/import);
publish is pressed there; the app makes the one request to the room; the
record, the room and the card read back what the fake received; and a whole
night run unattended (POST /api/night/auto) is followed from here to the
wall against an app that scripts its states. No network, no model, nothing
written under runs/ (the app runs from a copy in a temporary folder and the
module's paths point there too).

    python checks/verify_post.py
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from email.parser import BytesParser
from email.policy import default as email_default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("STUDIO_VERTEX", "1")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "verify-project")

from server.services import night  # noqa: E402

ok = True


def tick(name, cond, hint=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"   → {hint}"))
    ok = ok and bool(cond)


def mp4(n: int = 24_000) -> bytes:
    """Bytes that begin like an mp4; the app stores them and the room receives them, neither looks inside."""
    return b"\x00\x00\x00\x1cftypisom\x00\x00\x02\x00isomiso2mp41" + os.urandom(n)


class FakeVibeTube(BaseHTTPRequestHandler):
    """The three routes the lab uses: the room, its videos, and the upload."""
    received: list[dict] = []
    room_open = True

    def log_message(self, *a):            # quiet
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
            rows = [{"id": r["id"], "eventId": code, "title": r["title"], "status": "ready", "channelName": r["displayName"],
                     "projectId": r["projectId"], "thumbnailUrl": ""}
                    for r in self.received if r["event"] == code]
            return self._send(200, rows)
        if self.path.startswith("/api/events/"):
            code = self.path.split("/")[3]
            if code == "nowhere":
                return self._send(404, {"detail": "event not found"})
            return self._send(200, {"code": code, "name": code.title(), "uploadOpen": self.room_open,
                                    "uploadState": "open" if self.room_open else "closed",
                                    "reason": None if self.room_open else "The upload window for this showroom has closed."})
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
        msg = BytesParser(policy=email_default).parsebytes(b"Content-Type: " + self.headers.get("Content-Type", "").encode() + b"\r\n\r\n" + body)
        form = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True) for part in msg.iter_parts()}
        text = lambda k: (form.get(k) or b"").decode()  # noqa: E731
        rec = {"id": f"v_{len(self.received) + 1:04d}", "event": code,
               "title": text("title"), "description": text("description"), "duration": text("duration"),
               "displayName": text("displayName"), "projectId": text("projectId"),
               "video": form.get("videoFile") or b"", "thumb": form.get("thumbnailFile") or b""}
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
    """A VibeStudio of our own: the app copied to a temporary folder (so its
    runs/ is there, not the repo's), pointed at the fake VibeTube, no tracing,
    the two resource names given so nothing is looked up."""
    src = ROOT / "vibestudio"
    dst = tmp / "vibestudio"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "dist", "runs", "__pycache__", "*.pyc", ".env"))
    port = free_port()
    env = {**os.environ, "STUDIO_VERTEX": "1", "STUDIO_TRACING": "0", "STUDIO_REAL_VIDEO": "0",
           "GOOGLE_CLOUD_PROJECT": "verify-project", "STUDIO_GCP_PROJECT": "verify-project", "VIBETUBE_PROJECT": "verify-project",
           "STUDIO_MEMORY_BANK": "projects/verify-project/locations/us-central1/reasoningEngines/1",
           "STUDIO_RAG_CORPUS": "projects/verify-project/locations/us-central1/ragCorpora/1",
           "VIBETUBE_URL": platform, "VIBETUBE_EVENT": "sandbox", "VIBETUBE_NAME": "Verify Bot", "PORT": str(port),
           "PYTHONPATH": str(tmp)}
    for k in ("GOOGLE_API_KEY",):
        env.pop(k, None)
    log = (tmp / "app.log").open("w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "vibestudio.server.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                            cwd=str(tmp), env=env, stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            break
        try:
            get_json(f"{url}/api/state", timeout=2)
            return proc, url
        except Exception:
            time.sleep(0.5)
    proc.terminate()
    raise RuntimeError("the app did not come up: " + (tmp / "app.log").read_text()[-1500:])


def http(method: str, url: str, data: bytes | None = None, headers: dict | None = None) -> int:
    try:
        urllib.request.urlopen(urllib.request.Request(url, method=method, data=data, headers=headers or {}), timeout=10)
        return 200
    except urllib.error.HTTPError as e:
        return e.code


def main() -> int:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="vibe-post-"))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeVibeTube)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    platform = f"http://127.0.0.1:{srv.server_port}"
    # point the module at the sandbox folder, so nothing under runs/ is touched
    night.RENDERS = tmp / "renders"
    night.RECORD = tmp / "post.json"
    night.DEPLOY_RECORD = tmp / "deploy.json"
    night.RENDERS.mkdir(parents=True)
    clip = night.RENDERS / "verify-clip.mp4"
    clip.write_bytes(mp4())
    said: list[str] = []
    proc = None
    try:
        # the words: what the step-3 agent named the video
        tick("title_from_reply(): a 'Video:' heading", night.title_from_reply("### Video: The Polite Resident\n**Shot 1:** a drawer") == "The Polite Resident")
        tick("…a bold 'Title:' line", night.title_from_reply("Here it is.\n**Title:** Desk Toys After Dark\n**Shot 1:** …") == "Desk Toys After Dark")
        tick("…and nothing when the reply names none", night.title_from_reply("Sure! Let me check the trends first.") == "")

        # where the app is: the deploy record
        tick("studio(): nothing deployed yet", night.studio()["url"] == "" and night.studio()["status"] == "")
        night.DEPLOY_RECORD.write_text(json.dumps({"status": "deploying", "by": "setup", "started_at": time.time()}))
        tick("studio(): a deploying record with no lock holder is 'interrupted'", night.studio()["status"] == "interrupted")
        night.DEPLOY_RECORD.write_text(json.dumps({"status": "done", "by": "setup", "url": "https://vibestudio-x.run.app", "at": time.time()}))
        st = night.studio()
        tick("studio(): a done record names the app", st["url"] == "https://vibestudio-x.run.app" and st["status"] == "done" and st["by"] == "setup")
        tick("studio(): a URL given wins", night.studio("http://127.0.0.1:1/")["url"] == "http://127.0.0.1:1")
        tick("app_state(): no app there is None", night.app_state("http://127.0.0.1:9", timeout=2) is None)

        # the room
        r = night.room("sandbox", platform)
        tick("the room answers: open", r["open"] and r["name"] == "Sandbox")
        tick("a wrong code: no room, codes are case-sensitive", not night.room("nowhere", platform)["open"] and "case-sensitive" in night.room("nowhere", platform)["reason"])

        # a VibeStudio of our own
        proc, app = start_app(tmp, platform)
        tick(f"a VibeStudio of our own answers at {app}", night.app_state(app) is not None)
        tick("…and starts idle", (night.app_state(app) or {}).get("status") == "idle")

        # the hand-over
        out = night.hand_over(app, title="Verify night", description="a check", clip_path=str(clip), say=said.append)
        tick("hand_over(): the app took the night", out.get("ok") and out["run_id"].startswith("import_"), json.dumps(out)[:200])
        st = night.app_state(app) or {}
        tick("…its run is done, with the title", st.get("status") == "done" and st.get("script", {}).get("title") == "Verify night", json.dumps(st)[:300])
        tick("…the render is on its disk and served", st.get("render", {}).get("status") == "done" and st["render"].get("imported") is True
             and urllib.request.urlopen(app + st["render"]["url"], timeout=10).read() == clip.read_bytes())
        tick("…and it is in the app's history", any(i.get("title") == "Verify night" for i in get_json(f"{app}/api/history")["items"]))

        # the publish, pressed in the app; the app makes the request
        prof = night.profile(platform_url=platform, event_code="sandbox", display_name="Verify Bot")
        prof["project_id"] = "verify-project"
        rec = night.press_publish(app, prof, title="Verify night", clip_path=str(clip), say=said.append)
        tick("press_publish(): done with a video id", rec["status"] == "done" and rec["video_id"] == "v_0001", json.dumps(rec)[:200])
        tick("the record is on disk and names the app", json.loads(night.RECORD.read_text())["app_url"] == app)
        got = FakeVibeTube.received[-1]
        tick("the fake received the clip's bytes, from the app", got["video"] == clip.read_bytes())
        tick("…title, duration 0:08, displayName, projectId", (got["title"], got["duration"], got["displayName"], got["projectId"]) == ("Verify night", "0:08", "Verify Bot", "verify-project"), str({k: got[k] for k in ("title", "duration", "displayName", "projectId")}))
        st = night.app_state(app) or {}
        tick("the app's own publish record says done", (st.get("publish") or {}).get("status") == "done" and str(st["publish"].get("video_id")) == "v_0001")
        tick("the watch URL names the room and the id", rec["url"] == f"{platform}/e/sandbox?v=v_0001")

        # reading it back: the card
        v = night.video("sandbox", "v_0001", platform)
        tick("video() finds the card", bool(v) and v["status"] == "ready" and v["channel"] == "Verify Bot")
        now = night.status_for(night.record())
        tick("status_for(): the room now and the card, from the record", (now["room"] or {}).get("open") is True and (now["video"] or {}).get("id") == "v_0001")

        # a second night replaces the first; one video per project and room
        clip2 = night.RENDERS / "verify-clip-2.mp4"
        clip2.write_bytes(mp4(30_000))
        night.hand_over(app, title="Second night", description="", clip_path=str(clip2), duration_ms=12_000, say=said.append)
        st = night.app_state(app) or {}
        tick("a second hand-over replaces the night, with its duration", st.get("script", {}).get("title") == "Second night" and st["render"].get("duration_ms") == 12_000)
        rec = night.press_publish(app, prof, title="Second night", clip_path=str(clip2), say=said.append)
        tick("…and posting again replaced the video on the wall", rec["status"] == "done" and len([r for r in FakeVibeTube.received if r["event"] == "sandbox"]) == 1
             and FakeVibeTube.received[-1]["video"] == clip2.read_bytes() and FakeVibeTube.received[-1]["duration"] == "0:12")

        # what the app refuses
        tick("an import without a clip is refused (422)", http("POST", f"{app}/api/night/import", b"", {"Content-Type": "multipart/form-data; boundary=x"}) == 422)
        tick("an unknown unattended night is 404", http("GET", f"{app}/api/night/auto/run_nope") == 404)

        # a closed room: the app's three attempts fail, the record says why
        FakeVibeTube.room_open = False
        rec = night.press_publish(app, prof, title="x", clip_path=str(clip), say=said.append)
        tick("a closed room: failed, with the platform's reason", rec["status"] == "failed" and "403" in rec["detail"], rec["detail"])
        FakeVibeTube.room_open = True
        prof2 = dict(prof, event_code="nowhere")
        rec = night.press_publish(app, prof2, title="x", clip_path=str(clip), say=said.append)
        tick("a wrong code: 404, and the hint to check it", rec["status"] == "failed" and "check the event code" in rec["detail"], rec["detail"])

        # the whole night, unattended, followed from here: a fake app scripts the states
        class FakeNight(BaseHTTPRequestHandler):
            steps = [
                {"status": "running", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback"], "active": "join_research", "candidates": [], "render": {}, "publish": {}, "script": {}},
                {"status": "waiting_pick", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions"], "active": None,
                 "candidates": [{"title": "The Polite Resident"}, {"title": "B"}, {"title": "C"}, {"title": "D"}], "render": {}, "publish": {}, "script": {}},
                {"status": "running", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter"], "active": "render_desk",
                 "candidates": [{"title": "The Polite Resident"}], "route": "OK", "script": {"title": "The Polite Resident"}, "render": {}, "publish": {}},
                {"status": "rendering", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter", "render_desk"], "active": None,
                 "candidates": [{"title": "The Polite Resident"}], "script": {"title": "The Polite Resident"}, "render": {"status": "pending", "checks": 2}, "publish": {}},
                {"status": "done", "run_id": "run_7", "nodes_seen": ["scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", "scripter", "render_desk", "store_video"], "active": None,
                 "candidates": [{"title": "The Polite Resident"}], "script": {"title": "The Polite Resident"}, "render": {"status": "done", "url": "/static/renders/r.mp4", "checks": 3}, "publish": {"status": "publishing", "attempts": 1}},
                {"status": "done", "run_id": "run_7", "nodes_seen": [], "active": None, "candidates": [], "script": {"title": "The Polite Resident"}, "render": {"status": "done", "url": "/static/renders/r.mp4"},
                 "publish": {"status": "done", "video_id": "v_night", "url": f"{platform}/e/sandbox?v=v_night", "attempts": 1}},
            ]
            stages = ["running", "running", "picked", "picked", "publishing", "published"]
            n = 0
            posted: list[dict] = []

            def log_message(self, *a):
                pass

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

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
                    st = FakeNight.stages[i]
                    return self._send(200, {"run_id": "run_7", "stage": st, "picked": "The Polite Resident" if i >= 2 else "", "video_id": "v_night" if st == "published" else "", "url": f"{platform}/e/sandbox?v=v_night" if st == "published" else ""})
                self._send(404, {"detail": "nope"})
        fake_app = ThreadingHTTPServer(("127.0.0.1", 0), FakeNight)
        threading.Thread(target=fake_app.serve_forever, daemon=True).start()
        fapp = f"http://127.0.0.1:{fake_app.server_port}"
        said_n: list[str] = []
        try:
            rec = night.run_night(fapp, "a desk plant that reviews snacks", prof, say=said_n.append, poll_s=0.01)
            tick("run_night(): started the night in the app with the idea and the room", FakeNight.posted and FakeNight.posted[0]["idea"] == "a desk plant that reviews snacks" and FakeNight.posted[0]["event_code"] == "sandbox")
            tick("…followed it to the wall: done, with the video id and the title", rec["status"] == "done" and rec["video_id"] == "v_night" and rec["title"] == "The Polite Resident" and rec["night"] == "app", json.dumps(rec)[:200])
            tick("…and said the steps: the readers, the gate taken for you, the render, the release, the publish",
                 any("· scan_trends" in l for l in said_n) and any("the first is taken for you" in l and "The Polite Resident" in l for l in said_n)
                 and any("rendering · Veo · check" in l for l in said_n) and any("── released" in l for l in said_n) and any("on the wall" in l for l in said_n), "\n".join(said_n)[:600])
            tick("…the record points at the app's clip", rec["clip"] == f"{fapp}/static/renders/r.mp4")
            tick("the whole-night record names the app", json.loads(night.RECORD.read_text())["app_url"] == fapp)
        finally:
            fake_app.shutdown()
        # an app from before this change has no /api/night/auto: the script says to deploy again
        class Old(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                self.send_response(404); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")
        old = ThreadingHTTPServer(("127.0.0.1", 0), Old)
        threading.Thread(target=old.serve_forever, daemon=True).start()
        try:
            night.run_night(f"http://127.0.0.1:{old.server_port}", "x", prof, say=said_n.append, poll_s=0.01)
            msg = ""
        except RuntimeError as e:
            msg = str(e)
        finally:
            old.shutdown()
        tick("an app deployed before this change: 'deploy again'", "deploy again" in msg, msg)

        # the profile: .env, then the last post, then what was typed
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
        tick("…and what was typed wins over both; blanks are ignored", (p["event_code"], p["display_name"]) == ("typed", "Last Name"))
        tick("the script's own output is readable", any(line.startswith("── handing the night") for line in said) and any("on the wall" in line for line in said))
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print("\nPOST VERIFY: " + ("the night goes through the app, the app posts it as step 9 teaches, and it reads back" if ok else "NOT OK - see the ✗ lines"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
