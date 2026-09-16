import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, RefreshCw } from "lucide-react";
import { In, StepHeader } from "../components/shared";
import { DoneBanner } from "../components/DoneBanner";
import { LoadCheck } from "../components/LoadCheck";
import { api, useRunEvents } from "../lib/api";
import type { RagCorpus, Stage5Status } from "../lib/types";
import { COLORS, tint } from "./colors";
import { CheckRow, EditPanel, RunPanel, VerifyPanel } from "./FanOut";

/*
 * Step 7, in parts:
 *   7a  RAG Engine: retrieval over documents, embeddings ("meaning in, meaning
 *       out"), a corpus of the audience's comments; create it, load it, query it
 *   7b  the third reader: read_feedback joins the research fan-out as one more
 *       edge into the join; run, and watch the candidates lean toward the comments
 */

const CYAN = COLORS.cyan;
const PURPLE = COLORS.purple;
const AMBER = COLORS.amber;
const GREEN = COLORS.green;
const RED = COLORS.red;

type Part = "a" | "b";
const PARTS: { id: Part; label: string }[] = [
  { id: "a", label: "RAG Engine" },
  { id: "b", label: "The third reader" },
];

export function Rag() {
  const { part: partParam } = useParams();
  const part: Part = PARTS.some((p) => p.id === partParam) ? (partParam as Part) : "a";
  const idx = PARTS.findIndex((p) => p.id === part);
  return (
    <div className="space-y-12">
      {part === "a" && <TheCorpus />}
      {part === "b" && <TheReader />}
      <div className="flex items-center justify-between border-t border-hairline pt-6">
        {idx > 0 ? (
          <Link to={`/step/rag/${PARTS[idx - 1].id}`} className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-fg-muted hover:text-fg">
            ← 7{PARTS[idx - 1].id} · {PARTS[idx - 1].label}
          </Link>
        ) : (
          <span />
        )}
        {idx < PARTS.length - 1 && (
          <Link to={`/step/rag/${PARTS[idx + 1].id}`} className="flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-white" style={{ background: CYAN }}>
            Continue to 7{PARTS[idx + 1].id} · {PARTS[idx + 1].label} <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

/** A file from the repo, shown on request. */
function SourceToggle({ path, label }: { path: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const toggle = async () => {
    if (!open && code === null) {
      try {
        setCode((await api.getCode(path)).content);
      } catch {
        setCode(`could not read ${path}`);
      }
    }
    setOpen((o) => !o);
  };
  return (
    <div className="mt-4 min-w-0 flex-1 basis-[320px]">
      <button onClick={toggle} className="rounded-xl border border-hairline bg-overlay px-4 py-2 text-left font-mono text-xs text-fg-muted hover:text-fg">
        {open ? "Hide the code" : "Show the code"} · {label}
      </button>
      {open && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-hairline bg-input">
          <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
          <pre className="max-h-[520px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
            <code>{code ?? "…"}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

const mono = { fontFamily: "var(--font-mono)" } as const;

/* ───────────────────────── the figure: meaning in, meaning out ───────────────────────── */

const STAGES = [
  { key: "docs", title: "the docs", sub: "comments.md · 30 comments", color: AMBER },
  { key: "chunk", title: "chunk", sub: "into passages", color: "currentColor" },
  { key: "embed", title: "the model", sub: "text-embedding-005", color: PURPLE },
  { key: "store", title: "vector store", sub: "nearby = similar meaning", color: GREEN },
];
const ARROWS = ["split", "embed", "store"];
// the store's dots: three loose clusters (animals, gadgets, fantasy) and a few strays
const DOTS: { x: number; y: number; c: string }[] = [
  { x: 24, y: 30, c: AMBER }, { x: 34, y: 22, c: AMBER }, { x: 40, y: 36, c: AMBER }, { x: 28, y: 42, c: AMBER },
  { x: 92, y: 24, c: PURPLE }, { x: 104, y: 30, c: PURPLE }, { x: 98, y: 40, c: PURPLE },
  { x: 62, y: 66, c: GREEN }, { x: 74, y: 60, c: GREEN }, { x: 70, y: 74, c: GREEN }, { x: 82, y: 70, c: GREEN },
  { x: 116, y: 62, c: "currentColor" }, { x: 46, y: 58, c: "currentColor" }, { x: 12, y: 70, c: "currentColor" },
];
const QUERY = "small magic in the kitchen";
const NEAREST = ["the tiny dragon guarding one sock", "a phoenix in the toaster", "small magic in small rooms"];

/** Indexing: a document is split into passages, each passage is embedded into a
 *  vector, the vectors land in the store. Asking: the question takes the same
 *  path and comes back with the passages whose vectors sit nearest to it. */
function MeaningFigure() {
  const [asking, setAsking] = useState(false);
  const loop = { repeat: Infinity, repeatDelay: 0.8 };
  const tileX = (i: number) => 20 + i * 190;
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg viewBox="0 0 760 330" className="h-auto w-full min-w-[640px] text-fg" role="img" aria-label="The docs are split into passages, each passage is embedded into a vector by text-embedding-005 and stored; a question is embedded the same way and the nearest passages come back.">
          <defs>
            <marker id="rag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <text x="380" y="18" textAnchor="middle" fontSize="9.5" letterSpacing="3" style={mono} fill={CYAN}>RAG · MEANING IN, MEANING OUT</text>
          {STAGES.map((s, i) => {
            const x = tileX(i);
            return (
              <g key={s.key}>
                <motion.rect x={x} y={36} width={150} height={112} rx={14} fill="var(--overlay)" stroke={s.color === "currentColor" ? "var(--hairline)" : s.color} strokeWidth={1.3} initial={{ strokeOpacity: 0.5 }} animate={asking ? { strokeOpacity: 0.5 } : { strokeOpacity: [0.5, 1, 0.5] }} transition={{ duration: 3.2, delay: i * 0.8, ...loop }} />
                {s.key === "docs" && (
                  <g transform={`translate(${x + 45} 56)`}>
                    <rect width="60" height="70" rx="6" fill="var(--card)" stroke="currentColor" strokeOpacity="0.45" />
                    {[0, 1, 2, 3, 4].map((k) => <rect key={k} x="10" y={12 + k * 11} width={k === 4 ? 24 : 40} height="3" rx="1.5" fill={AMBER} opacity="0.7" />)}
                  </g>
                )}
                {s.key === "chunk" && (
                  <g transform={`translate(${x + 25} 58)`}>
                    {[0, 1, 2].map((k) => (
                      <motion.g key={k} initial={{ opacity: 0.35 }} animate={asking ? { opacity: 0.9 } : { opacity: [0.35, 1, 0.35] }} transition={{ duration: 3.2, delay: 0.8 + k * 0.25, ...loop }}>
                        <rect y={k * 24} width="100" height="18" rx="5" fill="var(--card)" stroke="currentColor" strokeOpacity="0.45" />
                        <rect x="8" y={k * 24 + 7} width={64 - k * 12} height="3" rx="1.5" fill="currentColor" opacity="0.5" />
                      </motion.g>
                    ))}
                  </g>
                )}
                {s.key === "embed" && (
                  <g transform={`translate(${x + 75} 96)`}>
                    <text textAnchor="middle" y="-16" fontSize="11" style={mono} fill={PURPLE}>[0.12, −0.44, …]</text>
                    {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                      <motion.rect key={k} x={-24 + k * 8} width="5" rx="1.5" fill={PURPLE} initial={{ y: -2, height: 6 }} animate={asking ? { y: -6 - (k % 3) * 3, height: 12 + (k % 3) * 4 } : { y: [-2, -8 - (k % 3) * 3, -2], height: [6, 16 + (k % 3) * 4, 6] }} transition={{ duration: 1.4, delay: 1.7 + k * 0.08, ...loop }} />
                    ))}
                    <text textAnchor="middle" y="38" fontSize="8.5" style={mono} fill="currentColor" opacity="0.6">one vector per passage</text>
                  </g>
                )}
                {s.key === "store" && (
                  <g transform={`translate(${x + 10} 50)`}>
                    <polygon points="10,80 60,10 130,10 80,80" fill={tint(GREEN, 0.05)} stroke={GREEN} strokeOpacity="0.4" />
                    <path d="M28 55 L 100 55 M45 32 L 115 32 M38 10 L 60 80 M88 10 L 110 80" stroke={GREEN} strokeOpacity="0.2" strokeWidth="0.8" />
                    {DOTS.map((d, k) => {
                      const near = asking && k >= 7 && k <= 10;
                      return <motion.circle key={k} cx={d.x} cy={d.y} r={near ? 4 : 3} fill={d.c} initial={{ opacity: 0.5 }} animate={asking ? { opacity: near ? 1 : 0.3 } : { opacity: [0.5, 0.95, 0.5] }} transition={{ duration: 2.4, delay: 2.4 + k * 0.05, ...loop }} />;
                    })}
                    {asking && (
                      <g>
                        {[7, 8, 9].map((k) => <motion.line key={k} x1={72} y1={68} x2={DOTS[k].x} y2={DOTS[k].y} stroke={CYAN} strokeWidth="1" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.9 }} transition={{ duration: 0.5, delay: 2.2 + (k - 7) * 0.15 }} />)}
                        <motion.circle cx={72} cy={68} r={5} fill={CYAN} stroke="var(--card)" strokeWidth="1.5" initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.0, duration: 0.4 }} style={{ transformOrigin: "72px 68px" }} />
                      </g>
                    )}
                  </g>
                )}
                <text x={x + 75} y={168} textAnchor="middle" fontSize="11.5" fontWeight="600" style={mono} fill={s.color === "currentColor" ? "currentColor" : s.color}>{s.title}</text>
                <text x={x + 75} y={183} textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.6">{s.sub}</text>
                {i < 3 && (
                  <g>
                    <line x1={x + 154} y1={92} x2={x + 186} y2={92} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" markerEnd="url(#rag-arrow)" />
                    <text x={x + 170} y={84} textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">{ARROWS[i]}</text>
                  </g>
                )}
              </g>
            );
          })}
          {!asking && <motion.circle r="5" fill={CYAN} initial={{ cx: 95, cy: 92, opacity: 0 }} animate={{ cx: [95, 170, 285, 360, 475, 550, 665], opacity: [0, 1, 1, 1, 1, 1, 0] }} transition={{ duration: 3.2, ease: "easeInOut", ...loop }} />}

          {/* asking: the question takes the same path */}
          <AnimatePresence>
            {asking && (
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <rect x="20" y="214" width="720" height="100" rx="14" fill={tint(CYAN, 0.05)} stroke={CYAN} strokeOpacity="0.35" />
                <text x="36" y="232" fontSize="9" letterSpacing="2" style={mono} fill={CYAN}>ASK IT SOMETHING</text>
                <motion.g initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
                  <rect x="36" y="244" width="200" height="28" rx="14" fill="var(--card)" stroke={CYAN} strokeOpacity="0.6" />
                  <text x="136" y="262" textAnchor="middle" fontSize="10.5" style={mono} fill="currentColor">“{QUERY}”</text>
                </motion.g>
                <motion.line x1="240" y1="258" x2="272" y2="258" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" markerEnd="url(#rag-arrow)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.6, duration: 0.4 }} />
                <text x="256" y="250" textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">embed</text>
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 }}>
                  <rect x="276" y="244" width="120" height="28" rx="8" fill="var(--card)" stroke={PURPLE} strokeOpacity="0.6" />
                  <text x="336" y="262" textAnchor="middle" fontSize="10" style={mono} fill={PURPLE}>[0.10, −0.41, …]</text>
                </motion.g>
                <motion.line x1="400" y1="258" x2="432" y2="258" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" markerEnd="url(#rag-arrow)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.5, duration: 0.4 }} />
                <text x="416" y="250" textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">nearest</text>
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.0 }}>
                  <text x="440" y="250" fontSize="9.5" style={mono} fill={GREEN}>Three passages, by distance</text>
                  {NEAREST.map((t, k) => (
                    <motion.text key={t} x="440" y={266 + k * 15} fontSize="10" style={mono} fill="currentColor" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.3 + k * 0.25 }}>
                      <tspan fill={GREEN}>✓ </tspan>{t}
                    </motion.text>
                  ))}
                </motion.g>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => setAsking((a) => !a)} className="rounded-full border px-4 py-1.5 font-mono text-xs" style={{ borderColor: tint(CYAN, 0.53), color: CYAN, background: asking ? tint(CYAN, 0.09) : "transparent" }}>
          {asking ? "◼ Back to indexing" : "▶ Ask it something"}
        </button>
        <figcaption className="text-xs text-fg-muted">
          {asking
            ? "Nearby vectors represent similar semantics, so the dragon comment returns for a query that never explicitly mentions dragon."
            : "Indexing splits the file into passages, embeds each passage into a vector, and stores the vectors. Vector proximity corresponds to semantic similarity."}
        </figcaption>
      </div>
    </figure>
  );
}

/* ───────────────────────── the console runner ───────────────────────── */

type RagCmd = "connect" | "load" | "query";
/** What each command leaves behind, said when it finishes. */
const RAG_DONE: Record<RagCmd, string> = {
  connect: "The corpus exists in your project and this lab is connected to it. Next, load the comments.",
  load: "The comments are split into passages, embedded, and indexed. Next, ask the corpus a question.",
  query: "Those are the passages nearest to your question, closest first.",
};

const RAG_COMMANDS: { cmd: RagCmd; line: string; what: string }[] = [
  { cmd: "connect", line: "python -m agent.platform.rag", what: "Creates the corpus in your project, once, with text-embedding-005 as its embedding model. Runs again as connect." },
  { cmd: "load", line: "python -m agent.platform.rag load", what: "Uploads agent/comments.md where the file is split into passages, each passage embedded and stored. About two minutes while the index builds. Rerun it after editing the comments; the previous copy is replaced." },
  { cmd: "query", line: `python -m agent.platform.rag query "${QUERY}"`, what: "Embeds the question and returns the five passages nearest to it, with their distance. Lower is closer." },
];

/** The corpus commands, run here as the same `python -m agent.platform.rag` process a
 *  terminal would start. Output streams in as it is printed. */
function RagRunner({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState<RagCmd | null>(null);
  const [exit, setExit] = useState<number | null>(null);
  const runId = useRef<string | null>(null);  // the token the server minted for this run
  const waitedFor = useRef(0);        // polls spent without the server admitting to a run
  const seenRunning = useRef(false);  // the worker was observed live at least once
  const [overlay, setOverlay] = useState<RagCmd | null>(null);
  const [query, setQuery] = useState(QUERY);
  useRunEvents((verb, line) => {
    if (verb === "rag") setLines((l) => [...l.slice(-199), line]);
  });
  useEffect(() => {
    api.ragStatus().then((st) => {
      if (st.running) {
        // a command started elsewhere: any exit that follows is its own
        runId.current = null;
        seenRunning.current = true;
        setRunning(true);
        setLines(["a rag command is already running on this server; its remaining output appears here"]);
      }
    });
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const st = await api.ragStatus();
      if (st.running) {
        seenRunning.current = true;
        waitedFor.current = 0;
        return;
      }
      // Finish on the server's own word, never on a clock. The page's clock and
      // the server's are two different machines in Cloud Shell, so a comparison
      // of timestamps calls a running command finished. The exit record has to
      // name the run this page started.
      const mine = runId.current;
      if (mine) {
        if (st.last_exit?.run !== mine) {
          // Either the worker has not registered yet or it is still going.
          if (++waitedFor.current > 120) {
            setRunning(false);
            setLines((l) => [...l, `lost track of the command · read runs/rag_run.log`]);
          }
          return;
        }
      } else if (!seenRunning.current) {
        return;                                    // watching someone else's run
      }
      setRunning(false);
      setExit(st.last_exit?.code ?? null);
      // The stream can be held back by a proxy, so take the whole output from
      // the log the worker wrote rather than trusting what arrived live.
      try {
        const log = await api.workerLog("rag");
        if (log.lines.length) setLines(log.lines);
      } catch {
        /* the live lines are all there is */
      }
      onDone();
    }, 1500);
    return () => clearInterval(t);
  }, [running, onDone]);
  const run = async (cmd: RagCmd) => {
    setLines([]);
    setExit(null);
    setOverlay(cmd);   // every command opens a window: a click has to show something
    let r: { ok: boolean; detail: string; run?: string };
    try {
      r = (await api.ragRun(cmd, cmd === "query" ? query : undefined)) as { ok: boolean; detail: string; run?: string };
    } catch (e) {
      // a failed request used to reject inside the click handler, so the page
      // showed nothing at all and the button looked dead
      setLines([`could not reach the learning center: ${(e as Error).message}`,
                "Is it still running? Its log is runs/lab.log; scripts/start.sh starts it again."]);
      setExit(1);
      setRunning(false);
      return;
    }
    if (!r.ok) {
      setLines([`could not start: ${r.detail}. Wait for it to finish; the buttons enable again when it exits.`]);
      // refused because another worker is live: watch that one instead
      runId.current = null;
      seenRunning.current = true;
      setRunning(true);
      return;
    }
    runId.current = r.run ?? null;
    seenRunning.current = false;
    waitedFor.current = 0;
    setRunning(true);
  };
  const lineFor = (c: (typeof RAG_COMMANDS)[number]) => (c.cmd === "query" ? `python -m agent.platform.rag query "${query}"` : c.line);
  return (
    <>
        {overlay && <RagOverlay cmd={overlay} lines={lines} running={running} exit={exit} onClose={() => setOverlay(null)} />}
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {RAG_COMMANDS.map((c) => (
          <li key={c.cmd} className="rounded-2xl border border-hairline bg-overlay p-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(lineFor(c));
                  setCopied(c.cmd);
                  setTimeout(() => setCopied(null), 1200);
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-hairline bg-input px-3 py-2 text-left font-mono text-xs text-fg hover:border-vibe-cyan/60"
                title="copy for a terminal"
              >
                <span className="truncate">{lineFor(c)}</span>
                <span className="shrink-0 text-[10px] text-fg-muted">{copied === c.cmd ? "copied" : "copy"}</span>
              </button>
              <button onClick={() => run(c.cmd)} disabled={running} className="shrink-0 rounded-lg px-3 py-2 font-mono text-xs font-bold text-white disabled:opacity-40" style={{ background: CYAN }}>
                run
              </button>
            </div>
            {c.cmd === "query" && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mt-2 w-full rounded-lg border border-hairline bg-input px-3 py-1.5 font-mono text-xs text-fg outline-none focus:border-vibe-cyan/60"
                placeholder="a question for the corpus"
                aria-label="query text"
              />
            )}
            <p className="mt-2 text-xs text-fg-muted">{c.what}</p>
          </li>
        ))}
      </ol>
      {(lines.length > 0 || running) && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-input">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span>python -m agent.platform.rag · output</span>
            <span>{running ? "running…" : exit === 0 ? "done" : exit === null ? "" : `exit ${exit}`}</span>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
            {lines.filter((l) => !/Warning|warn\(/.test(l)).join("\n") || (running ? "starting…" : "")}
          </pre>
        </div>
      )}
    </>
  );
}

/** A full-screen modal for the two long commands: the page stays put, the
 *  output streams in, and the animation shows what the command is doing on
 *  Google Cloud. Closes only once the process has exited. */
function RagOverlay({ cmd, lines, running, exit, onClose }: { cmd: RagCmd; lines: string[]; running: boolean; exit: number | null; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const clean = lines.filter((l) => !/Warning|warn\(/.test(l));
  const done = !running && exit !== null;
  const failed = done && exit !== 0;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} role="dialog" aria-modal="true" aria-label={cmd === "connect" ? "Creating the corpus" : "Loading the comments"}>
      <motion.div initial={{ y: 16, scale: 0.98 }} animate={{ y: 0, scale: 1 }} className="w-full max-w-3xl overflow-hidden rounded-3xl border border-hairline bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div className="flex items-center gap-3">
            {!done && <RefreshCw size={14} className="animate-spin" style={{ color: CYAN }} />}
            <span className="font-mono text-xs text-fg">{cmd === "connect" ? "python -m agent.platform.rag" : "python -m agent.platform.rag load"}</span>
          </div>
          <span className="font-mono text-[11px]" style={{ color: failed ? RED : done ? GREEN : "var(--fg-muted)" }}>
            {done ? (failed ? `exited with ${exit}` : "done") : "running on this server…"}
          </span>
        </div>
        <div className="p-5">
          {cmd === "connect" ? (
            <CreateAnimation lines={clean} done={done} />
          ) : cmd === "load" ? (
            <LoadAnimation lines={clean} done={done} />
          ) : (
            <p className="text-sm text-fg-muted">
              The question is embedded with the same model the passages were, and the nearest passages come back with their distance. The results panel below keeps them once you close this.
            </p>
          )}
        </div>
        <div className="border-t border-hairline bg-input">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span>output</span>
            <span className="normal-case tracking-normal">the whole run is in runs/rag_run.log</span>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">{clean.slice(-30).join("\n") || "starting… the first call to your project can take a few seconds"}</pre>
        </div>
        {done ? (
          <DoneBanner failed={failed} exit={exit} onClose={onClose} message={RAG_DONE[cmd]} />
        ) : (
          <div className="flex items-center justify-end gap-3 border-t border-hairline px-5 py-3">
            <span className="text-xs text-fg-muted">The page is locked until the command finishes.</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** `python -m agent.platform.rag`: a RAG Engine corpus appears in the project with an
 *  embedding model attached. The motion repeats while the command runs. */
function CreateAnimation({ lines, done }: { lines: string[]; done: boolean }) {
  const text = lines.join("\n");
  const created = /created|connected/.test(text);
  const serverless = /serverless/.test(text);
  const loop = done ? { repeat: 0 } : { repeat: Infinity, repeatDelay: 1.2 };
  return (
    <div>
      <p className="text-sm text-fg-muted">
        Creating a RAG Engine corpus in your project, with <code className="font-mono text-fg">text-embedding-005</code> as the model that turns
        passages and questions into vectors. The managed vector database is set to serverless first; a fresh project defaults to a provisioned mode
        that some regions cannot allocate. The first run takes about twenty seconds; every later run reconnects to the cached resource.
      </p>
      <svg viewBox="0 0 620 180" className="mt-3 h-auto w-full text-fg" role="img" aria-label="A RAG Engine corpus is created in the project and the text-embedding-005 model is attached to it.">
        <rect x="10" y="14" width="600" height="156" rx="16" fill="var(--overlay)" stroke="var(--hairline)" />
        <text x="26" y="36" fontSize="10" style={mono} fill="currentColor" opacity="0.6">GOOGLE CLOUD · your project · us-central1</text>
        <motion.g initial={{ opacity: 0.2, scale: 0.9 }} animate={done ? { opacity: 1, scale: 1 } : { opacity: [0.2, 1, 1, 0.2], scale: [0.9, 1, 1, 0.9] }} transition={{ duration: 3.6, ...loop }} style={{ transformOrigin: "140px 92px" }}>
          <rect x="40" y="52" width="200" height="80" rx="14" fill={tint(CYAN, 0.12)} stroke={created ? CYAN : "var(--hairline)"} strokeWidth={1.6} />
          <text x="140" y="80" textAnchor="middle" fontSize="12" style={mono} fill={CYAN}>RAG Engine · corpus</text>
          <text x="140" y="98" textAnchor="middle" fontSize="10" style={mono} fill="currentColor" opacity="0.7">{created ? "vibestudio-feedback" : "creating…"}</text>
          <text x="140" y="116" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.55">{serverless ? "managed vector db · serverless" : "managed vector db"}</text>
        </motion.g>
        <motion.path d="M240 92 L 300 92" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="4 3" initial={{ pathLength: 0 }} animate={done ? { pathLength: 1 } : { pathLength: [0, 1, 1, 0] }} transition={{ duration: 3.6, delay: 0.6, ...loop }} />
        <motion.g initial={{ opacity: 0.2, y: 8 }} animate={done ? { opacity: 1, y: 0 } : { opacity: [0.2, 1, 1, 0.2], y: [8, 0, 0, 8] }} transition={{ duration: 3.6, delay: 1.0, ...loop }}>
          <rect x="304" y="66" width="200" height="52" rx="12" fill={tint(PURPLE, 0.12)} stroke={created ? PURPLE : "var(--hairline)"} strokeWidth={1.4} />
          <text x="404" y="87" textAnchor="middle" fontSize="11" style={mono} fill={PURPLE}>text-embedding-005</text>
          <text x="404" y="104" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.6">embedding model · 768 dimensions</text>
        </motion.g>
        <text x="404" y="140" textAnchor="middle" fontSize="9.5" style={mono} fill="currentColor" opacity="0.6">the same model embeds every passage and every question</text>
      </svg>
    </div>
  );
}

/** `python -m agent.platform.rag load`: comments.md is split into passages, each passage
 *  is embedded and stored, then a probe query proves the index answers.
 *  Progress follows the output lines. */
function LoadAnimation({ lines, done }: { lines: string[]; done: boolean }) {
  const text = lines.join("\n");
  const m = text.match(/uploading comments\.md: (\d+) comments/);
  const n = m ? Number(m[1]) : 30;
  const uploading = /uploading/.test(text);
  const indexing = /indexing/.test(text);
  const indexed = /indexed:/.test(text) || /still building/.test(text);
  const replaced = /replaced the previous/.test(text);
  const stage = indexed ? 4 : indexing ? 3 : uploading ? 2 : 1;
  const loop = done ? { repeat: 0 } : { repeat: Infinity };
  const steps = [
    { name: "upload", sub: `batch of ${n} comments`, color: AMBER },
    { name: "split", sub: "~120-token passages", color: "currentColor" },
    { name: "embed", sub: "text-embedding-005", color: PURPLE },
    { name: "store", sub: "nearby = similar", color: GREEN },
  ];
  return (
    <div>
      <p className="text-sm text-fg-muted">
        One <code className="font-mono text-fg">upload_file</code> call. RAG Engine splits the file into passages a few comments long, embeds each
        passage with the corpus's model, and stores the vectors. The index answers a few seconds to two minutes after the upload; the command
        probes it with a query until it does.{replaced ? " The previous copy of the file was deleted first, so the passages are replaced, not doubled." : ""}
      </p>
      <svg viewBox="0 0 760 200" className="mt-3 h-auto w-full text-fg" role="img" aria-label="comments.md is uploaded, split into passages, embedded and stored; a probe query confirms the index answers.">
        {steps.map((s, i) => {
          const x = 14 + i * 186;
          const active = stage === i + 1 && !done;
          const past = stage > i + 1 || done;
          const color = s.color === "currentColor" ? "currentColor" : s.color;
          return (
            <g key={s.name}>
              <motion.rect x={x} y={30} width={172} height={70} rx={12} fill={past || active ? tint(s.color, 0.1) : "var(--overlay)"} stroke={past || active ? color : "var(--hairline)"} strokeWidth={active ? 1.8 : 1.2} initial={{ strokeOpacity: 0.6 }} animate={active ? { strokeOpacity: [0.4, 1, 0.4] } : { strokeOpacity: past ? 1 : 0.6 }} transition={{ duration: 1.4, ...loop }} />
              <text x={x + 86} y={58} textAnchor="middle" fontSize="12" style={mono} fill={past || active ? color : "currentColor"}>{s.name}</text>
              <text x={x + 86} y={76} textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.65">{s.sub}</text>
              <text x={x + 86} y={92} textAnchor="middle" fontSize="8.5" style={mono} fill={past ? GREEN : "currentColor"} opacity={past ? 1 : 0.5}>{past ? "done" : active ? "working…" : "waiting"}</text>
              {i < 3 && <line x1={x + 174} y1={65} x2={x + 198} y2={65} stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />}
            </g>
          );
        })}
        {!done && <motion.circle r="4" fill={CYAN} initial={{ cx: 100, cy: 65, opacity: 0 }} animate={{ cx: [100, 286, 472, 658], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.4, ease: "easeInOut", ...loop }} />}
        <text x="14" y="134" fontSize="10" style={mono} fill="currentColor" opacity="0.6">the probe query, until the index answers</text>
        <rect x="14" y="144" width="732" height="26" rx="8" fill="var(--overlay)" stroke="var(--hairline)" />
        <text x="26" y="161" fontSize="10" style={mono} fill="currentColor">“what viewers liked and what they complained about”</text>
        <text x="734" y="161" textAnchor="end" fontSize="10" style={mono} fill={indexed ? GREEN : "currentColor"} opacity={indexed ? 1 : 0.5}>{indexed ? "answered ✓" : indexing ? "asking…" : "—"}</text>
        <rect x="14" y="184" width="732" height="8" rx="4" fill="var(--overlay)" stroke="var(--hairline)" />
        <motion.rect x="14" y="184" height="8" rx="4" fill={CYAN} initial={{ width: 0 }} animate={{ width: (732 * (done ? 4 : stage - 1 + 0.5)) / 4 }} transition={{ duration: 0.6 }} />
      </svg>
    </div>
  );
}

/** The corpus, fetched on demand: connected or not, and its files. */
function CorpusLedger({ refreshKey = 0 }: { refreshKey?: number }) {
  const [corpus, setCorpus] = useState<RagCorpus | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setFailed("");
    try {
      setCorpus(await api.labRag());
    } catch (e) {
      // a server error answers in plain text, so this used to leave the panel blank
      let why = (e as Error).message;
      try {
        const v = await api.version();
        if (v.stale) why += ` · this server is running ${v.running} but the checkout is at ${v.head}: run scripts/restart.sh`;
      } catch {
        /* the message stands on its own */
      }
      setFailed(why);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();          // on arrival too: a panel that says what is there must not start blank
  }, [refreshKey, load]);
  return (
    <section className="rounded-3xl border border-hairline bg-card p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The corpus</p>
          <h2 className="font-display mt-2 text-2xl">What the corpus holds.</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">Reads the corpus in your project, displaying the resource name and the files in it. Passages are not listed by the API; the query command shows them.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-xl border border-hairline bg-overlay px-4 py-2 font-mono text-xs text-fg-muted hover:text-fg">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Show the corpus
        </button>
      </div>
      {failed && (
        <div className="mt-4 rounded-xl border p-3 font-mono text-[11.5px]" style={{ borderColor: tint(RED, 0.4), color: RED, background: tint(RED, 0.06) }}>
          {failed}
          <span className="mt-1 block opacity-80">the learning center's log is runs/lab.log</span>
        </div>
      )}
      {corpus && !failed && (
        <div className="mt-4 rounded-2xl border border-hairline bg-overlay p-4">
          {!corpus.connected ? (
            <p className="text-sm text-fg-muted">No corpus yet. Run the first command above.</p>
          ) : corpus.error ? (
            <p className="font-mono text-xs" style={{ color: RED }}>{corpus.error}</p>
          ) : (
            <>
              <p className="font-mono text-[11px] text-fg-muted">
                ragCorpora/{corpus.corpus?.split("/").slice(-1)[0]} · {corpus.files.length} file{corpus.files.length === 1 ? "" : "s"} · agent/comments.md has {corpus.comments} comments
              </p>
              <ul className="mt-3 space-y-2">
                {corpus.files.map((f) => (
                  <li key={f.id} className="text-sm">
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: tint(CYAN, 0.13), color: CYAN }}>
                      ragFile {f.id}
                    </span>
                    <span className="ml-2 font-mono text-xs">{f.display_name}</span>
                    {f.description && <span className="ml-2 text-fg-muted">{f.description}</span>}
                  </li>
                ))}
                {corpus.files.length === 0 && <li className="text-sm text-fg-muted">Empty. Run the load command.</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── 7a ───────────────────────── */

const CODE_CORPUS = `# agent/platform/rag.py
corpus = rag.create_corpus(
    display_name="vibestudio-feedback",
    description="Vibe Studio: what the audience wrote under the channel's past videos.",
    backend_config=rag.RagVectorDbConfig(
        rag_embedding_model_config=rag.RagEmbeddingModelConfig(
            vertex_prediction_endpoint=rag.VertexPredictionEndpoint(
                publisher_model="publishers/google/models/text-embedding-005"))))

rag.upload_file(
    corpus_name=corpus.name, path="agent/comments.md", display_name="comments.md",
    transformation_config=rag.TransformationConfig(
        chunking_config=rag.ChunkingConfig(chunk_size=120, chunk_overlap=20)))`;

const CODE_RETRIEVE = `# agent/platform/rag.py
def retrieve(query: str, k: int = TOP_K) -> list[dict]:
    """The k passages nearest to \`query\`: embed the question, find the nearest
    vectors, return their text. Each row: text, score, source."""
    name = corpus_name()
    if not name:
        raise RuntimeError("no corpus connected - run: python -m agent.platform.rag")
    rag = _rag()
    resp = rag.retrieval_query(
        rag_resources=[rag.RagResource(rag_corpus=name)], text=query,
        rag_retrieval_config=rag.RagRetrievalConfig(top_k=k))
    rows = []
    for c in resp.contexts.contexts:
        rows.append({"text": c.text.strip(), "score": round(float(c.score), 3),
                     "source": c.source_display_name})
    return rows`;


/** Three places a run can draw context from, and what each one holds. */
function StoresFigure() {
  const col = (x: number, title: string, holds: string, shape: string, color: string, lines: string[]) => (
    <g key={title}>
      <rect x={x} y={26} width={220} height={150} rx={16} fill={tint(color, 0.06)} stroke={color} strokeOpacity="0.7" />
      <text x={x + 110} y={50} textAnchor="middle" fontSize="12" fontWeight="600" style={mono} fill={color}>{title}</text>
      <text x={x + 110} y={68} textAnchor="middle" fontSize="9.5" style={mono} fill="currentColor" opacity="0.65">{holds}</text>
      {lines.map((l, i) => (
        <g key={l}>
          <rect x={x + 12} y={84 + i * 22} width={196} height={16} rx={5} fill="var(--card)" stroke={color} strokeOpacity="0.35" />
          <text x={x + 20} y={95 + i * 22} fontSize="8.5" style={mono} fill="currentColor" opacity="0.8">{l}</text>
        </g>
      ))}
      <text x={x + 110} y={166} textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.55">{shape}</text>
    </g>
  );
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 740 190" className="h-auto w-full text-fg" role="img" aria-label="Three stores where session state holds what one run knows, Memory Bank holds consolidated facts about a person, and RAG Engine holds what people wrote, verbatim, searchable by meaning.">
        {col(10, "State", "what one run knows", "keys, for this run", PURPLE, ["direction: \"cat vs the air fryer\"", "candidates: [ ...four... ]", "render_url: /static/renders/..."])}
        {col(260, "Memory Bank", "facts about a person, consolidated", "one fact per memory, per creator", AMBER, ["[TASTE] prefers fantasy lately", "[RULES] one room, no captions", "(three sessions became one fact)"])}
        {col(510, "RAG Engine", "what people wrote, verbatim", "passages, found by meaning", CYAN, ["\"Creatures in ordinary places.\"", "\"Intro five seconds too long.\"", "\"Let a shot breathe.\""])}
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">State lives and dies with the run. Memory Bank rewrites facts as it learns. RAG Engine keeps the text as written and finds the passages that fit a question.</figcaption>
    </figure>
  );
}

/** Retrieval over documents: not the whole pile, only the passages that fit. */
function RetrievalFigure() {
  const docs = [0, 1, 2, 3, 4];
  return (
    <figure className="m-0">
      <svg viewBox="0 0 360 230" className="h-auto w-full text-fg" role="img" aria-label="A question goes to a corpus of documents; only the few passages that fit come back and the model reads those.">
        <defs>
          <marker id="ret-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <rect x="14" y="20" width="150" height="190" rx="14" fill="var(--overlay)" stroke={CYAN} strokeOpacity="0.6" />
        <text x="89" y="40" textAnchor="middle" fontSize="10" style={mono} fill={CYAN}>the corpus</text>
        {docs.map((d) => (
          <g key={d} transform={`translate(${28 + (d % 2) * 64} ${52 + Math.floor(d / 2) * 50})`}>
            <rect width="56" height="40" rx="5" fill="var(--card)" stroke="currentColor" strokeOpacity="0.4" />
            {[0, 1, 2, 3].map((k) => (
              <rect key={k} x="7" y={8 + k * 8} width={k === 3 ? 22 : 40} height="3" rx="1.5" fill={d === 1 && k === 1 ? GREEN : d === 3 && k === 2 ? GREEN : "currentColor"} opacity={d === 1 && k === 1 ? 1 : d === 3 && k === 2 ? 1 : 0.35} />
            ))}
          </g>
        ))}
        <rect x="210" y="40" width="136" height="36" rx="10" fill="var(--card)" stroke={AMBER} strokeOpacity="0.8" />
        <text x="278" y="62" textAnchor="middle" fontSize="9.5" style={mono} fill={AMBER}>“small magic?”</text>
        <line x1="210" y1="58" x2="168" y2="58" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#ret-arrow)" />
        <line x1="168" y1="150" x2="210" y2="150" stroke={GREEN} strokeWidth="1.4" markerEnd="url(#ret-arrow)" />
        <rect x="210" y="118" width="136" height="64" rx="10" fill={tint(GREEN, 0.07)} stroke={GREEN} strokeOpacity="0.8" />
        <text x="278" y="138" textAnchor="middle" fontSize="9.5" style={mono} fill={GREEN}>two passages</text>
        <rect x="224" y="148" width="108" height="8" rx="3" fill={GREEN} opacity="0.7" />
        <rect x="224" y="162" width="108" height="8" rx="3" fill={GREEN} opacity="0.7" />
        <text x="278" y="206" textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.65">the model reads these</text>
      </svg>
    </figure>
  );
}

/** RAG Engine as a GEAP service: a corpus, and the sources that can be imported into it. */
function PlatformFigure() {
  const sources = ["local files (upload_file)", "Cloud Storage", "Google Drive", "Slack", "Jira", "SharePoint"];
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 760 250" className="h-auto w-full text-fg" role="img" aria-label="RAG Engine runs on GEAP with a corpus containing an embedding model and a vector store, alongside files imported from local disk, Cloud Storage, Google Drive, Slack, Jira, or SharePoint.">
        <defs>
          <marker id="plat-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <rect x="250" y="14" width="496" height="222" rx="18" fill="var(--overlay)" stroke="var(--hairline)" />
        <text x="266" y="36" fontSize="10" style={mono} fill="currentColor" opacity="0.6">GOOGLE CLOUD · GEAP · your project · us-central1</text>
        <rect x="266" y="48" width="464" height="170" rx="14" fill={tint(CYAN, 0.05)} stroke={CYAN} strokeOpacity="0.6" />
        <text x="282" y="70" fontSize="11" style={mono} fill={CYAN}>RAG Engine</text>
        <rect x="282" y="84" width="432" height="118" rx="12" fill="var(--card)" stroke={CYAN} strokeOpacity="0.8" />
        <text x="498" y="106" textAnchor="middle" fontSize="11.5" fontWeight="600" style={mono} fill={CYAN}>corpus · vibestudio-feedback</text>
        <rect x="300" y="120" width="190" height="64" rx="10" fill={tint(PURPLE, 0.08)} stroke={PURPLE} strokeOpacity="0.8" />
        <text x="395" y="144" textAnchor="middle" fontSize="10" style={mono} fill={PURPLE}>embedding model</text>
        <text x="395" y="162" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.7">text-embedding-005</text>
        <rect x="506" y="120" width="190" height="64" rx="10" fill={tint(GREEN, 0.08)} stroke={GREEN} strokeOpacity="0.8" />
        <text x="601" y="144" textAnchor="middle" fontSize="10" style={mono} fill={GREEN}>vector store</text>
        <text x="601" y="162" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.7">files → passages → vectors</text>
        <text x="14" y="36" fontSize="10" style={mono} fill="currentColor" opacity="0.6">what can be imported</text>
        {sources.map((src, i) => (
          <g key={src}>
            <rect x="14" y={48 + i * 30} width="170" height="22" rx="7" fill="var(--card)" stroke={i === 0 ? AMBER : "var(--hairline)"} />
            <text x="24" y={63 + i * 30} fontSize="9.5" style={mono} fill={i === 0 ? AMBER : "currentColor"}>{src}</text>
            <line x1="184" y1={59 + i * 30} x2="262" y2="143" stroke="currentColor" strokeOpacity={i === 0 ? 0.8 : 0.3} strokeWidth={i === 0 ? 1.4 : 1} markerEnd="url(#plat-arrow)" />
          </g>
        ))}
        <text x="99" y="240" textAnchor="middle" fontSize="9" style={mono} fill={AMBER}>this lab · agent/comments.md</text>
      </svg>
    </figure>
  );
}

/** Retrieval, step by step: the question is embedded, the nearest passages come back. */
function RetrieveFigure() {
  const step = (x: number, label: string, sub: string, color: string) => (
    <g key={label}>
      <rect x={x} y={30} width={168} height={56} rx={12} fill={tint(color, 0.07)} stroke={color} strokeOpacity="0.8" />
      <text x={x + 84} y={53} textAnchor="middle" fontSize="10.5" style={mono} fill={color}>{label}</text>
      <text x={x + 84} y={71} textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">{sub}</text>
    </g>
  );
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 760 116" className="h-auto w-full text-fg" role="img" aria-label="retrieval_query embeds the question with the corpus model, finds the nearest vectors, and returns their passages with an associated distance.">
        <defs>
          <marker id="rq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {step(6, "the question", "“small magic in the kitchen”", AMBER)}
        <line x1="174" y1="58" x2="196" y2="58" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#rq-arrow)" />
        {step(198, "embed", "the passages' own model", PURPLE)}
        <line x1="366" y1="58" x2="388" y2="58" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#rq-arrow)" />
        {step(390, "nearest vectors", "top_k = 5", GREEN)}
        <line x1="558" y1="58" x2="580" y2="58" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#rq-arrow)" />
        {step(582, "passages back", "text, with a distance each", CYAN)}
        <text x="375" y="104" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.6">one retrieval_query call · no model writes anything · the passages are the comments as written</text>
      </svg>
    </figure>
  );
}

function TheCorpus() {
  const [tick, setTick] = useState(0);
  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 7a · RAG Engine"
        color={CYAN}
        title="Grounding agents with RAG Engine."
        blurb="Retrieval-Augmented Generation grounds model reasoning on unstructured corpus data. Using GEAP RAG Engine, documents are ingested, chunked, and embedded into a managed vector store, enabling semantic passage retrieval during workflow execution."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Knowledge base</p>
          <h2 className="font-display mt-2 text-2xl">Context architecture across State, Memory Bank, and RAG.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Each context layer serves a distinct architectural purpose. Session State maintains transient run variables such as candidates and render receipts. Memory Bank stores consolidated episodic and profile facts for a given user. RAG Engine indexes external unstructured documents to support semantic similarity search.
          </p>
          <StoresFigure />
        </section>
      </In>

      <In delay={0.15}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Retrieval over documents</p>
              <h2 className="font-display mt-2 text-2xl">Semantic chunking and token efficiency.</h2>
              <p className="mt-2 text-sm text-fg-muted">
                Injecting massive document sets directly into prompt contexts degrades performance and escalates token costs. RAG decouples indexing from inference by pre-chunking source files and embedding them once into vector space. At runtime, targeted semantic queries retrieve only the top relevant passages, maintaining consistent context window utilization regardless of total corpus scale.
              </p>
            </div>
            <RetrievalFigure />
          </div>
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">How the search works</p>
          <h2 className="font-display mt-2 text-2xl">Dense embeddings and vector similarity.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            An embedding model maps text passages to dense numerical vectors in a high-dimensional semantic space. Semantically related concepts cluster together, overcoming vocabulary mismatch. Queries are embedded using the identical model, and vector distance metrics (cosine similarity) retrieve the nearest matching passages deterministically without relying on lexical keyword matches.
          </p>
          <div className="mt-4">
            <MeaningFigure />
          </div>
        </section>
      </In>

      <In delay={0.25}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">GEAP RAG Engine</p>
          <h2 className="font-display mt-2 text-2xl">Managed RAG infrastructure on Google Cloud.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            GEAP RAG Engine provides enterprise-grade, serverless vector search infrastructure. A corpus resource encapsulates the embedding model configuration (<code className="font-mono text-fg">text-embedding-005</code>) and managed vector indexing. Ingestion pipelines ingest documents from local sources or cloud storage, applying automated chunking and embedding.
          </p>
          <PlatformFigure />
          <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-input">
            <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">agent/platform/rag.py · create the corpus, upload the file</div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
              <code>{CODE_CORPUS}</code>
            </pre>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-fg-muted">
            <code className="font-mono text-fg">create_corpus</code> names the embedding model once; every passage and every question goes through it.{" "}
            <code className="font-mono text-fg">upload_file</code> takes a local path and a chunking config, about 120 tokens per passage, so a passage
            is two or three comments. The corpus name is cached in <code className="font-mono text-fg">runs/ragcorpus.json</code>.
          </p>
        </section>
      </In>

      <In delay={0.3}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Retrieve</p>
          <h2 className="font-display mt-2 text-2xl">Executing semantic similarity queries.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            The <code className="font-mono text-fg">retrieve</code> function executes a vector retrieval query against the corpus, projecting query text into vector space and retrieving the top-k nearest passages along with similarity scores and provenance metadata. The workflow invokes this function directly inside a reader node.
          </p>
          <RetrieveFigure />
          <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-input">
            <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">agent/platform/rag.py · retrieve</div>
            <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
              <code>{CODE_RETRIEVE}</code>
            </pre>
          </div>
        </section>
      </In>

      <In delay={0.4}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: CYAN }}>
            Console
          </p>
          <h2 className="font-display mt-2 text-2xl">Initialize RAG corpus and ingest document chunks.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Run the commands below to provision the corpus resource, upload audience comment documents with 120-token chunking, and test semantic retrieval against the indexed vector database.
          </p>
          <RagRunner onDone={() => setTick((t) => t + 1)} />
          <div className="flex flex-wrap gap-3">
            <SourceToggle path="agent/platform/rag.py" label="agent/platform/rag.py · the client and the console" />
            <SourceToggle path="agent/comments.md" label="agent/comments.md · the thirty comments" />
          </div>
        </section>
      </In>

      <In delay={0.5}>
        <CorpusLedger refreshKey={tick} />
      </In>
    </div>
  );
}

/* ───────────────────────── 7b ───────────────────────── */

const CODE_READ_FEEDBACK = `# agent/graph.py
def read_feedback(node_input):
    """The third reader: what the audience wrote under past videos,
    the passages nearest to tonight's idea. Retrieval, not a model call."""
    from . import rag
    idea = idea_text(node_input)
    query = idea or "what viewers liked and what they complained about"
    try:
        hits = rag.retrieve(query)
    except Exception as e:
        print(f"  [rag] feedback unavailable ({str(e)[:80]})")
        return Event(output={"query": query, "feedback": [],
                             "note": "no corpus connected - run: python -m agent.platform.rag"})
    return Event(output={"query": query, "feedback": [h["text"] for h in hits]})`;

const CODE_INSTRUCTION = `# agent/graph.py · PROPOSE_INSTRUCTION, the lines about the third key
"... read_feedback, when present, holds what the audience wrote under past "
"videos, the passages nearest to tonight's idea.\\n"
...
"If there is feedback, let it steer candidates 1 to 3: lean into what viewers "
"praised, avoid what they complained about, and name the comment in the angle.\\n"
...
"Every evidence entry must cite a REAL source: 'trends', 'backlog', 'feedback', ..."`;

const DEFAULT_RAG_IDEA = "tiny dragons in the kitchen";

/** The graph through step 7. The new reader is highlighted; the rest is step 6. */
function WorkflowFigure() {
  const node = (cx: number, cy: number, label: string, kind: "func" | "join" | "agent" | "human" | "router" | "task" | "new") => {
    const color = kind === "agent" || kind === "task" ? PURPLE : kind === "join" ? CYAN : kind === "human" ? AMBER : kind === "router" ? RED : kind === "new" ? CYAN : "currentColor";
    const lit = kind === "new";
    return (
      <g key={label}>
        {lit && <rect x={cx - 62} y={cy - 19} width="124" height="38" rx="11" fill="none" stroke={CYAN} strokeOpacity="0.35" strokeWidth="6" />}
        <rect x={cx - 56} y={cy - 13} width="112" height="26" rx="8" fill={lit ? tint(CYAN, 0.15) : kind === "func" ? "var(--overlay)" : tint(color, 0.08)} stroke={lit ? CYAN : kind === "func" ? "var(--hairline)" : color} strokeWidth={lit ? 1.6 : 1.1} />
        <text x={cx} y={cy + 4} fontSize="9.5" style={mono} textAnchor="middle" fill={lit ? CYAN : kind === "func" ? "currentColor" : color}>{label}</text>
      </g>
    );
  };
  const edge = (x1: number, y1: number, x2: number, y2: number, color = "currentColor") => <line key={`${x1}${y1}${x2}${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity={color === "currentColor" ? 0.55 : 0.9} strokeWidth={color === CYAN ? 1.8 : 1.2} markerEnd="url(#wf7-arrow)" />;
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 1016 260" className="h-auto w-full text-fg" role="img" aria-label="The workflow with audience feedback retrieval where START fans out to scan_trends, read_backlog and the new read_feedback, all into join_research, then propose_directions, direction_gate, persist_direction, policy_check routing OK to scripter and BLOCK to quarantine, which continues to scripter.">
        <defs>
          <marker id="wf7-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <circle cx="30" cy="120" r="12" fill="var(--overlay)" stroke="currentColor" strokeOpacity="0.6" />
        <text x="30" y="124" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor">START</text>
        {node(120, 60, "scan_trends", "func")}
        {node(120, 120, "read_backlog", "func")}
        {node(120, 190, "read_feedback", "new")}
        {node(245, 120, "join_research", "join")}
        {node(375, 120, "propose_directions", "agent")}
        {node(505, 120, "direction_gate", "human")}
        {node(635, 120, "persist_direction", "func")}
        {node(765, 120, "policy_check", "router")}
        {node(910, 65, "scripter", "agent")}
        {node(910, 195, "quarantine", "task")}
        {edge(42, 114, 62, 66)}
        {edge(42, 120, 62, 120)}
        {edge(42, 126, 62, 184, CYAN)}
        {edge(176, 60, 187, 114)}
        {edge(176, 120, 187, 120)}
        {edge(176, 190, 187, 126, CYAN)}
        {edge(301, 120, 317, 120)}
        {edge(431, 120, 447, 120)}
        {edge(561, 120, 577, 120)}
        {edge(691, 120, 707, 120)}
        {edge(821, 112, 852, 70, GREEN)}
        <text x="836" y="84" fontSize="8.5" style={mono} fill={GREEN}>OK</text>
        {edge(821, 128, 852, 190, RED)}
        <text x="828" y="170" fontSize="8.5" style={mono} fill={RED}>BLOCK</text>
        <path d="M966 195 C 995 195, 995 65, 968 65" fill="none" stroke={PURPLE} strokeOpacity="0.8" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#wf7-arrow)" />
        <text x="996" y="130" fontSize="8" style={mono} fill={PURPLE} textAnchor="middle" transform="rotate(90 996 130)">cleaned</text>
        <text x="120" y="232" fontSize="9" style={mono} textAnchor="middle" fill={CYAN}>the corpus, asked with tonight's idea</text>
        <text x="245" y="160" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">waits for three</text>
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">One edge is the whole change — START to read_feedback to the join. The join now waits for three readers.</figcaption>
    </figure>
  );
}

function useStage5() {
  const [status, setStatus] = useState<Stage5Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const { snapshot } = useRunEvents();
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.labStage5());
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    check();
  }, [check]);
  useEffect(() => {
    if (snapshot) check();
  }, [snapshot?.updated_at, check]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [open, check]);
  return { status, checking, check, open, setOpen };
}



/** The node at work: the idea goes to the corpus, the nearest passages come back into the bundle. */
function NodeRetrievalFigure() {
  const box = (x: number, y: number, w: number, h: number, label: string, sub: string, color: string) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={tint(color, 0.07)} stroke={color} strokeOpacity="0.8" />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize="11" style={mono} fill={color}>{label}</text>
      <text x={x + w / 2} y={y + 39} textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">{sub}</text>
    </g>
  );
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 760 214" className="h-auto w-full text-fg" role="img" aria-label="read_feedback takes tonight's idea, calls rag.retrieve, the corpus returns the nearest passages, and the node hands them to the join as the feedback key.">
        <defs>
          <marker id="nr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {box(6, 24, 176, 56, "tonight's idea", "“tiny dragons in the kitchen”", AMBER)}
        <line x1="182" y1="52" x2="248" y2="52" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#nr-arrow)" />
        <text x="215" y="44" textAnchor="middle" fontSize="8" style={mono} fill="currentColor" opacity="0.6">node_input</text>
        {box(250, 24, 156, 56, "read_feedback", "a function node", CYAN)}
        <line x1="406" y1="44" x2="516" y2="44" stroke={CYAN} strokeWidth="1.4" markerEnd="url(#nr-arrow)" />
        <text x="461" y="36" textAnchor="middle" fontSize="8.5" style={mono} fill={CYAN}>rag.retrieve(query)</text>
        <line x1="516" y1="62" x2="406" y2="62" stroke={GREEN} strokeWidth="1.4" markerEnd="url(#nr-arrow)" />
        <text x="461" y="76" textAnchor="middle" fontSize="8.5" style={mono} fill={GREEN}>Five passages</text>
        <rect x="518" y="10" width="236" height="88" rx="14" fill="var(--overlay)" stroke={CYAN} strokeOpacity="0.5" />
        <text x="636" y="30" textAnchor="middle" fontSize="9.5" style={mono} fill={CYAN}>RAG Engine · vibestudio-feedback</text>
        {[0, 1, 2, 3, 4].map((k) => (
          <rect key={k} x={531 + k * 42} y={44} width={34} height={22} rx={5} fill="var(--card)" stroke={k === 1 || k === 3 ? GREEN : "var(--hairline)"} strokeWidth={k === 1 || k === 3 ? 1.4 : 1} />
        ))}
        <text x="636" y="86" textAnchor="middle" fontSize="8.5" style={mono} fill="currentColor" opacity="0.65">passages, found by meaning</text>
        <path d="M326 80 L 326 118" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#nr-arrow)" />
        <text x="338" y="104" fontSize="8" style={mono} fill="currentColor" opacity="0.6">Event(output=...)</text>
        {box(190, 120, 274, 56, "join_research", "{ scan_trends, read_backlog, read_feedback }", PURPLE)}
        <line x1="464" y1="148" x2="514" y2="148" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#nr-arrow)" />
        {box(516, 120, 176, 56, "propose_directions", "reads all three keys", PURPLE)}
        <text x="380" y="204" textAnchor="middle" fontSize="9" style={mono} fill="currentColor" opacity="0.6">the comments arrive as text in the bundle, cited as 'feedback' in the candidates' evidence</text>
      </svg>
    </figure>
  );
}

function TheReader() {
  const [idea, setIdea] = useState(DEFAULT_RAG_IDEA);
  const [hint, setHint] = useState(0);
  const { status, checking, check, open, setOpen } = useStage5();
  const wired = status?.feedback_wired ?? false;
  const ran = status?.feedback_ran ?? false;
  const passages = status?.feedback_passages ?? [];
  const proposed = status?.proposed ?? [];
  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 7b · The third reader"
        color={CYAN}
        title="Expanding the research fan-out."
        blurb="Integrate semantic corpus retrieval directly into the parallel execution fan-out. By appending read_feedback as a third concurrent reader node, the join synchronizes structured feedback alongside trends and backlog data before direction synthesis."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The graph</p>
          <h2 className="font-display mt-2 text-2xl">Parallel synchronization with three reader nodes.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Research nodes executing prior to proposal generation operate in parallel fan-out chains. Adding an edge from START through <code className="font-mono text-fg">read_feedback</code> to <code className="font-mono text-fg">join_research</code> configures the join node to synchronize all three inputs into a unified dictionary.
          </p>
          <WorkflowFigure />
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The node</p>
          <h2 className="font-display mt-2 text-2xl">Deterministic semantic retrieval node.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            <code className="font-mono text-fg">read_feedback</code> extracts the input idea, issues a vector query via <code className="font-mono text-fg">rag.retrieve</code>, and emits the top 5 passages as node output. If no idea is provided, it falls back to a baseline audience feedback query. Built-in error handling returns an empty set if the corpus is unreachable, preventing workflow aborts.
          </p>
          <NodeRetrievalFigure />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">agent/graph.py · read_feedback</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
                <code>{CODE_READ_FEEDBACK}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">agent/platform/rag.py · retrieve</div>
              <pre className="max-h-80 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
                <code>{CODE_RETRIEVE}</code>
              </pre>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-input">
            <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">agent/graph.py · what propose_directions is told about the new key</div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
              <code>{CODE_INSTRUCTION}</code>
            </pre>
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <EditPanel
          label="Edit 1 of 1"
          title="Append read_feedback to the parallel fan-out."
          intro={
            <>
              In <code className="font-mono text-fg">stage5_rag/agent.py</code>, extend the workflow edge list by adding the third concurrent chain tuple <code className="font-mono text-fg">(START, read_feedback, join_research)</code>.
            </>
          }
          pill={status ? (wired ? "read_feedback enters the join ✓" : "two readers into the join") : "…"}
          ok={wired}
          hint={hint}
          setHint={setHint}
          hint1={<>Add a third tuple with the same shape as the first two, starting at <code className="font-mono">START</code> and ending at <code className="font-mono">join_research</code>.</>}
          hint2={`    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (START, read_feedback, join_research),
           (join_research, propose_directions, direction_gate,
            persist_direction, policy_check),
           (policy_check, {"OK": scripter, "BLOCK": quarantine}),
           (quarantine, scripter)])`}
          path="stage5_rag/agent.py"
          symbol="root_agent"
          pattern={/TODO: RAG_NODE|read_feedback, join_research\)/}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <LoadCheck app="stage5_rag" intro="Save, then verify module loading to confirm the updated edge list and reader imports compile cleanly." />
      </In>

      <In delay={0.4}>
        <RunPanel
          app="stage5_rag"
          open={open}
          setOpen={setOpen}
          title="Execute workflow and inspect multi-source research."
          intro="Submit an idea prompt to observe parallel execution across all three research readers. The join consolidates the three streams into a unified research bundle that steers candidate proposal generation."
          idea={idea}
          setIdea={setIdea}
          steps={[
            "Open the read_feedback event to verify the query matches your idea, with the output containing the five nearest passages. Open join_research to confirm the bundle includes the third key. Then inspect propose_directions to observe candidates 1 to 3 aligning with audience feedback citations.",
            "Pick one candidate and let the run finish. Then submit the same idea again to compare. The retrieved passages remain identical while the proposed candidates vary, demonstrating deterministic retrieval paired with probabilistic generation.",
          ]}
        />
      </In>

      <In delay={0.5}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from runs/ragcorpus.json, this step's app file, and the latest stage5_rag session's events.">
          <CheckRow ok={status?.corpus_connected ?? false} label="a corpus is connected">
            {status ? (status.corpus_connected ? "runs/ragcorpus.json names it." : "Run the first command in 7a.") : "…"}
          </CheckRow>
          <CheckRow ok={wired} label="read_feedback enters the join">
            {status ? (wired ? "(START, read_feedback, join_research) is in the edge list." : "The edit above.") : "…"}
          </CheckRow>
          <CheckRow ok={ran && passages.length > 0} label="read_feedback ran and retrieved passages">
            {ran ? (passages.length ? `query · ${status?.feedback_query} · ${passages.length} passages · first · ${passages[0].slice(0, 90)}…` : status?.feedback_note || "ran, but no passages came back") : "No run yet."}
          </CheckRow>
          <CheckRow ok={status?.cited_feedback ?? false} label="a candidate cites feedback">
            {proposed.length ? (status?.cited_feedback ? "Yes. The model chose how; another run may cite it elsewhere." : "Not in this run. The model is not obliged to; run again.") : "No candidates yet."}
          </CheckRow>
          {proposed.length ? (
            <li className="md:col-span-2 rounded-2xl border border-hairline bg-overlay p-3 text-xs">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">the latest candidates and their sources</p>
              <ol className="mt-2 space-y-1.5">
                {proposed.map((c, i) => (
                  <li key={`${c.title}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-fg-muted">{i + 1}.</span>
                    <span className="text-fg">{c.title}</span>
                    <span className="font-mono text-[10px] text-fg-muted">{c.sources.join(" · ") || "no evidence"}</span>
                  </li>
                ))}
              </ol>
            </li>
          ) : null}
        </VerifyPanel>
      </In>
    </div>
  );
}
