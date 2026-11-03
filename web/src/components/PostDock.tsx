import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Play, RefreshCw, Rocket, Send, X } from "lucide-react";
import { api, useRunEvents } from "../lib/api";
import type { PostStatus } from "../lib/types";
import { COLORS, tint } from "../steps/colors";
import { CheckRow } from "../steps/FanOut";

/*
 * Post my video: the button on every page, and the drawer behind it.
 *
 * The lab's last step publishes from VibeStudio on Cloud Run (step 9), and
 * setup now deploys that app in the background, so it is live from step 1 or
 * 2. The wall does not have to wait for step 9: from step 3 the deployed app
 * can run a whole night from one idea - the readers, the pick, the policy,
 * the script, the Veo render - and publish it; from step 8 the clip the
 * delivery brought back can go out as it is. VibeTube keeps one video per
 * project and room, so each post REPLACES the last. The drawer shows where
 * the studio stands (being built · live · failed), takes an idea, the room
 * and your name, and runs `scripts/post.py` on the lab server: the night
 * happens in the deployed app, and publish is pressed THERE - the app makes
 * the request to the room, as step 9 teaches. The rows under it read the app
 * and VibeTube back.
 *
 * One status for the whole page: the provider polls lightly (the newest
 * clip comes from runs/, the title and the idea from the session store),
 * goes live (the app, the room, the card) when the drawer is open, and
 * follows a post as it goes out.
 */

const GREEN = COLORS.green;
const AMBER = COLORS.amber;
const CYAN = COLORS.cyan;
const RED = COLORS.red;

type Dock = {
  status: PostStatus | null;
  open: boolean;
  setOpen: (o: boolean) => void;
  refresh: (live?: boolean, code?: string) => Promise<void>;
  checking: boolean;
};

const DockContext = createContext<Dock | null>(null);

export function usePostDock(): Dock {
  const d = useContext(DockContext);
  if (!d) throw new Error("usePostDock outside PostDockProvider");
  return d;
}

export function PostDockProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PostStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const lastLight = useRef(0);
  const refresh = useCallback(async (live = true, code?: string) => {
    setChecking(true);
    try {
      const next = await api.postStatus({ live, code });
      // a light read knows nothing of the room, the card, or whether the app
      // answers; it must not blank out what the last live read found
      setStatus((prev) =>
        live || !prev
          ? next
          : {
              ...next,
              room: prev.room,
              video: prev.video,
              studio: next.studio.url === prev.studio.url ? { ...prev.studio, ...next.studio, reachable: prev.studio.reachable } : next.studio,
            },
      );
    } catch {
      /* the server is away; the button goes quiet */
    } finally {
      setChecking(false);
    }
  }, []);
  // the first read, and a light one whenever the run files change (a clip
  // is delivered, a deploy ends, a post lands), at most every eight seconds
  const { snapshot } = useRunEvents();
  useEffect(() => {
    refresh(false);
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const now = Date.now();
    if (now - lastLight.current < 8000) return;
    lastLight.current = now;
    refresh(false);                      // live reads (the app, the room, the card) are the drawer's own, below
  }, [snapshot, refresh]);
  const value = useMemo(() => ({ status, open, setOpen, refresh, checking }), [status, open, refresh, checking]);
  return (
    <DockContext.Provider value={value}>
      {children}
      <PostDrawer />
    </DockContext.Provider>
  );
}

/** What the button and the drawer agree on: is there anything to post, and how did the last post go. */
function summarize(st: PostStatus | null) {
  const clip = st?.night.clip ?? null;
  const last = st?.last ?? {};
  const done = last.status === "done" && !!last.video_id;
  const posting = !!st?.posting || last.status === "posting";
  const stale = done && !!clip && (clip.at ?? 0) > (last.done_at ?? last.at ?? 0);
  const studio = st?.studio ?? null;
  const live = !!studio?.url && !studio.deploying && studio.status !== "failed" && studio.reachable !== false;
  return { clip, done, posting, stale, last, studio, live };
}

function mins(ts?: number | null): string {
  if (!ts) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 1 ? "under a minute" : `${m} min`;
}

/** The button in the top bar. Its dot says where things stand. */
export function PostButton() {
  const { status, setOpen, open } = usePostDock();
  const s = summarize(status);
  const building = !!s.studio?.deploying && !s.studio?.url;
  const failed = s.studio?.status === "failed" || s.studio?.status === "interrupted";
  const color = s.posting ? CYAN : s.done && !s.stale ? GREEN : building ? AMBER : failed ? RED : s.live ? CYAN : "var(--fg-muted)";
  const label = s.posting ? "Posting…" : s.done && !s.stale ? "On the wall" : building ? "Studio building…" : s.stale ? "Post again" : "Post my video";
  const title = building
    ? `VibeStudio is being deployed to Cloud Run in the background (${mins(s.studio?.started_at)} so far); the button wakes when it is live`
    : failed
      ? "The deploy failed; open to see why and deploy again"
      : s.done && !s.stale
        ? `Posted through VibeStudio: ${s.last.title || ""} · ${s.last.url || ""}`
        : s.clip
          ? "A clip is ready: VibeStudio posts it, or runs a whole night from an idea"
          : s.live
            ? "Give VibeStudio an idea: it runs the whole night and posts the video"
            : "VibeStudio on Cloud Run posts your video; setup deploys it in the background";
  return (
    <button
      onClick={() => setOpen(!open)}
      title={title}
      aria-expanded={open}
      className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors hover:bg-overlay"
      style={{ borderColor: tint(color, 0.5), color, background: tint(color, 0.08) }}
    >
      <span className={`h-2 w-2 rounded-full ${s.posting || building ? "animate-pulse" : ""}`} style={{ background: color }} />
      {s.done && !s.stale ? <Check size={12} /> : building ? <Rocket size={12} /> : <Send size={12} />}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** A small call to action for the step pages: shown next to a reply or a clip. */
export function PostCta({ children = "Post it to the wall", color = AMBER }: { children?: ReactNode; color?: string }) {
  const { setOpen } = usePostDock();
  return (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-semibold transition-transform hover:scale-[1.03]"
      style={{ borderColor: tint(color, 0.5), color, background: tint(color, 0.08) }}
    >
      <Send size={12} /> {children} →
    </button>
  );
}

function Field({ label, value, onChange, placeholder, mono = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-hairline bg-input px-3 py-2 text-sm text-fg outline-none focus:border-vibe-cyan/60 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function ago(ts?: number | null): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 90 ? `${s}s ago` : s < 7200 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

function PostDrawer() {
  const { status, open, setOpen, refresh, checking } = usePostDock();
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [ideaSeeded, setIdeaSeeded] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const s = summarize(status);

  // the output of scripts/post.py, as it goes
  useRunEvents((verb, line) => {
    if (verb === "post") setLines((l) => [...l.slice(-59), line]);
  });

  // opening: a live read, and the fields seeded once from the server's defaults
  useEffect(() => {
    if (!open) return;
    refresh(true, code || undefined);
    api.workerLog("post").then((r) => setLines(r.lines.slice(-60))).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!status || seeded) return;
    setCode(status.profile.event_code);
    setName(status.profile.display_name);
    setSeeded(true);
  }, [status, seeded]);
  useEffect(() => {
    // a title the student has not touched follows the newest run
    if (status && !title) setTitle(status.night.title);
    // the idea box starts with what the step-3 agent was told, once
    if (status && !ideaSeeded && status.night.idea) {
      setIdea(status.night.idea);
      setIdeaSeeded(true);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);
  // while a post goes out, follow it; while VibeTube processes, look again
  const processing = status?.video?.status === "processing" || (s.done && !status?.video);
  useEffect(() => {
    if (!open || !(s.posting || processing)) return;
    const t = setInterval(() => refresh(true, code || undefined), s.posting ? 3000 : 10000);
    return () => clearInterval(t);
  }, [open, s.posting, processing, code, refresh]);

  const [deployLines, setDeployLines] = useState<string[]>([]);
  useRunEvents((verb, line) => {
    if (verb === "deploy") setDeployLines((l) => [...l.slice(-7), line]);
  });
  const deployAgain = async () => {
    setNote("");
    try {
      const r = await api.deployRun();
      setNote(r.ok ? "deploying again; step 9 shows the whole output" : r.detail);
      setTimeout(() => refresh(true, code || undefined), 2000);
    } catch (e) {
      setNote(`could not reach the learning center: ${(e as Error).message}`);
    }
  };
  // while the studio is being built, look again every twenty seconds
  const building = !!s.studio?.deploying && !s.studio?.url;
  useEffect(() => {
    if (!open || !building) return;
    const t = setInterval(() => refresh(true, code || undefined), 20000);
    return () => clearInterval(t);
  }, [open, building, code, refresh]);

  const post = async (wholeNight: boolean) => {
    setBusy(true);
    setNote("");
    setLines([]);
    try {
      const r = await api.postRun(
        wholeNight
          ? { night: idea.trim(), event_code: code.trim(), display_name: name.trim() }
          : { title: title.trim(), event_code: code.trim(), display_name: name.trim() },
      );
      setNote(r.ok ? "" : r.detail);
      if (r.ok) setTimeout(() => refresh(true, code || undefined), 1500);
    } catch (e) {
      setNote(`could not reach the learning center: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const night = status?.night;
  const room = status?.room ?? null;
  const video = status?.video ?? null;
  const last = status?.last ?? {};
  const studio = s.studio;
  const studioFailed = studio?.status === "failed" || studio?.status === "interrupted";
  const canRunNight = s.live && !!code.trim() && !s.posting && !busy;
  const nightRunning = s.posting && last.night === "app";
  const progress = !studio
    ? ""
    : studio.run_status === "waiting_pick"
      ? "the gate: taking the first direction for you"
      : studio.run_status === "rendering"
        ? `rendering with Veo · check ${studio.render_checks || 0}`
        : studio.run_status === "running"
          ? `running · ${studio.active || (studio.nodes_seen || []).slice(-1)[0] || "the readers"}`
          : studio.run_status === "done"
            ? studio.publish?.status === "publishing"
              ? "released · publishing"
              : studio.publish?.status === "done"
                ? `on the wall · ${studio.publish.video_id || ""}`
                : "released"
            : studio.run_status === "failed"
              ? "the run failed"
              : "";
  const canPost = !!s.clip && !!code.trim() && !s.posting && !busy && s.live;
  const why = s.posting
    ? "going out…"
    : !s.clip
      ? night?.real_video === false ? "no clip: the stand-in render leaves no file" : "no clip yet: step 8 delivers the first"
      : !code.trim()
        ? "type the room's code"
        : building
          ? "waiting for the studio"
          : !s.live
            ? "no studio to post through"
            : s.done && !s.stale
              ? `on the wall · ${last.video_id}`
              : s.stale
                ? "newer than the last post"
                : "ready";
  const accent = s.done && !s.stale ? GREEN : building ? AMBER : studioFailed ? RED : s.live ? CYAN : AMBER;
  const studioLine = !studio
    ? "…"
    : building
      ? `being built on Cloud Run since ${studio.by === "setup" ? "setup" : "step 9"} · ${mins(studio.started_at)} so far · Cloud Build takes four or five minutes`
      : studioFailed
        ? `the deploy ${studio.status === "interrupted" ? "was interrupted" : "failed"}${studio.detail ? ` · ${studio.detail}` : ""}`
        : studio.url
          ? studio.reachable === false
            ? `${studio.url} · not answering right now`
            : `${studio.url}${studio.by ? ` · deployed by ${studio.by}` : ""}${studio.at ? `, ${mins(studio.at)} ago` : ""}${studio.deploying ? " · a new revision is being built" : ""}`
          : "not deployed yet: ./setup_codelab.sh starts it in the background, or Deploy on step 9";

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <motion.aside
            key="drawer"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-label="Post my video"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[480px] flex-col border-l border-hairline bg-stage text-fg shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: accent }}>
                  Post my video
                </p>
                <h2 className="font-display mt-1 text-2xl">One idea in, the card on the wall out.</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  Setup deployed VibeStudio while you read. Give it tonight's idea and it runs the whole night - the readers, the pick, the policy, the script, the render - and publishes, the way you will do it by hand in step 9. Posting again replaces your video on the wall.
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 text-fg-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* the studio: where the night goes */}
              <section className="rounded-2xl border p-4" style={{ borderColor: tint(building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)", 0.4), background: tint(building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)", 0.04) }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">The studio · VibeStudio on Cloud Run</p>
                    <p className="mt-1 break-all text-xs" style={{ color: building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)" }}>
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${building ? "animate-pulse" : ""}`} style={{ background: building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)" }} />
                      {studioLine}
                    </p>
                  </div>
                  {studio?.url && s.live ? (
                    <a href={studio.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-fg-muted underline decoration-hairline underline-offset-4 hover:text-fg">
                      open <ExternalLink size={11} />
                    </a>
                  ) : studioFailed || (!studio?.url && !building) ? (
                    <button onClick={deployAgain} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px]" style={{ borderColor: tint(GREEN, 0.5), color: GREEN }}>
                      <Rocket size={12} /> Deploy now
                    </button>
                  ) : null}
                </div>
                {building && deployLines.length > 0 ? (
                  <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded-lg border border-hairline bg-input px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg-muted">{deployLines.join("\n")}</pre>
                ) : null}
              </section>

              {/* tonight's idea: the whole night, in the app */}
              <section className="rounded-2xl border p-4" style={{ borderColor: tint(s.live ? GREEN : "var(--fg-muted)", 0.4), background: tint(s.live ? GREEN : "var(--fg-muted)", 0.04) }}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Tonight's idea</p>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={2}
                  placeholder="a desk plant that reviews the snacks left next to it, deadpan"
                  className="mt-2 w-full resize-none rounded-lg border border-hairline bg-input px-3 py-2 text-sm text-fg outline-none focus:border-vibe-cyan/60"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => post(true)}
                    disabled={!canRunNight}
                    title="The app runs the whole night from this idea - the readers, the pick (the first direction), the policy, the script, the Veo render - and publishes it"
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
                    style={{ background: GREEN }}
                  >
                    {nightRunning ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
                    {nightRunning ? "Running the night…" : "Run the night & post"}
                  </button>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {nightRunning ? progress || "starting…" : !s.live ? (building ? "waiting for the studio" : "no studio to run it in") : !code.trim() ? "type the room's code" : "three to five minutes · the gate takes the first direction · real credit for the render"}
                  </span>
                </div>
                {!nightRunning && night?.idea && idea === night.idea ? (
                  <p className="mt-2 font-mono text-[10px] text-fg-muted">the idea you gave the step-3 agent; change it as you like</p>
                ) : null}
              </section>

              {/* the clip you made in step 8: the other way onto the wall */}
              <details className="rounded-2xl border border-hairline bg-card">
                <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted [&::-webkit-details-marker]:hidden">
                  Or post the clip you rendered in step 8 ▸ {s.clip ? "a clip is ready" : "nothing yet"}
                </summary>
                <section className="border-t border-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">What goes on the wall</p>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">the video · clip</dt>
                      <dd className="mt-0.5 text-fg-muted">
                        {s.clip ? (
                          <>
                            the render · delivered {ago(s.clip.at)} · <span className="text-fg">{s.clip.source}</span>
                          </>
                        ) : night?.real_video === false ? (
                          <span style={{ color: AMBER }}>STUDIO_REAL_VIDEO=0: the stand-in render leaves no file to post. The whole night above runs Veo for real in the app.</span>
                        ) : (
                          "Step 8 delivers the first one; until then, the whole night above."
                        )}
                      </dd>
                    </div>
                    {s.clip ? <video src={s.clip.url} controls playsInline className="mt-1 max-h-40 w-full rounded-lg bg-black" /> : null}
                  </dl>
                  <div className="mt-3">
                    <Field label={night?.words_source && night.words_source !== "default" ? `title · from ${night.words_source}` : "title"} value={title} onChange={setTitle} placeholder="Tonight's title" mono={false} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => post(false)}
                      disabled={!canPost}
                      className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
                      style={{ background: accent }}
                    >
                      {s.posting && !nightRunning ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
                      {s.posting && !nightRunning ? "Posting…" : s.done ? "Post the clip again" : "Post the clip"}
                    </button>
                    <span className="font-mono text-[11px] text-fg-muted">{why}</span>
                  </div>
                </section>
              </details>

              {/* the room, the name, and how the last post went */}
              <section className="rounded-2xl border p-4" style={{ borderColor: tint(accent, 0.4), background: tint(accent, 0.04) }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="room · event code, case-sensitive" value={code} onChange={setCode} placeholder="sandbox" />
                  <Field label="your name on the card" value={name} onChange={setName} placeholder="Vibe Studio creator" mono={false} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={() => refresh(true, code || undefined)} disabled={checking} className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2 font-mono text-xs text-fg-muted hover:text-fg disabled:opacity-50">
                    <RefreshCw size={13} className={checking ? "animate-spin" : ""} /> Check again
                  </button>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {s.posting ? (last.night === "app" ? progress || "starting the night…" : "going out…") : s.done && !s.stale ? `on the wall · ${last.video_id}` : last.status === "failed" ? "the last post failed" : ""}
                  </span>
                </div>
                {note ? <p className="mt-2 font-mono text-xs" style={{ color: RED }}>{note}</p> : null}
                {last.status === "failed" && last.detail ? (
                  <p className="mt-2 font-mono text-xs" style={{ color: RED }}>
                    not posted · {last.detail}
                  </p>
                ) : null}
                {lines.length > 0 ? (
                  <pre ref={logRef} className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-input px-3 py-2 font-mono text-[10.5px] leading-relaxed text-fg">{lines.join("\n")}</pre>
                ) : null}
              </section>

              {/* the rows */}
              <section>
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Read back from the app and from VibeTube</p>
                <ul className="mt-2 grid gap-2">
                  <CheckRow ok={s.live} label="VibeStudio answers">
                    {studio?.url ? (studio.reachable === false ? `${studio.url} · no answer` : studio.reachable ? `${studio.url}${studio.run_status ? ` · its run is ${studio.run_status}` : ""}` : studio.url) : building ? "Being deployed; a few minutes." : "No URL yet."}
                  </CheckRow>
                  <CheckRow ok={s.live || !!s.clip} label="something to post">
                    {s.clip ? "a clip from step 8, or a whole night from an idea" : s.live ? "a whole night from an idea; step 8 adds a clip of your own" : "Nothing until the studio is live."}
                  </CheckRow>
                  <CheckRow ok={!!room && room.open} label="the event code names an open room">
                    {room ? (room.open ? `${room.code} · ${room.name} · uploads open` : `${room.code} · ${room.name || "no such room"} · ${room.reason || room.state}`) : "Type an event code and check."}
                  </CheckRow>
                  <CheckRow ok={s.done} label="the app posted it: VibeTube returned a video id">
                    {s.done ? `${last.video_id} · ${ago(last.done_at ?? last.at)} · through ${last.app_url || studio?.url || "the app"}` : last.status ? `${last.status}${last.detail ? ` · ${last.detail}` : ""}` : "Press post."}
                  </CheckRow>
                  <CheckRow ok={!!video && video.status === "ready"} label="the video is on the wall" tone={video?.status === "processing" ? "warn" : "good"}>
                    {video ? `${video.status} · “${video.title}” by ${video.channel}` : s.done ? "Not listed yet; VibeTube is processing it (a minute or three)." : "After the post."}
                  </CheckRow>
                </ul>
                {s.done && last.url ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a href={last.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-bold text-white" style={{ background: GREEN }}>
                      Watch it on VibeTube <ExternalLink size={12} />
                    </a>
                    {video?.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-16 rounded-md border border-hairline object-cover" /> : null}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="border-t border-hairline px-6 py-3 font-mono text-[10.5px] text-fg-muted">
              the same from a terminal: <span className="text-fg">uv run python scripts/post.py --night "an idea"</span> · the app on Cloud Run makes the request; step 9 reads how
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
