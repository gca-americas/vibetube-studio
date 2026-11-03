import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clapperboard, ExternalLink, Play, RefreshCw, Rocket, Send, X } from "lucide-react";
import { api, useRunEvents } from "../lib/api";
import type { PostStatus } from "../lib/types";
import { COLORS, tint } from "../steps/colors";

/*
 * Post my video: the button on every page, and the slide-over sidebar behind it.
 *
 * Step 9 deploys VibeStudio to Cloud Run, and setup_codelab.sh starts that
 * deploy in the background during setup, so the app is live from the opening
 * steps. From any step, the creator can either:
 *   1. Give VibeStudio an idea and let it run the full workflow unattended
 *      (research -> direction pick -> policy gate -> script -> Veo render) and
 *      publish directly to VibeTube; or
 *   2. Hand VibeStudio a clip rendered in step 8 (or rendered on the spot by
 *      Veo from a step 3-7 script) and press publish there.
 *
 * VibeTube keeps one video per project and room, so posting again replaces the
 * previous upload. The rows at the bottom read both VibeStudio and VibeTube back.
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
      setStatus(await api.postStatus({ live, code }));
    } catch {
      /* the server is away; the button goes quiet */
    } finally {
      setChecking(false);
    }
  }, []);
  // Initial light read, plus a throttled light read whenever watched files under runs/ change
  const { snapshot } = useRunEvents();
  useEffect(() => {
    refresh(false);
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    const now = Date.now();
    if (now - lastLight.current < 8000) return;
    lastLight.current = now;
    refresh(false);
  }, [snapshot, refresh]);
  const value = useMemo(() => ({ status, open, setOpen, refresh, checking }), [status, open, refresh, checking]);
  return (
    <DockContext.Provider value={value}>
      {children}
      <PostDrawer />
    </DockContext.Provider>
  );
}

function summarize(st: PostStatus | null) {
  const clip = st?.night.clip ?? null;
  const hasWords = !!(st?.night.title || (st?.night.shots && st.night.shots.length > 0));
  const canRender = !clip && !!st?.night.real_video && hasWords;
  const last = st?.last ?? {};
  const done = last.status === "done" && !!last.video_id;
  const posting = !!st?.posting || last.status === "posting";
  const have: "clip" | "words" | "nothing" = clip ? "clip" : canRender ? "words" : "nothing";
  const stale = done && !!(clip && (clip.at ?? 0) > (last.done_at ?? last.at ?? 0));
  const studio = st?.studio ?? null;
  const live = !!studio?.url && !studio.deploying && studio.status !== "failed" && studio.reachable !== false;
  return { clip, canRender, done, posting, have, stale, last, studio, live };
}

function mins(ts?: number | null): string {
  if (!ts) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  return m < 1 ? "under a minute" : `${m} min`;
}

/** The button in the top bar. Its indicator dot reflects deploy & publish state. */
export function PostButton() {
  const { status, setOpen, open } = usePostDock();
  const s = summarize(status);
  const building = !!s.studio?.deploying && !s.studio?.url;
  const failed = s.studio?.status === "failed" || s.studio?.status === "interrupted";
  const color = s.posting
    ? CYAN
    : s.done && !s.stale
      ? GREEN
      : building
        ? AMBER
        : failed
          ? RED
          : s.have === "clip"
            ? CYAN
            : s.live
              ? GREEN
              : "var(--fg-muted)";
  const label = s.posting
    ? "Posting…"
    : s.done && !s.stale
      ? "On the wall"
      : building
        ? "Studio building…"
        : s.stale
          ? "Post again"
          : "Post my video";
  const title = building
    ? `VibeStudio is being deployed to Cloud Run in the background (${mins(s.studio?.started_at)} so far); ready once live`
    : failed
      ? "The deploy failed; open to see why and deploy again"
      : s.done && !s.stale
        ? `Posted through VibeStudio: ${s.last.title || ""} · ${s.last.url || ""}`
        : s.have === "clip"
          ? "A rendered clip is ready to post through VibeStudio"
          : s.live
            ? "VibeStudio is live on Cloud Run: run an idea end-to-end and publish to VibeTube"
            : "Open to check VibeStudio deployment status or publish a video";
  return (
    <button
      onClick={() => setOpen(!open)}
      title={title}
      aria-expanded={open}
      className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors hover:bg-overlay"
      style={{
        borderColor: tint(color, 0.5),
        color: !s.live && s.have === "nothing" && !s.done && !building && !failed ? "var(--fg-muted)" : color,
        background: tint(color, 0.08),
      }}
    >
      <span className={`h-2 w-2 rounded-full ${s.posting || building ? "animate-pulse" : ""}`} style={{ background: color }} />
      {s.done && !s.stale ? <Check size={12} /> : building ? <Rocket size={12} /> : <Send size={12} />}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** Call-to-action button for step pages (Step 8 video card, Step 10 summary). */
export function PostCta({ children = "Post it to VibeTube", color = AMBER }: { children?: ReactNode; color?: string }) {
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
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

function CheckRow({
  ok,
  label,
  tone = "good",
  children,
}: {
  ok: boolean;
  label: string;
  tone?: "good" | "warn";
  children: ReactNode;
}) {
  const color = ok ? (tone === "warn" ? AMBER : GREEN) : tone === "warn" ? AMBER : "var(--fg-muted)";
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-hairline bg-overlay p-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: color, color, background: ok || tone === "warn" ? tint(color, 0.1) : "transparent" }}
      >
        {ok ? <Check size={13} /> : <X size={12} className="opacity-40" />}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="break-words text-xs text-fg-muted">{children}</div>
      </div>
    </li>
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

  useRunEvents((verb, line) => {
    if (verb === "post") setLines((l) => [...l.slice(-59), line]);
  });

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
    if (status && !title) setTitle(status.night.title);
    if (status && !ideaSeeded && status.night.idea) {
      setIdea(status.night.idea);
      setIdeaSeeded(true);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

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
      setNote(r.ok ? "deploying again; step 9 shows the full output" : r.detail);
      setTimeout(() => refresh(true, code || undefined), 2000);
    } catch (e) {
      setNote(`could not reach the lab server: ${(e as Error).message}`);
    }
  };

  const building = !!s.studio?.deploying && !s.studio?.url;
  useEffect(() => {
    if (!open || !building) return;
    const t = setInterval(() => refresh(true, code || undefined), 20000);
    return () => clearInterval(t);
  }, [open, building, code, refresh]);

  const post = async (wholeNight = false) => {
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
      setNote(`could not reach the lab server: ${(e as Error).message}`);
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
  const renderFirst = !s.clip && s.canRender;
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
              ? "rendered · publishing"
              : studio.publish?.status === "done"
                ? `on the wall · ${studio.publish.video_id || ""}`
                : "rendered"
            : studio.run_status === "failed"
              ? "the run failed"
              : "";

  const canPost = !!(s.clip || s.canRender) && !!code.trim() && !s.posting && !busy && s.live;
  const why = s.posting
    ? "going out…"
    : s.have === "nothing"
      ? "render a clip in step 8 (or use Run workflow & post above)"
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

  const accent = s.done && !s.stale ? GREEN : building ? AMBER : studioFailed ? RED : s.have === "clip" ? CYAN : GREEN;
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
          <motion.div
            key="veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
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
                  Setup deployed VibeStudio in the background while you read. Give it an idea and it runs the full workflow — research, direction pick, policy gate, script, Veo render — and publishes to VibeTube, the way step 9 deploys it. Posting again replaces your video on the wall.
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 text-fg-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* the studio: where the workflow / publish runs */}
              <section
                className="rounded-2xl border p-4"
                style={{
                  borderColor: tint(building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)", 0.4),
                  background: tint(building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)", 0.04),
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">The studio · VibeStudio on Cloud Run</p>
                    <p className="mt-1 break-all text-xs" style={{ color: building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)" }}>
                      <span
                        className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${building ? "animate-pulse" : ""}`}
                        style={{ background: building ? AMBER : studioFailed ? RED : s.live ? GREEN : "var(--fg-muted)" }}
                      />
                      {studioLine}
                    </p>
                  </div>
                  {studio?.url && s.live ? (
                    <a
                      href={studio.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-fg-muted underline decoration-hairline underline-offset-4 hover:text-fg"
                    >
                      open <ExternalLink size={11} />
                    </a>
                  ) : studioFailed || (!studio?.url && !building) ? (
                    <button
                      onClick={deployAgain}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px]"
                      style={{ borderColor: tint(GREEN, 0.5), color: GREEN }}
                    >
                      <Rocket size={12} /> Deploy now
                    </button>
                  ) : null}
                </div>
                {building && deployLines.length > 0 ? (
                  <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap rounded-lg border border-hairline bg-input px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg-muted">
                    {deployLines.join("\n")}
                  </pre>
                ) : null}
              </section>

              {/* tonight's idea: run the full workflow in VibeStudio and publish */}
              <section
                className="rounded-2xl border p-4"
                style={{ borderColor: tint(s.live ? GREEN : "var(--fg-muted)", 0.4), background: tint(s.live ? GREEN : "var(--fg-muted)", 0.04) }}
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Tonight's idea</p>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={2}
                  placeholder="a tiny robot doing laundry at midnight"
                  className="mt-2 w-full resize-none rounded-lg border border-hairline bg-input px-3 py-2 text-sm text-fg outline-none focus:border-vibe-cyan/60"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => post(true)}
                    disabled={!canRunNight}
                    title="VibeStudio runs the full workflow from this idea — research, direction pick (candidate 1), policy gate, script, Veo render — and publishes it to VibeTube"
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
                    style={{ background: GREEN }}
                  >
                    {nightRunning ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
                    {nightRunning ? "Running & posting…" : "Run workflow & post"}
                  </button>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {nightRunning
                      ? progress || "starting…"
                      : !s.live
                        ? building
                          ? "waiting for the studio"
                          : "no studio to run it in"
                        : !code.trim()
                          ? "type the room's code"
                          : "three to five minutes · auto-picks candidate 1 · renders with Veo"}
                  </span>
                </div>
                {!nightRunning && night?.idea && idea === night.idea ? (
                  <p className="mt-2 font-mono text-[10px] text-fg-muted">seeded from your latest workbench prompt; edit as you like</p>
                ) : null}
              </section>

              {/* workbench clip / script: the other way onto the wall */}
              <details className="rounded-2xl border border-hairline bg-card" open={!!s.clip}>
                <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted [&::-webkit-details-marker]:hidden">
                  Or post what you made in the steps ▸{" "}
                  {s.clip ? "a clip from step 8" : s.canRender ? "a script ready for Veo" : "no clip rendered yet"}
                </summary>
                <section className="border-t border-hairline p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">What goes on the wall</p>
                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">the video · clip</div>
                      <div className="mt-0.5 text-fg-muted">
                        {s.clip ? (
                          <>
                            {s.clip.prebaked ? "stand-in render" : "rendered clip"} · delivered {ago(s.clip.at)} ·{" "}
                            <span className="text-fg">{s.clip.source}</span>
                          </>
                        ) : s.canRender ? (
                          <>
                            No clip on disk yet: <span className="text-fg">Veo renders one from your workbench script</span> when you press post (
                            {night?.veo_model}, a minute or three
                            {night?.shots.length ? `, ${night.shots.length} shots` : ""}).
                          </>
                        ) : (
                          "Step 8 renders a clip in the workbench, or use Run workflow & post above from any step."
                        )}
                      </div>
                    </div>
                    {s.clip ? <video src={s.clip.url} controls playsInline className="mt-2 max-h-40 w-full rounded-lg bg-black" /> : null}
                  </div>
                  <div className="mt-3">
                    <Field
                      label={night?.words_source && night.words_source !== "default" ? `title · from ${night.words_source}` : "title"}
                      value={title}
                      onChange={setTitle}
                      placeholder="Tonight's title"
                      mono={false}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => post(false)}
                      disabled={!canPost}
                      className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
                      style={{ background: s.have === "clip" ? CYAN : AMBER }}
                    >
                      {s.posting && !nightRunning ? (
                        <RefreshCw size={15} className="animate-spin" />
                      ) : renderFirst ? (
                        <Clapperboard size={15} />
                      ) : (
                        <Send size={15} />
                      )}
                      {s.posting && !nightRunning
                        ? renderFirst
                          ? "Rendering & posting…"
                          : "Posting…"
                        : renderFirst
                          ? s.done
                            ? "Render with Veo & post again"
                            : "Render with Veo & post"
                          : s.done
                            ? "Post again"
                            : "Post the clip"}
                    </button>
                    <span className="font-mono text-[11px] text-fg-muted">{why}</span>
                  </div>
                </section>
              </details>

              {/* the room, the name, and how the last post went */}
              <section className="rounded-2xl border p-4" style={{ borderColor: tint(accent, 0.4), background: tint(accent, 0.04) }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="room · event code, case-sensitive" value={code} onChange={setCode} placeholder="GOOGLEATL" />
                  <Field label="your name on the card" value={name} onChange={setName} placeholder="Vibe Studio creator" mono={false} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => refresh(true, code || undefined)}
                    disabled={checking}
                    className="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2 font-mono text-xs text-fg-muted hover:text-fg disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={checking ? "animate-spin" : ""} /> Check again
                  </button>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {s.posting
                      ? last.night === "app"
                        ? progress || "starting the workflow…"
                        : "going out…"
                      : s.done && !s.stale
                        ? `on the wall · ${last.video_id}`
                        : last.status === "failed"
                          ? "the last post failed"
                          : ""}
                  </span>
                </div>
                {note ? (
                  <p className="mt-2 font-mono text-xs" style={{ color: RED }}>
                    {note}
                  </p>
                ) : null}
                {last.status === "failed" && last.detail ? (
                  <p className="mt-2 font-mono text-xs" style={{ color: RED }}>
                    not posted · {last.detail}
                  </p>
                ) : null}
                {lines.length > 0 ? (
                  <pre
                    ref={logRef}
                    className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-hairline bg-input px-3 py-2 font-mono text-[10.5px] leading-relaxed text-fg"
                  >
                    {lines.join("\n")}
                  </pre>
                ) : null}
              </section>

              {/* verification rows */}
              <section>
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Read back from the app and from VibeTube</p>
                <ul className="mt-2 grid gap-2">
                  <CheckRow ok={s.live} label="VibeStudio answers">
                    {studio?.url
                      ? studio.reachable === false
                        ? `${studio.url} · no answer`
                        : studio.reachable
                          ? `${studio.url}${studio.run_status ? ` · its run is ${studio.run_status}` : ""}`
                          : studio.url
                      : building
                        ? "Being deployed; a few minutes."
                        : "No URL yet."}
                  </CheckRow>
                  <CheckRow ok={!!room && room.open} label="the event code names an open room">
                    {room
                      ? room.open
                        ? `${room.code} · ${room.name} · uploads open`
                        : `${room.code} · ${room.name || "no such room"} · ${room.reason || room.state}`
                      : "Type an event code and check."}
                  </CheckRow>
                  <CheckRow ok={s.done} label="the app posted it: VibeTube returned a video id">
                    {s.done
                      ? `${last.video_id} · ${ago(last.done_at ?? last.at)} · through ${last.app_url || studio?.url || "the app"}`
                      : last.status
                        ? `${last.status}${last.detail ? ` · ${last.detail}` : ""}`
                        : "Press Run workflow & post (or Post the clip)."}
                  </CheckRow>
                  <CheckRow
                    ok={!!video && video.status === "ready"}
                    label="the video is on the wall"
                    tone={video?.status === "processing" || (s.done && !video) ? "warn" : "good"}
                  >
                    {video
                      ? `${video.status} · “${video.title}” by ${video.channel}`
                      : s.done
                        ? "Not listed yet; VibeTube is processing it (a minute or three)."
                        : "After the post."}
                  </CheckRow>
                </ul>
                {s.done && last.url ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a
                      href={last.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-bold text-white"
                      style={{ background: GREEN }}
                    >
                      Watch it on VibeTube <ExternalLink size={12} />
                    </a>
                    {video?.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-16 rounded-md border border-hairline object-cover" /> : null}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="border-t border-hairline px-6 py-3 font-mono text-[10.5px] text-fg-muted">
              from a terminal: <span className="text-fg">uv run python scripts/post.py</span> · the app on Cloud Run makes the request (step 9)
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
