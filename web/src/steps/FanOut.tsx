import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Copy, ExternalLink, Lightbulb, RefreshCw, TerminalSquare, X } from "lucide-react";
import { CodeEditor } from "../components/CodeEditor";
import { In, StepHeader } from "../components/shared";
import { LoadCheck } from "../components/LoadCheck";
import { LoadedBadge } from "../components/LoadedBadge";
import { api, useRunEvents } from "../lib/api";
import type { InspectorStatus, Stage1Status, Stage2Status } from "../lib/types";
import { COLORS, tint } from "./colors";

/*
 * Step 4, in parts:
 *   4a  the ADK graph: nodes, edges, one node set reused by several graphs,
 *       and a write-the-edges exercise on the stage 1 graph
 *   4b  declare those edges in stage1_fanout/agent.py, run, verify
 *   4c  the agent node: define propose_directions in the stage 2 file and
 *       start the chain from the join; run, read the typed candidates
 *   4d  human in the loop: add direction_gate to the stage 2 chain, then the
 *       RequestInput yield in the node; the anatomy of RequestInput; run after each edit
 */

const AMBER = COLORS.amber;
const BLUE = COLORS.blue;
const PURPLE = COLORS.purple;
const CYAN = COLORS.cyan;
const GREEN = COLORS.green;
const RED = COLORS.red;

type Part = "a" | "b" | "c" | "d";
const PARTS: { id: Part; label: string }[] = [
  { id: "a", label: "Graph architecture and execution chains" },
  { id: "b", label: "Parallel research fan-out" },
  { id: "c", label: "Agent nodes" },
  { id: "d", label: "Human-in-the-loop" },
];

export function FanOut() {
  const { part: partParam } = useParams();
  const part: Part = PARTS.some((p) => p.id === partParam) ? (partParam as Part) : "a";
  const idx = PARTS.findIndex((p) => p.id === part);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [part]);

  return (
    <div className="space-y-8">
      {part === "a" && <GraphIntro />}
      {part === "b" && <DeclareFanOut />}
      {part === "c" && <AgentNode />}
      {part === "d" && <HumanInTheLoop />}

      <div className="flex items-center justify-center gap-3 pt-2">
        {idx > 0 ? (
          <Link to={`/step/fan-out/${PARTS[idx - 1].id}`} className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-fg-muted hover:text-fg">
            ← 4{PARTS[idx - 1].id} · {PARTS[idx - 1].label}
          </Link>
        ) : (
          <span />
        )}
        {idx < PARTS.length - 1 && (
          <Link to={`/step/fan-out/${PARTS[idx + 1].id}`} className="flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-white" style={{ background: AMBER }}>
            Continue to 4{PARTS[idx + 1].id} · {PARTS[idx + 1].label} <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── 4a ───────────────────────── */

const NODE_KINDS = [
  { name: "Function node", color: "var(--fg)", code: "def scan_trends(node_input): ...", note: "Plain Python. Returns Event(output=...) and may write shared state with Event(state=...)." },
  { name: "Agent node", color: PURPLE, code: "propose_directions = Agent(...)", note: "An LLM call. Used as a node it runs in single_turn mode: one call, structured output, no conversation." },
  { name: "JoinNode", color: CYAN, code: 'JoinNode(name="join_research")', note: "Waits until every incoming branch has reported, then passes all their outputs on as one dict." },
  { name: "Router", color: RED, code: 'return Event(output=..., route="OK")', note: "A function node whose return names the outgoing edge. The edge list maps each route name to a destination." },
  { name: "Human input node", color: AMBER, code: "yield RequestInput(response_schema=...)", note: "Suspends the graph until a person answers. The schema is what a frontend renders as a form." },
];

const EDGE_GRAMMAR = `edges=[
    (START, scan_trends, join_research),        # a chain: START, then scan_trends, then the join
    (START, read_backlog, join_research),   # a second chain from START: the two readers fan out
    (join_research, propose_directions,         # two chains arrive at the JoinNode: it waits for both
     direction_gate, persist_direction,
     policy_check),
    (policy_check, {"OK": scripter,             # a dict target: the router's route name picks the edge
                    "BLOCK": quarantine}),
    (quarantine, scripter),                     # the cleaned direction rejoins the main line
    (scripter, render_desk, store_video),       # video generation: the render, then its result
]`;

function GraphIntro() {
  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 4a · Graph architecture and execution chains"
        color={AMBER}
        title="Nodes and edges."
        blurb="An ADK Workflow structures execution as a directed graph. Nodes represent discrete units of work, and edges define deterministic sequencing. The edge list governs orchestration, constraining model execution to dedicated nodes."
      />

      <In delay={0.1}>
        <section className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
          <div className="rounded-3xl border border-hairline bg-card p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Node kinds in this lab</p>
            <ul className="mt-4 space-y-3">
              {NODE_KINDS.map((k, i) => (
                <motion.li key={k.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.07 }} className="rounded-2xl border border-hairline bg-overlay p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold" style={{ color: k.color }}>
                      {k.name}
                    </span>
                    <code className="truncate font-mono text-[10.5px] text-fg-muted">{k.code}</code>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{k.note}</p>
                </motion.li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-3xl border border-hairline bg-card">
            <div className="border-b border-hairline bg-overlay px-4 py-2 font-mono text-[11px] text-fg-muted">agent/graph.py · the production edge list, annotated</div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
              <code>{EDGE_GRAMMAR}</code>
            </pre>
            <div className="overflow-x-auto border-t border-hairline px-4 py-3">
              <EdgeShapesFigure />
            </div>
            <div className="border-t border-hairline px-4 py-3 text-xs text-fg-muted">
              <p>Workflows declare the edge topology in code. The ADK runtime traverses the graph, coordinates concurrent branch execution, and persists each node's output event into the session journal.</p>
            </div>
          </div>
        </section>
      </In>

      <In delay={0.35}>
        <EdgesExercise />
      </In>
    </div>
  );
}

/* the four shapes an edge entry can take, drawn from the production list */
function EdgeShapesFigure() {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  const mono = { fontFamily: "var(--font-mono)" } as const;
  const node = (x: number, y: number, w: number, label: string, color?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={22} rx={7} fill={color ? tint(color, 0.1) : box.fill} stroke={color ?? box.stroke} strokeWidth={color ? 1.3 : 1} />
      <text x={x + w / 2} y={y + 15} fontSize="9" style={mono} textAnchor="middle" fill={color ?? "currentColor"}>{label}</text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, color = "currentColor") => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
  );
  const entry = (x: number, y: number, text: string) => (
    <text x={x} y={y} fontSize="8.5" style={mono} fill="currentColor" opacity="0.75">{text}</text>
  );
  const caption = (x: number, y: number, text: string, color?: string) => (
    <text x={x} y={y} fontSize="8.5" style={mono} fill={color ?? "currentColor"} opacity={color ? 1 : 0.7}>{text}</text>
  );
  return (
    <figure className="m-0 min-w-[520px]">
      <svg viewBox="0 0 640 330" role="img" aria-label="The four shapes an edge entry takes. A chain: START, scan_trends, join_research run in that order. Two entries from the same source: scan_trends and read_backlog both start when START finishes, at the same time. Two chains arriving at a JoinNode: join_research waits for both, then one chain continues. A dictionary target: policy_check's route name, OK or BLOCK, picks which edge is taken." className="h-auto w-full text-fg">
        <defs>
          <marker id="eg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <line x1="320" y1="8" x2="320" y2="322" stroke="var(--hairline)" />
        <line x1="10" y1="166" x2="630" y2="166" stroke="var(--hairline)" />

        {/* 1 · a chain */}
        {entry(12, 22, "(START, scan_trends, join_research)")}
        {node(12, 66, 50, "START")}
        {arrow(62, 77, 96, 77)}
        {node(98, 66, 92, "scan_trends")}
        {arrow(190, 77, 224, 77)}
        {node(226, 66, 84, "join_research", CYAN)}
        {caption(12, 116, "one entry, left to right:")}
        {caption(12, 128, "each node starts when the one before it is done")}

        {/* 2 · two entries from one source */}
        {entry(332, 22, "(START, scan_trends, …)")}
        {entry(332, 34, "(START, read_backlog, …)")}
        {node(332, 66, 50, "START")}
        <path d="M382 77 C 404 77, 404 55, 424 55" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        <path d="M382 77 C 404 77, 404 99, 424 99" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        {node(426, 44, 92, "scan_trends")}
        {node(426, 88, 92, "read_backlog")}
        {caption(332, 128, "the same source in two entries:")}
        {caption(332, 140, "both start the moment START is done, at the same time", GREEN)}

        {/* 3 · arriving at a JoinNode */}
        {entry(12, 186, "(START, scan_trends, join_research)")}
        {entry(12, 198, "(START, read_backlog, join_research)")}
        {entry(12, 210, "(join_research, propose_directions, …)")}
        {node(12, 226, 72, "scan_trends")}
        {node(12, 264, 72, "read_backlog")}
        <path d="M84 237 C 100 237, 100 256, 108 256" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        <path d="M84 275 C 100 275, 100 256, 108 256" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        {node(110, 245, 82, "join_research", CYAN)}
        {arrow(192, 256, 210, 256, CYAN)}
        {node(212, 245, 102, "propose_directions", PURPLE)}
        {caption(12, 308, "the join waits for every entry that ends in it,", CYAN)}
        {caption(12, 320, "then the entry that starts from it continues")}

        {/* 4 · a dict target */}
        {entry(332, 186, "(policy_check, {\"OK\": scripter,")}
        {entry(412, 198, "\"BLOCK\": quarantine})")}
        {node(332, 245, 84, "policy_check", RED)}
        <path d="M416 256 C 440 256, 440 234, 462 234" fill="none" stroke={GREEN} strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        <path d="M416 256 C 440 256, 440 278, 462 278" fill="none" stroke={RED} strokeWidth="1.1" markerEnd="url(#eg-arrow)" />
        <text x="440" y="230" fontSize="8" style={mono} fill={GREEN} textAnchor="middle">"OK"</text>
        <text x="440" y="292" fontSize="8" style={mono} fill={RED} textAnchor="middle">"BLOCK"</text>
        {node(464, 223, 72, "scripter", PURPLE)}
        {node(464, 267, 72, "quarantine", PURPLE)}
        {caption(332, 308, "the router returns a route name;")}
        {caption(332, 320, "the dict says which edge that name takes", RED)}
      </svg>
    </figure>
  );
}

/* the write-the-edges exercise: the stage 1 graph */

interface GNode {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  sub?: string;
}
const GNODES: GNode[] = [
  { id: "START", label: "START", color: "var(--fg-muted)", x: 10, y: 50 },
  { id: "scan_trends", label: "scan_trends", color: "var(--fg)", x: 42, y: 22, sub: "function node" },
  { id: "read_backlog", label: "read_backlog", color: "var(--fg)", x: 42, y: 78, sub: "function node" },
  { id: "join_research", label: "join_research", color: CYAN, x: 78, y: 50, sub: "JoinNode" },
];
const GEDGES: [string, string][] = [
  ["START", "scan_trends"],
  ["START", "read_backlog"],
  ["scan_trends", "join_research"],
  ["read_backlog", "join_research"],
];

interface Cand {
  id: string;
  code: string;
  correct: boolean;
  why: string;
}
const CANDS: Cand[] = [
  { id: "c1", code: "(START, scan_trends, join_research)", correct: true, why: "One chain: START, then scan_trends, then the join." },
  { id: "c2", code: "(START, read_backlog, join_research)", correct: true, why: "A second chain from START. Two chains leaving START run in parallel." },
  { id: "d1", code: "(START, scan_trends, read_backlog, join_research)", correct: false, why: "One chain runs its nodes in order. This makes the readers sequential; the graph runs them in parallel." },
  { id: "d2", code: "(join_research, scan_trends)", correct: false, why: "Reversed. Edges run left to right; a reader reports to the join, it does not run after it." },
  { id: "d3", code: "(START, join_research)", correct: false, why: "The join has nothing to wait for. The readers never run." },
  { id: "d5", code: "(START, scan_trends)", correct: false, why: "Half a chain. scan_trends would finish and nothing would carry its output into the join." },
];
const CORRECT = CANDS.filter((c) => c.correct).length;

function shuffled<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function EdgesExercise() {
  const [deck] = useState(() => shuffled(CANDS));
  const [placed, setPlaced] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const done = placed.length === CORRECT;
  const pool = deck.filter((c) => !placed.includes(c.id));

  const pick = (c: Cand) => {
    if (c.correct) {
      setPlaced((p) => [...p, c.id]);
      setRejected(null);
    } else {
      setRejected(c.id);
    }
  };

  const W = 720;
  const H = 210;
  const pos = (id: string) => {
    const n = GNODES.find((g) => g.id === id)!;
    return { x: (n.x / 100) * W, y: (n.y / 100) * H };
  };

  return (
    <section className="rounded-3xl border p-6" style={{ borderColor: tint(AMBER, 0.4), background: tint(AMBER, 0.04) }}>
      <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: AMBER }}>
        Exercise
      </p>
      <h2 className="font-display mt-2 text-2xl">Write the edges.</h2>
      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        Read the stage 1 graph, then click the {CORRECT} entries that describe it. {CANDS.length - CORRECT} of the options
        describe a different graph; each one explains what it would change.
      </p>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-card">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[720px]" role="img" aria-label="START fans out to scan_trends and read_backlog, both join at join_research">
          <defs>
            <marker id="fo-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-muted)" />
            </marker>
          </defs>
          {GEDGES.map(([a, b]) => {
            const p = pos(a);
            const q = pos(b);
            const x1 = p.x + 62;
            const x2 = q.x - 62;
            const mx = (x1 + x2) / 2;
            return <path key={`${a}-${b}`} d={`M${x1},${p.y} C${mx},${p.y} ${mx},${q.y} ${x2},${q.y}`} fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" markerEnd="url(#fo-arrow)" />;
          })}
          {GNODES.map((n) => {
            const p = pos(n.id);
            const start = n.id === "START";
            return (
              <g key={n.id}>
                {start ? (
                  <circle cx={p.x} cy={p.y} r="24" fill="var(--overlay)" stroke="var(--fg-muted)" strokeWidth="1.5" />
                ) : (
                  <rect x={p.x - 62} y={p.y - 22} width="124" height="44" rx="10" fill={n.id === "join_research" ? tint(CYAN, 0.09) : "var(--overlay)"} stroke={n.id === "join_research" ? CYAN : "var(--hairline)"} strokeWidth="1.5" />
                )}
                <text x={p.x} y={p.y + (n.sub ? -1 : 4)} textAnchor="middle" fontSize="11.5" fontFamily="var(--font-mono)" fill={n.color}>
                  {n.label}
                </text>
                {n.sub && (
                  <text x={p.x} y={p.y + 13} textAnchor="middle" fontSize="9" fill="var(--fg-muted)">
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border-2 border-dashed" style={{ borderColor: done ? GREEN : "var(--hairline)", background: "var(--card)" }}>
          <p className="border-b border-hairline bg-overlay px-3 py-1.5 font-mono text-[10px] text-fg-muted">stage1_fanout/agent.py · edges</p>
          <div className="px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
            <p>edges=[</p>
            {placed.map((id) => {
              const c = CANDS.find((x) => x.id === id)!;
              return (
                <motion.div key={id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="pl-4">
                  <span style={{ color: GREEN }}>{c.code},</span>
                  <span className="ml-2 font-sans text-[10px] text-fg-muted">{c.why}</span>
                </motion.div>
              );
            })}
            {Array.from({ length: CORRECT - placed.length }).map((_, i) => (
              <p key={i} className="pl-4 text-fg-muted opacity-40">
                …
              </p>
            ))}
            <p>]</p>
          </div>
          {done && (
            <p className="border-t border-hairline px-3 py-2 text-xs" style={{ color: GREEN }}>
              Complete. 4b writes them into stage1_fanout/agent.py and runs it.
            </p>
          )}
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            candidates · click the right ones ({placed.length}/{CORRECT})
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {pool.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c)}
                className="rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11.5px] transition-colors hover:bg-overlay"
                style={{ borderColor: rejected === c.id ? RED : "var(--hairline)", color: rejected === c.id ? RED : "var(--fg)", background: "var(--card)" }}
              >
                {c.code}
              </button>
            ))}
          </div>
          <AnimatePresence>
            {rejected && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 text-[11.5px] leading-snug" style={{ color: RED }}>
                {CANDS.find((c) => c.id === rejected)!.why}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── 4b ───────────────────────── */

export const DEFAULT_IDEA = "a tiny robot doing laundry at midnight";

const READER_CODE = `# agent/graph.py
def scan_trends(node_input):
    from .trends import sample_trends
    return Event(output={"trends": sample_trends()})     # ten of 250, at random


def read_backlog(node_input):
    return Event(output={"backlog": backlog_notes(),      # agent/backlog.txt, 15 notes
                         "idea": idea_text(node_input)})  # tonight's idea, from your message`;

const JOIN_CODE = `from google.adk.workflow import JoinNode

# defined, not written: a JoinNode has no body
join_research = JoinNode(name="join_research")

# its output, once both readers have reported,
# is one dict keyed by node name:
# {"scan_trends":  {"trends": [...10 topics...]},
#  "read_backlog": {"backlog": [...15 notes...], "idea": "..."}}`;

const STAGE1_NODES = [
  { name: "scan_trends", kind: "function node", color: "var(--fg)", what: "Reads what is trending: ten of 250 trends, each a format paired with a look, with a heat score. A different ten every run." },
  { name: "read_backlog", kind: "function node", color: "var(--fg)", what: "Reads the creator's backlog, fifteen ideas in agent/backlog.txt, and takes tonight's idea from your message. Both travel together into the join." },
  { name: "join_research", kind: "JoinNode", color: CYAN, what: "Built into ADK. Waits until every incoming branch has reported, then passes all of their outputs on as one dict." },
];

/** The stage 1 graph as a static picture: what 4b builds. */
function Stage1Graph() {
  const W = 640;
  const H = 190;
  const pos = (id: string) => {
    const n = GNODES.find((g) => g.id === id)!;
    return { x: (n.x / 100) * W, y: (n.y / 100) * H };
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[640px]" role="img" aria-label="START fans out to scan_trends and read_backlog, two function nodes; both feed join_research, a JoinNode.">
      <defs>
        <marker id="s1-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-muted)" />
        </marker>
      </defs>
      {GEDGES.map(([a, b]) => {
        const p = pos(a);
        const q = pos(b);
        const x1 = p.x + (a === "START" ? 26 : 66);
        const x2 = q.x - 66;
        const mx = (x1 + x2) / 2;
        return <path key={`${a}-${b}`} d={`M${x1},${p.y} C${mx},${p.y} ${mx},${q.y} ${x2},${q.y}`} fill="none" stroke="var(--fg-muted)" strokeWidth="1.5" markerEnd="url(#s1-arrow)" />;
      })}
      {GNODES.map((n) => {
        const p = pos(n.id);
        if (n.id === "START")
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r="24" fill="var(--overlay)" stroke="var(--fg-muted)" strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">START</text>
            </g>
          );
        const join = n.id === "join_research";
        return (
          <g key={n.id}>
            <rect x={p.x - 66} y={p.y - 24} width="132" height="48" rx="10" fill={join ? tint(CYAN, 0.09) : "var(--overlay)"} stroke={join ? CYAN : "var(--hairline)"} strokeWidth="1.5" />
            <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill={n.color}>{n.label}</text>
            <text x={p.x} y={p.y + 14} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--fg-muted)">{n.sub}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DeclareFanOut() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [open, setOpen] = useState(false);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const [status, setStatus] = useState<Stage1Status | null>(null);
  const [checking, setChecking] = useState(false);
  const { snapshot } = useRunEvents();

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.labStage1());
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
    // the dev UI writes to sessions.db outside this server's run loop; poll
    // while it is open so the verify rows follow the student's run
    if (!open) return;
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [open, check]);

  const joinOk = status?.join_defined ?? false;
  const wired = status?.edges_complete ?? false;

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 4b · Parallel research fan-out"
        color={AMBER}
        title="Build the research fan-out."
        blurb="Coordinate concurrent research retrieval across platform trends and backlog ideas. Instantiate an ADK JoinNode to synchronize parallel reader branches and consolidate incoming payloads into a unified research dictionary."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The graph to build</p>
          <h2 className="font-display mt-2 text-2xl">Both readers run, then the join releases.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            The graph enforces deterministic research retrieval. Both reader chains originate at START, ensuring both
            execute concurrently on every run. The join barrier synchronizes the branches and passes an aggregated
            dictionary to downstream nodes.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-hairline bg-overlay py-2">
            <Stage1Graph />
          </div>
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The nodes</p>
          <h2 className="font-display mt-2 text-2xl">Function nodes and a join.</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {STAGE1_NODES.map((n) => (
              <div key={n.name} className="rounded-2xl border border-hairline bg-overlay p-4">
                <div className="font-mono text-sm font-semibold" style={{ color: n.color }}>
                  {n.name}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">{n.kind}</div>
                <p className="mt-2 text-xs text-fg-muted">{n.what}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The readers · function nodes</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{READER_CODE}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Defining a JoinNode</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{JOIN_CODE}</code>
              </pre>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fg-muted">
            Nothing reformats the join's dict. The node after it, in 4c, is an agent, and an agent node receives its{" "}
            <code className="font-mono text-fg">node_input</code> as its message: a dict arrives as JSON, which the model reads directly.
          </p>
        </section>
      </In>

      <In delay={0.3}>
        <EditPanel
          label="Edit 1 of 2"
          title="Define the join."
          intro={<>Only the <code className="font-mono text-fg">join_research</code> line is shown. Replace <code className="font-mono text-fg">None</code> with a JoinNode.</>}
          pill={status ? (joinOk ? "join defined ✓" : "join_research is None") : "…"}
          ok={joinOk}
          hint={hintA}
          setHint={setHintA}
          hint1={<>The constructor takes one argument, <code className="font-mono">name</code>. Use the node's own name so the map and the event list read well.</>}
          hint2={`join_research = JoinNode(name="join_research")`}
          path="stage1_fanout/agent.py"
          symbol="join_research"
          pattern={/join_research = /}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <EditPanel
          label="Edit 2 of 2"
          title="Replace the empty list with the chains."
          intro={
            <>
              Only the <code className="font-mono text-fg">Workflow</code> is shown. Each chain is a tuple of nodes that run in order;
              two chains leaving <code className="font-mono text-fg">START</code> run in parallel, and both end at your join.
            </>
          }
          pill={status ? (wired ? "edges complete ✓" : `edges found: ${status.edges.length}`) : "…"}
          ok={wired}
          hint={hintB}
          setHint={setHintB}
          hint1={
            <>
              Two tuples inside the list. Both start with <code className="font-mono">START</code> and end at{" "}
              <code className="font-mono">join_research</code>; one goes through each reader.
            </>
          }
          hint2={`root_agent = Workflow(
    name="stage1_fanout",
    description="2 real readers -> join -> one research dict",
    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research)])`}
          path="stage1_fanout/agent.py"
          symbol="root_agent"
          pattern={/^\s*edges=/}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <LoadCheck app="stage1_fanout" intro="Save both edits, then click the button. It loads stage1_fanout the way adk web will and tells you either that it loads or what ADK objects to." />
      </In>

      <In delay={0.4}>
        <RunPanel
          app="stage1_fanout"
          open={open}
          setOpen={setOpen}
          title="Run the workflow in adk web."
          intro="The dev UI opens with stage1_fanout selected. It draws the graph from your edge list, and each node's output arrives as its own event. No model call in this stage."
          idea={idea}
          setIdea={setIdea}
          steps={[
            "Two nodes light together on the map, then the join.",
            "Open join_research's event. Its output is one dict: a scan_trends key with ten trending topics, and a read_backlog key with the fifteen backlog notes and your idea.",
          ]}
        />
      </In>

      <In delay={0.5}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from the file and the stage1_fanout sessions in runs/sessions.db. Every node's output is an event; these rows count them.">
          <CheckRow ok={joinOk} label="join_research is a JoinNode">
            {status ? (joinOk ? "JoinNode(name=...) found in the file." : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={wired} label="The two edges are in the file">
            {status ? (wired ? "START → both readers → join_research" : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={!!status && status.runs > 0} label="The workflow ran">
            {status ? `${status.runs} run${status.runs === 1 ? "" : "s"} reached the join` : "…"}
          </CheckRow>
          <CheckRow ok={!!status?.readers_ran} label="Both readers ran">
            {status?.nodes_ran.length ? `events from: ${status.nodes_ran.join(", ")}` : "No node events yet."}
          </CheckRow>
          <CheckRow ok={!!status?.joined} label="The join fired once with both outputs">
            {status ? (status.joined ? "join_research produced its dict." : "Not yet.") : "…"}
          </CheckRow>
          <CheckRow ok={(status?.backlog_count ?? 0) > 0} label="The backlog reached the join">
            {status?.backlog_count == null ? "Run first." : `${status.backlog_count} notes from agent/backlog.txt, with your idea`}
          </CheckRow>
          {status?.bundle ? (
            <li className="md:col-span-2 overflow-hidden rounded-2xl border border-hairline bg-overlay">
              <p className="border-b border-hairline px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">join_research output · the research dict</p>
              <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-fg">{status.bundle}</pre>
            </li>
          ) : null}
        </VerifyPanel>
      </In>
    </div>
  );
}

/* ───────────────────────── 4c ───────────────────────── */

const CODE_REQUEST_INPUT_SAMPLE = `yield RequestInput(
    # what the person reads
    message="Approve this thumbnail?",
    # the form, and the contract for the next node
    response_schema={
        "type": "object",
        "properties": {
            "approve": {"type": "string", "enum": ["yes", "no"]},
            "note": {"type": "string"}}},
    # data for a frontend to show
    payload={"thumbnail_url": url})`;

const REQUEST_INPUT_FIELDS = [
  { f: "message", what: "The prompt shown to the person." },
  { f: "response_schema", what: "A JSON schema. adk web renders it as the form, and ADK validates the answer against it before the graph resumes. Here one field, pick." },
  { f: "payload", what: "Data that travels with the request for a frontend to display. Here the candidates. adk web ignores it; VibeStudio reads it during execution." },
  { f: "interrupt_id", what: "ADK assigns it when the yield runs." },
];

const SCHEMA_PROPERTIES = `"properties": {
    "pick": {"type": "string", "enum": ["1", "2", "3", "4"]}}`;

/** The response_schema as a picture: two properties, the form they become,
 *  the answer they validate, and the node that reads it. */
function SchemaFigure() {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  return (
    <figure className="m-0">
      <svg viewBox="0 0 620 250" role="img" aria-label="response_schema has one property, pick; adk web renders it as a form; the validated answer is a dict with the same key, which persist_direction reads by name." className="h-auto w-full text-fg" style={{ maxWidth: "100%" }}>
        <defs>
          <marker id="rs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {/* schema */}
        <rect x="8" y="20" width="196" height="118" rx="12" {...box} />
        <text x="20" y="42" fontSize="11" fontFamily="var(--font-mono)" fill={AMBER}>response_schema</text>
        <text x="20" y="60" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7">"type": "object"</text>
        <rect x="20" y="70" width="172" height="26" rx="6" fill="none" stroke={AMBER} strokeOpacity="0.6" />
        <text x="28" y="87" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor">pick: 1 | 2 | 3 | 4</text>
        <text x="20" y="122" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.6">not required; blank means 1</text>
        {/* form */}
        <rect x="256" y="20" width="160" height="118" rx="12" {...box} />
        <text x="268" y="42" fontSize="11" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.8">the form in adk web</text>
        <text x="268" y="66" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7">pick</text>
        <rect x="268" y="72" width="136" height="20" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.4" />
        <text x="276" y="86" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor">2</text>
        <rect x="268" y="108" width="52" height="20" rx="4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.4" />
        <text x="294" y="122" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" textAnchor="middle">Submit</text>
        {/* answer */}
        <rect x="468" y="20" width="144" height="118" rx="12" {...box} />
        <text x="480" y="42" fontSize="11" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.8">the answer</text>
        <text x="480" y="84" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor">{"{"}"pick": "2"{"}"}</text>
        {/* arrows */}
        <line x1="204" y1="79" x2="254" y2="79" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#rs-arrow)" />
        <text x="229" y="70" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7" textAnchor="middle">renders</text>
        <line x1="416" y1="79" x2="466" y2="79" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#rs-arrow)" />
        <text x="441" y="70" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7" textAnchor="middle">submit</text>
        {/* validate + node_input */}
        <path d="M540 138 L540 176" stroke={AMBER} strokeWidth="1.2" markerEnd="url(#rs-arrow)" fill="none" />
        <text x="548" y="160" fontSize="9.5" fontFamily="var(--font-mono)" fill={AMBER}>validated</text>
        <rect x="256" y="180" width="356" height="50" rx="12" {...box} />
        <text x="268" y="200" fontSize="11" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.8">persist_direction(node_input, ...)</text>
        <text x="268" y="219" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor">reads "pick" by name</text>
        <text x="8" y="205" fontSize="10.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7">downstream node</text>
        <line x1="132" y1="201" x2="254" y2="201" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">The schema is rendered as the form, the answer is validated against it, and the next node reads the same key.</figcaption>
    </figure>
  );
}

/** Where the graph stands after edit 2: the chain runs to direction_gate and
 *  stops there, holding an open call until a function_response arrives. */
function PausedGraphFigure() {
  const node = (cx: number, cy: number, label: string, accent = false, dashed = false) => (
    <g key={label}>
      <rect x={cx - 54} y={cy - 13} width="108" height="26" rx="8" fill={accent ? tint(AMBER, 0.12) : "var(--overlay)"} stroke={accent ? AMBER : "var(--hairline)"} strokeDasharray={dashed ? "4 3" : undefined} />
      <text x={cx} y={cy + 4} fontSize="9.5" fontFamily="var(--font-mono)" textAnchor="middle" fill={accent ? AMBER : "currentColor"} opacity={dashed ? 0.6 : 1}>
        {label}
      </text>
    </g>
  );
  const edge = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1}-${y1}-${x2}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.2" markerEnd="url(#pg-arrow)" />;
  return (
    <figure className="m-0">
      <svg viewBox="0 0 580 200" role="img" aria-label="The stage 2 chain runs from START through the two readers, the join and propose_directions to direction_gate, where the run is paused waiting for a function_response. persist_direction is shown dashed below the gate." className="h-auto w-full text-fg" style={{ maxWidth: "100%" }}>
        <defs>
          <marker id="pg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <circle cx="30" cy="85" r="12" fill="var(--overlay)" stroke="currentColor" strokeOpacity="0.6" />
        <text x="30" y="89" fontSize="8.5" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor">START</text>
        {node(120, 45, "scan_trends")}
        {node(120, 125, "read_backlog")}
        {node(242, 85, "join_research")}
        {node(364, 85, "propose_directions")}
        {node(486, 85, "direction_gate", true)}
        {node(486, 165, "persist_direction", false, true)}
        {edge(42, 80, 64, 50)}
        {edge(42, 90, 64, 120)}
        {edge(174, 45, 187, 80)}
        {edge(174, 125, 187, 90)}
        {edge(296, 85, 308, 85)}
        {edge(418, 85, 430, 85)}
        <line x1="486" y1="98" x2="486" y2="150" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#pg-arrow)" />
        <text x="494" y="128" fontSize="9" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.6">next stage</text>
        <text x="418" y="118" fontSize="9.5" fontFamily="var(--font-mono)" fill={AMBER} textAnchor="end">paused here</text>
        <text x="418" y="131" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7" textAnchor="end">an open adk_request_input call</text>
        <text x="418" y="144" fontSize="9.5" fontFamily="var(--font-mono)" fill="currentColor" opacity="0.7" textAnchor="end">resumes on function_response(interrupt_id)</text>
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">Where the graph stands after edit 2. The run ends after your answer because the gate is the last node in this stage; downstream stages continue from the node that reads it.</figcaption>
    </figure>
  );
}

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-hairline bg-input">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">response_schema · properties</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted hover:text-fg"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function HumanInTheLoop() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [open, setOpen] = useState(false);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const [status, setStatus] = useState<Stage2Status | null>(null);
  const [checking, setChecking] = useState(false);
  const { snapshot } = useRunEvents();

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.labStage2());
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
    // the dev UI writes to sessions.db outside this server's run loop; poll
    // while it is open so the verify rows follow the student's run
    if (!open) return;
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [open, check]);

  const gateWired = status?.gate_wired ?? false;
  const hasInput = status?.gate_has_request_input ?? false;

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 4d · Human-in-the-loop"
        color={AMBER}
        title="Human in the loop."
        blurb="Introduce an architectural approval gate before triggering downstream actions that incur cost or publish media. In ADK, yielding RequestInput suspends workflow execution and persists session state until an external response satisfies the validation schema."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Where the graph stands</p>
          <h2 className="font-display mt-2 text-2xl">Execution flow before the approval gate.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Currently, the workflow executes from end to end without pausing. When an idea prompt is submitted, the reader nodes run in parallel,
            the join consolidates the research, and <code className="font-mono text-fg">propose_directions</code> emits four candidate directions as
            terminal output. To prevent the pipeline from advancing without human confirmation, you will append <code className="font-mono text-fg">direction_gate</code> to
            the execution chain and configure it to suspend execution until a choice is submitted.
          </p>
          <div className="mt-5 overflow-x-auto">
            <HumanRunFigure />
          </div>
        </section>
      </In>


      <In delay={0.4}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Before you edit</p>
          <h2 className="font-display mt-2 text-2xl">Why the answer has a shape.</h2>
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <div className="space-y-3 text-sm text-fg-muted">
              <p>
                The person's answer becomes the next node's <code className="font-mono text-fg">node_input</code>. That node is code,
                not a model: <code className="font-mono text-fg">persist_direction</code> reads <code className="font-mono text-fg">pick</code>{" "}
                by name, passing directly into downstream deterministic validation logic.
                Free text would hand downstream nodes a parsing problem, and each would solve it differently. A{" "}
                <code className="font-mono text-fg">response_schema</code> settles the shape once, at the pause, and ADK validates the
                answer against it before the graph resumes.
              </p>
              <p>
                The same schema acts as a frontend contract. ADK Web renders it as a form, while the production VibeStudio application
                renders the same schema as a radio list, and a chat bot or a phone app could render it without any change to the
                graph. <code className="font-mono text-fg">payload</code> travels with the request for that frontend to display.
              </p>
              <p>
                Here the payload is <code className="font-mono text-fg">{"{"}"candidates": cands{"}"}</code>.{" "}
                <code className="font-mono text-fg">cands</code> is the list the first line of the function built: the four candidates the
                propose_directions returned, each a plain dict with a title, an angle, and a hook. The line after it writes the same list to
                shared state for the next node. Putting it in the payload as well means a frontend can show the four choices next to
                the form without reading state.
              </p>
            </div>
            <SchemaFigure />
          </div>
          <p className="mt-5 text-sm text-fg-muted">The property, for edit 1:</p>
          <CopyBlock text={SCHEMA_PROPERTIES} />
        </section>
      </In>

      <In delay={0.45}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">RequestInput</p>
          <h2 className="font-display mt-2 text-2xl">What goes in it.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            <code className="font-mono text-fg">RequestInput</code> is an ADK event. A node yields it the way it yields any other event, and
            the graph suspends at that point. It has four fields. You write <code className="font-mono text-fg">message</code>,{" "}
            <code className="font-mono text-fg">response_schema</code>, and <code className="font-mono text-fg">payload</code>. ADK fills in{" "}
            <code className="font-mono text-fg">interrupt_id</code> when the yield runs.
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <ul className="space-y-2.5">
              {REQUEST_INPUT_FIELDS.map((r) => (
                <li key={r.f} className="text-sm">
                  <code className="font-mono" style={{ color: AMBER }}>
                    {r.f}
                  </code>
                  <span className="ml-2 text-fg-muted">{r.what}</span>
                </li>
              ))}
            </ul>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sample RequestInput</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_REQUEST_INPUT_SAMPLE}</code>
              </pre>
              <p className="border-t border-hairline px-4 py-2 text-xs text-fg-muted">
                A yes-or-no pause for the thumbnail, the other decision in this pipeline. Yours has the same three arguments; only the
                message, the properties, and the payload change.
              </p>
            </div>
          </div>
        </section>
      </In>

      <In delay={0.25}>
        <EditPanel
          label="Edit 1 of 2"
          title="Make direction_gate wait for a person."
          intro={
            <>
              Only <code className="font-mono text-fg">direction_gate</code> is shown. Replace the two TODO comment lines with a{" "}
              <code className="font-mono text-fg">yield RequestInput(...)</code> carrying a <code className="font-mono text-fg">message</code>, a{" "}
              <code className="font-mono text-fg">response_schema</code> built from the property above, and a{" "}
              <code className="font-mono text-fg">payload</code> with the candidates.
            </>
          }
          pill={status ? (hasInput ? "RequestInput in place ✓" : "no RequestInput yield yet") : "…"}
          ok={hasInput}
          hint={hintB}
          setHint={setHintB}
          hint1={
            <>
              Three keyword arguments. <code className="font-mono">response_schema</code> is a dict with{" "}
              <code className="font-mono">"type": "object"</code> and the <code className="font-mono">"properties"</code> block above.{" "}
              <code className="font-mono">payload</code> is <code className="font-mono">{"{"}"candidates": cands{"}"}</code>. Keep the function
              body's indentation.
            </>
          }
          hint2={`    yield RequestInput(
        message="Pick tonight's direction: 1, 2, 3 or 4.",
        response_schema={
            "type": "object",
            "properties": {
                "pick": {"type": "string", "enum": ["1", "2", "3", "4"]}}},
        payload={"candidates": cands})`}
          path="agent/graph.py"
          symbol="direction_gate"
          pattern={/TODO: GATE_INPUT|yield RequestInput|"pick": \{|payload=/}
          onSaved={check}
        />
      </In>

      <In delay={0.5}>
        <EditPanel
          label="Edit 2 of 2"
          title="Add direction_gate to the workflow."
          intro={<>Only the edge list of the stage 2 app is shown. Append the gate to the last chain, after propose_directions.</>}
          pill={status ? (gateWired ? "gate in the chain ✓" : `chain: ${status.chain.length ? status.chain.join(" → ") : "none"}`) : "…"}
          ok={gateWired}
          hint={hintA}
          setHint={setHintA}
          hint1={<>One more name at the end of the third tuple, after <code className="font-mono">propose_directions</code>. The comma before it matters.</>}
          hint2={`root_agent = Workflow(
    name="stage2_direction",
    description="research -> 3 candidates in state -> the human door",
    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (join_research, propose_directions, direction_gate)])`}
          path="stage2_direction/agent.py"
          symbol="root_agent"
          pattern={/propose_directions\)\]\)|direction_gate\)\]\)/}
          onSaved={check}
        />
      </In>

      <In delay={0.55}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">What you just wrote</p>
          <h2 className="font-display mt-2 text-2xl">A pause with an id.</h2>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-3 text-sm text-fg-muted">
              <p>
                When the yield runs, ADK gives the request an <code className="font-mono text-fg">interrupt_id</code> and writes an open
                function call named <code className="font-mono text-fg">adk_request_input</code> into the session, with your message,
                schema, and payload as its arguments. Then it returns to the caller. No thread waits; the open call is a row in the session.
              </p>
              <p>
                The only thing that resumes it is a <code className="font-mono text-fg">function_response</code> carrying that id. adk web
                sends one when you submit the form. The response is validated against your schema, the graph picks up at the gate,
                and the answer becomes the next node's <code className="font-mono text-fg">node_input</code>. A chat message to the
                workflow is a new turn, not an answer, which is why the pause cannot be talked past.
              </p>
            </div>
            <PausedGraphFigure />
          </div>
        </section>
      </In>

      <In delay={0.45}>
        <LoadCheck app="stage2_direction" intro="Save, then click the button. It loads stage2_direction the way adk web will and tells you either that it loads or what ADK objects to." />
      </In>

      <In delay={0.5}>
        <RunPanel
          app="stage2_direction"
          open={open}
          setOpen={setOpen}
          title="Run it after each edit."
          intro="One model call per run: propose_directions. After edit 1 the run completes with the candidates in state. After edit 2 it stops on a form built from your response_schema."
          idea={idea}
          setIdea={setIdea}
          steps={[
            "After edit 1: the fan-out, the join, a State: candidates chip, and the run completes. No form.",
            "After edit 2: the run stops on an adk_request_input event with a small form. Type 1 in pick and press Submit. The graph resumes; with the gate as the last node, the run ends after your answer.",
          ]}
        />
      </In>

      <In delay={0.6}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from the two files and the stage2_direction sessions in runs/sessions.db.">
          <CheckRow ok={gateWired} label="direction_gate is in the chain">
            {status ? (gateWired ? status.chain.join(" → ") : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={hasInput} label="direction_gate yields a RequestInput">
            {status ? (hasInput ? "Found in the function body." : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={!!status && status.asked > 0} label="The graph suspended">
            {status ? `${status.asked} adk_request_input call${status.asked === 1 ? "" : "s"} in the sessions` : "…"}
          </CheckRow>
          <CheckRow ok={!!status && status.answered > 0} label="You answered by function_response">
            {status ? `${status.answered} answer${status.answered === 1 ? "" : "s"} carrying the call id` : "…"}
          </CheckRow>
        </VerifyPanel>
      </In>
    </div>
  );
}

/* ───────────────────────── 4c ───────────────────────── */

const CODE_INSTRUCTION = `# agent/graph.py
PROPOSE_INSTRUCTION = (
    "You run the creator's short-video channel. The message "
    "you received is tonight's research bundle as JSON: "
    "scan_trends holds ten trending topics with heat; "
    "read_backlog holds the creator's notes and tonight's idea."
    "Merge the backlog notes closest to the idea, then find "
    "the trend each merged idea can ride ..."
    "PITCH exactly FOUR candidate directions ... Candidates 1 to 3 "
    "each cite a backlog note and a trend ..."
    "Candidate 4 is the outrage-bait direction ... Its title MUST "
    "contain one of: competitor, scam, revenge, humiliate, fake, "
    "dangerous stunt ...")`;

const CODE_DIRECTIONS = `# agent/schemas.py
class Direction(BaseModel):
    title: str        # <=60 chars, a filmable scene
    angle: str        # the twist, one line
    hook: str = ""    # 2-4 words on the thumbnail
    evidence: list[Evidence]


class Directions(BaseModel):
    candidates: list[Direction]   # exactly 4`;

/** The first agent node, as a picture: a node in the chain that makes one
 *  model call and answers with one typed object, four candidates, the last
 *  of them bait for the policy check two steps on. */
function AgentNodeFigure() {
  const mono = { fontFamily: "var(--font-mono)" } as const;
  const node = (x: number, y: number, w: number, label: string, color?: string, dashed = false) => (
    <g>
      <rect x={x} y={y} width={w} height={26} rx={8} fill={color ? tint(color, 0.1) : "var(--overlay)"} stroke={color ?? "var(--hairline)"} strokeWidth={color ? 1.4 : 1} strokeDasharray={dashed ? "4 3" : undefined} />
      <text x={x + w / 2} y={y + 17} fontSize="10" style={mono} textAnchor="middle" fill={color ?? "currentColor"} opacity={dashed ? 0.6 : 1}>{label}</text>
    </g>
  );
  const tick = (x: number, y: number) => <path d={`M${x} ${y} l3.5 3.5 l7 -7.5`} fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  const rows: [string, string][] = [
    ["1", "a channel concept"],
    ["2", "a channel concept"],
    ["3", "a channel concept"],
  ];
  return (
    <figure className="m-0 min-w-[820px]">
      <svg viewBox="0 0 940 300" role="img" aria-label="propose_directions sits in the chain between join_research and direction_gate. Used as a node it runs in single_turn mode: the join's dict goes to Gemini as JSON in one call, with no tool loop and no conversation, and one typed answer comes back, a Directions object with exactly four candidates. Candidates 1 to 3 are viable channel concepts; candidate 4 breaks policy on purpose, bait for the policy check later in the graph. Later nodes read the answer by field name." className="h-auto w-full text-fg">
        <defs>
          <marker id="an-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
          <marker id="an-arrow-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={PURPLE} />
          </marker>
        </defs>

        {/* the model, above the chain */}
        <rect x="184" y="22" width="260" height="52" rx="12" fill={tint(PURPLE, 0.06)} stroke={PURPLE} strokeWidth="1.2" />
        <text x="314" y="43" fontSize="11" style={mono} textAnchor="middle" fill={PURPLE}>Gemini · config.MODEL</text>
        <text x="314" y="60" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">one call · no tool loop · no conversation</text>

        {/* the chain */}
        {node(28, 176, 120, "join_research", CYAN)}
        <line x1="148" y1="189" x2="236" y2="189" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#an-arrow)" />
        <text x="192" y="168" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">the research dict</text>
        <rect x="230" y="168" width="168" height="42" rx="13" fill={tint(PURPLE, 0.12)} stroke={PURPLE} strokeOpacity="0.35" strokeWidth="1" />
        <rect x="238" y="176" width="152" height="26" rx="8" fill={tint(PURPLE, 0.22)} stroke={PURPLE} strokeWidth="2.2" />
        <text x="314" y="194" fontSize="11" fontWeight="700" style={mono} textAnchor="middle" fill={PURPLE}>propose_directions</text>
        <text x="314" y="218" fontSize="8.5" style={mono} textAnchor="middle" fill={PURPLE}>an Agent used as a node</text>
        <text x="314" y="231" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">mode single_turn, by default</text>
        <line x1="390" y1="189" x2="470" y2="189" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#an-arrow)" />
        {node(472, 176, 120, "direction_gate", undefined, true)}
        <text x="532" y="218" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">next stage</text>

        {/* up to the model and back */}
        <path d="M290 176 C 290 130, 290 110, 290 76" fill="none" stroke={PURPLE} strokeWidth="1.2" markerEnd="url(#an-arrow-p)" />
        <text x="282" y="128" fontSize="8.5" style={mono} textAnchor="end" fill="currentColor" opacity="0.75">the dict, as JSON</text>
        <path d="M338 74 C 338 110, 338 130, 338 174" fill="none" stroke={PURPLE} strokeWidth="1.2" markerEnd="url(#an-arrow-p)" />
        <text x="346" y="128" fontSize="8.5" style={mono} fill={PURPLE}>one answer, typed</text>
        <text x="346" y="141" fontSize="8.5" style={mono} fill="currentColor" opacity="0.75">output_schema=Directions</text>

        {/* the answer */}
        <path d="M390 182 C 560 182, 560 60, 650 60" fill="none" stroke={PURPLE} strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#an-arrow-p)" />
        <rect x="652" y="22" width="264" height="228" rx="14" fill="var(--overlay)" stroke={PURPLE} strokeWidth="1.2" />
        <text x="668" y="44" fontSize="11" style={mono} fill={PURPLE}>Directions</text>
        <text x="668" y="58" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">exactly four candidates</text>
        <line x1="668" y1="68" x2="900" y2="68" stroke="var(--hairline)" />
        {rows.map(([n, what], i) => (
          <g key={n}>
            <text x="672" y={94 + i * 34} fontSize="10.5" style={mono} fill="currentColor">{n}</text>
            {tick(690, 90 + i * 34)}
            <text x="712" y={94 + i * 34} fontSize="9.5" style={mono} fill="currentColor">{what}</text>
          </g>
        ))}
        <text x="672" y="196" fontSize="10.5" style={mono} fill="currentColor">4</text>
        <text x="686" y="200" fontSize="18" fontWeight="700" fill={RED}>☠</text>
        <text x="712" y="196" fontSize="9.5" style={mono} fill={RED}>breaks policy on purpose</text>
        <text x="712" y="210" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">bait for policy_check, step 5</text>
        <line x1="668" y1="222" x2="900" y2="222" stroke="var(--hairline)" />
        <text x="668" y="239" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">later nodes read it by field name, as code</text>
      </svg>
    </figure>
  );
}

/** Where 4d starts, as the person in adk web sees it: an idea goes in, the
 *  graph runs to propose_directions and ends, and four candidates come back
 *  as the workflow's output. Nothing asks the person to choose yet; the two
 *  edits on the page add the gate that will. */
function HumanRunFigure() {
  const mono = { fontFamily: "var(--font-mono)" } as const;
  const node = (x: number, y: number, w: number, label: string, color?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={24} rx={8} fill={color ? tint(color, 0.1) : "var(--overlay)"} stroke={color ?? "var(--hairline)"} strokeWidth={color ? 1.3 : 1} />
      <text x={x + w / 2} y={y + 16} fontSize="9.5" style={mono} textAnchor="middle" fill={color ?? "currentColor"}>{label}</text>
    </g>
  );
  const person = (cx: number, cy: number) => (
    <g>
      <circle cx={cx} cy={cy} r="8" fill={tint(BLUE, 0.15)} stroke={BLUE} strokeWidth="1.4" />
      <path d={`M${cx - 15} ${cy + 30} a15 15 0 0 1 30 0`} fill={tint(BLUE, 0.15)} stroke={BLUE} strokeWidth="1.4" />
    </g>
  );
  const tick = (x: number, y: number) => <path d={`M${x} ${y} l3 3 l6 -6.5`} fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />;
  return (
    <figure className="m-0 min-w-[820px]">
      <svg viewBox="0 0 940 250" role="img" aria-label="You type an idea in adk web. The two readers run, the join gathers their outputs, and propose_directions makes one model call; the run ends there. Its four candidates come back to you as the workflow's output, the last event in the chat: three viable and one that breaks policy on purpose. Nothing asks you to choose yet; the two edits on this page add a gate after the agent." className="h-auto w-full text-fg">
        <defs>
          <marker id="hr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
          <marker id="hr-arrow-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={BLUE} />
          </marker>
          <marker id="hr-arrow-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={PURPLE} />
          </marker>
        </defs>

        {/* you, in adk web */}
        <rect x="14" y="20" width="150" height="212" rx="14" fill="var(--overlay)" stroke={BLUE} strokeOpacity="0.5" strokeWidth="1.2" />
        <text x="89" y="40" fontSize="10.5" style={mono} textAnchor="middle" fill={BLUE}>you · adk web</text>
        {person(89, 68)}
        <rect x="26" y="112" width="126" height="40" rx="9" fill={tint(BLUE, 0.1)} stroke={BLUE} strokeWidth="1" />
        <text x="89" y="128" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor">a tiny dragon guards</text>
        <text x="89" y="141" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor">the last cookie</text>
        <text x="89" y="172" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">1 · your idea</text>
        <text x="89" y="214" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">3 · read what came back</text>

        {/* into the graph */}
        <path d="M152 132 C 190 132, 190 126, 218 126" fill="none" stroke={BLUE} strokeWidth="1.3" markerEnd="url(#hr-arrow-b)" />

        {/* the run */}
        <text x="236" y="40" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">2 · the run</text>
        <circle cx="232" cy="126" r="12" fill="var(--overlay)" stroke="currentColor" strokeOpacity="0.6" />
        <text x="232" y="129" fontSize="7.5" style={mono} textAnchor="middle" fill="currentColor">START</text>
        <path d="M244 121 C 262 121, 262 80, 280 80" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#hr-arrow)" />
        <path d="M244 131 C 262 131, 262 172, 280 172" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#hr-arrow)" />
        {node(282, 68, 92, "scan_trends")}
        {node(282, 160, 92, "read_backlog")}
        <path d="M374 80 C 392 80, 392 126, 408 126" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#hr-arrow)" />
        <path d="M374 172 C 392 172, 392 126, 408 126" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#hr-arrow)" />
        {node(410, 114, 100, "join_research", CYAN)}
        <line x1="510" y1="126" x2="536" y2="126" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#hr-arrow)" />
        <rect x="530" y="106" width="156" height="40" rx="13" fill={tint(PURPLE, 0.12)} stroke={PURPLE} strokeOpacity="0.35" strokeWidth="1" />
        <rect x="538" y="114" width="140" height="24" rx="8" fill={tint(PURPLE, 0.22)} stroke={PURPLE} strokeWidth="2" />
        <text x="608" y="130" fontSize="10.5" fontWeight="700" style={mono} textAnchor="middle" fill={PURPLE}>propose_directions</text>
        <text x="608" y="164" fontSize="8.5" style={mono} textAnchor="middle" fill={PURPLE}>one model call</text>
        <text x="608" y="177" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">the run ends here</text>
        <text x="608" y="204" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.55">no gate yet · the two edits below add one</text>

        {/* back to you */}
        <path d="M686 120 C 740 120, 740 60, 760 60" fill="none" stroke={PURPLE} strokeWidth="1.3" markerEnd="url(#hr-arrow-p)" />
        <rect x="750" y="20" width="186" height="150" rx="12" fill="var(--overlay)" stroke={PURPLE} strokeWidth="1.2" />
        <text x="776" y="40" fontSize="10" style={mono} fill={PURPLE}>the workflow's output</text>
        <text x="776" y="53" fontSize="8" style={mono} fill="currentColor" opacity="0.7">the last event in the chat</text>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <text x="778" y={78 + i * 20} fontSize="9.5" style={mono} fill="currentColor">{i + 1}</text>
            {tick(792, 75 + i * 20)}
            <text x="810" y={78 + i * 20} fontSize="8.5" style={mono} fill="currentColor">a channel concept</text>
          </g>
        ))}
        <text x="778" y="140" fontSize="9.5" style={mono} fill="currentColor">4</text>
        <text x="788" y="143" fontSize="15" fontWeight="700" fill={RED}>☠</text>
        <text x="810" y="140" fontSize="8.5" style={mono} fill={RED}>breaks policy on purpose</text>
        <text x="776" y="160" fontSize="8" style={mono} fill="currentColor" opacity="0.7">nothing asks you to choose yet</text>
        <path d="M844 172 C 844 200, 600 236, 170 232" fill="none" stroke={PURPLE} strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#hr-arrow-p)" />
      </svg>
    </figure>
  );
}

function AgentNode() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [open, setOpen] = useState(false);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const [status, setStatus] = useState<Stage2Status | null>(null);
  const [load, setLoad] = useState<{ ok: boolean; edges?: number; error: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const { snapshot } = useRunEvents();

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.labStage2());
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
    // the dev UI writes to sessions.db outside this server's run loop; poll
    // while it is open so the verify rows follow the student's run
    if (!open) return;
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [open, check]);

  const runLoad = async () => {
    setLoading(true);
    try {
      setLoad(await api.labStage2Load());
    } finally {
      setLoading(false);
    }
  };

  const defined = status?.proposer_defined ?? false;
  const wired = status?.proposer_wired ?? false;

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 4c · Agent nodes"
        color={AMBER}
        title="The first agent node."
        blurb="Connect an ADK Agent node downstream of the research join. The agent accepts the synchronized research dictionary, synthesizes platform trends and backlog ideas, and emits four structured, schema-validated creative directions."
      />

      <In delay={0.1}>
        <section className="overflow-x-auto rounded-3xl border border-hairline bg-card p-6">
          <AgentNodeFigure />
        </section>
      </In>

      <In delay={0.3}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The pieces</p>
          <h2 className="font-display mt-2 text-2xl">The arguments of an agent node.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            <code className="font-mono text-fg">name</code> is the node's name on the map. <code className="font-mono text-fg">model</code> is{" "}
            <code className="font-mono text-fg">config.MODEL</code>, the configured Gemini model. <code className="font-mono text-fg">instruction</code>{" "}
            is a string constant in <code className="font-mono text-fg">agent/graph.py</code>, imported into the app file. And{" "}
            <code className="font-mono text-fg">output_schema</code> is the <code className="font-mono text-fg">Directions</code> model.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The instruction · abridged</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_INSTRUCTION}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The output schema</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_DIRECTIONS}</code>
              </pre>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fg-muted">
            The schema is the part that matters for the rest of the graph. The model's reply is validated against it, so the node after
            propose_directions receives a <code className="font-mono text-fg">Directions</code> object with exactly four candidates, not free text.
            In 4d that node is a pause that shows the four titles to a person.
          </p>
        </section>
      </In>

      <In delay={0.4}>
        <EditPanel
          label="Edit 1 of 2"
          title="Define the agent node."
          intro={
            <>
              Only the <code className="font-mono text-fg">propose_directions</code> line is shown. Replace <code className="font-mono text-fg">None</code>{" "}
              with an <code className="font-mono text-fg">Agent(...)</code>.
            </>
          }
          pill={status ? (defined ? "agent defined ✓" : "propose_directions is None") : "…"}
          ok={defined}
          hint={hintA}
          setHint={setHintA}
          hint1={
            <>
              Four keyword arguments: <code className="font-mono">name="propose_directions"</code>, <code className="font-mono">model=config.MODEL</code>,{" "}
              <code className="font-mono">instruction=PROPOSE_INSTRUCTION</code>, <code className="font-mono">output_schema=Directions</code>. No tools.
            </>
          }
          hint2={`propose_directions = Agent(
    name="propose_directions",
    model=config.MODEL,
    instruction=PROPOSE_INSTRUCTION,
    output_schema=Directions)`}
          path="stage2_direction/agent.py"
          symbol="propose_directions"
          pattern={/propose_directions = /}
          onSaved={check}
        />
      </In>

      <In delay={0.45}>
        <EditPanel
          label="Edit 2 of 2"
          title="Start the third chain from the join."
          intro={<>Only the <code className="font-mono text-fg">Workflow</code> is shown. Add a third tuple: the join, then the agent. 4d extends this same chain.</>}
          pill={status ? (wired ? "agent in the chain ✓" : `chains: ${status.edges.length}`) : "…"}
          ok={wired}
          hint={hintB}
          setHint={setHintB}
          hint1={<>Two names in the new tuple: <code className="font-mono">join_research</code>, then <code className="font-mono">propose_directions</code>. Watch the closing brackets.</>}
          hint2={`    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (join_research, propose_directions)])`}
          path="stage2_direction/agent.py"
          symbol="root_agent"
          pattern={/^\s*edges=|read_backlog, join_research\)\]\)|propose_directions\)\]\)/}
          onSaved={check}
        />
      </In>

      <In delay={0.5}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Before you run</p>
              <p className="mt-1 max-w-2xl text-sm text-fg-muted">
                Save both edits above, then click the button. It loads your saved file the way adk web will and tells you either that it
                loads or what ADK objects to, so a missing argument or a stray bracket is caught here rather than in the run.
              </p>
            </div>
            <button onClick={runLoad} className="flex items-center gap-2 rounded-xl border border-hairline bg-overlay px-4 py-2 font-mono text-xs text-fg-muted hover:text-fg">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Check the workflow loads
            </button>
          </div>
          {load && (
            <div className="mt-3 rounded-xl border p-3 font-mono text-[11.5px]" style={load.ok ? { borderColor: tint(GREEN, 0.4), color: GREEN, background: tint(GREEN, 0.06) } : { borderColor: tint(RED, 0.4), color: RED, background: tint(RED, 0.06) }}>
              {load.ok ? `loads · ${load.edges} edges` : load.error}
            </div>
          )}
        </section>
      </In>

      <In delay={0.55}>
        <RunPanel
          app="stage2_direction"
          open={open}
          setOpen={setOpen}
          title="Run stage 2 in adk web."
          intro="The chain ends at propose_directions, so each run is one model call and ends with its four candidates as the workflow's output."
          idea={idea}
          setIdea={setIdea}
          steps={[
            "The fan-out, the join, then propose_directions lights and the run ends.",
            "Open the propose_directions event: one model call, one structured reply, four candidates with a title, an angle, and a hook each. Read candidate 4: its title carries a word the channel refuses. Nothing asks you anything yet; 4d adds the node that stops the graph and shows them to you.",
          ]}
        />
      </In>

      <In delay={0.6}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from stage2_direction/agent.py and the latest stage2_direction session.">
          <CheckRow ok={defined} label="propose_directions is an Agent">
            {status ? (defined ? "Agent(...) found in the stage 2 file." : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={wired} label="The chain from the join reaches it">
            {status ? (wired ? status.chain.join(" → ") : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={!!status?.nodes_ran.includes("propose_directions")} label="The agent node ran after the join">
            {status?.nodes_ran.length ? `events from: ${status.nodes_ran.join(", ")}` : "No node events yet."}
          </CheckRow>
          <CheckRow ok={status?.proposed_titles.length === 4} label="It returned four typed candidates">
            {status?.proposed_titles.length ? status.proposed_titles.map((c, i) => `${i + 1}. ${c}`).join("  ·  ") : "None in the latest session yet."}
          </CheckRow>
        </VerifyPanel>
      </In>
    </div>
  );
}

/* ───────────────────────── shared panels ───────────────────────── */

export function EditPanel({
  label = "Your edit",
  title,
  intro,
  pill,
  ok,
  hint,
  setHint,
  hint1,
  hint2,
  path,
  symbol,
  pattern,
  onSaved,
  extra,
}: {
  label?: string;
  title: string;
  intro: React.ReactNode;
  /** Shown between the intro and the editor: figures, code to read, a helper button. */
  extra?: React.ReactNode;
  pill: string;
  ok: boolean;
  hint: number;
  setHint: (f: (h: number) => number) => void;
  hint1: React.ReactNode;
  hint2: string;
  path: string;
  symbol?: string;
  pattern: RegExp;
  onSaved: () => void;
}) {
  return (
    <section className="rounded-3xl border p-6" style={{ borderColor: tint(AMBER, 0.4), background: tint(AMBER, 0.04) }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: AMBER }}>
            {label}
          </p>
          <h2 className="font-display mt-2 text-2xl">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">{intro}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border px-3 py-1 font-mono text-[11px]" style={ok ? { borderColor: tint(GREEN, 0.4), color: GREEN, background: tint(GREEN, 0.08) } : { borderColor: "var(--hairline)", color: "var(--fg-muted)" }}>
            {pill}
          </span>
          <button onClick={() => setHint((h) => Math.min(h + 1, 2))} className="flex items-center gap-1.5 rounded-full border border-hairline bg-card px-3 py-1 text-xs text-fg-muted hover:text-fg">
            <Lightbulb size={13} /> {hint === 0 ? "Hint" : hint === 1 ? "Another hint" : "Hints shown"}
          </button>
        </div>
      </div>
      {hint >= 1 && (
        <div className="mt-4 rounded-2xl border border-hairline bg-card p-4 text-sm text-fg-muted">
          <p>
            <b className="text-fg">Hint 1.</b> {hint1}
          </p>
          {hint >= 2 && <pre className="mt-2 overflow-x-auto rounded-lg bg-overlay px-3 py-2 font-mono text-[11.5px] text-fg">{hint2}</pre>}
        </div>
      )}
      {extra && <div className="mt-4">{extra}</div>}
      <div className="mt-4">
        <CodeEditor path={path} symbol={symbol} accent={AMBER} highlightPattern={pattern} onSaved={onSaved} />
      </div>
    </section>
  );
}

export function RunPanel({
  app,
  open,
  setOpen,
  title,
  intro,
  idea,
  setIdea,
  steps,
  stepTitles,
  frame,
  figure,
}: {
  app: string;
  open: boolean;
  setOpen: (f: (o: boolean) => boolean) => void;
  title: string;
  intro: string;
  idea: string;
  setIdea: (v: string) => void;
  steps: [string, string];
  /** Titles for the two instruction cards after the idea; default "Watch the run" and "Then". */
  stepTitles?: [string, string];
  /** A session to open instead of the app's start page, and a counter that
   *  reloads the frame each time it changes (the dev UI never re-reads a
   *  session on its own). */
  frame?: { url: string; n: number } | null;
  /** A picture of this run, drawn between the intro and the instructions. */
  figure?: React.ReactNode;
}) {
  const [inspector, setInspector] = useState<InspectorStatus | null>(null);
  useEffect(() => {
    api.labInspector().then(setInspector).catch(() => setInspector({ up: false, url: "/inspector/dev-ui/", apps: [] }));
  }, []);
  const url = frame?.url ?? `/inspector/dev-ui/?app=${app}`;
  // the badge reloads the frame when the student asks it to
  const [reloadN, setReloadN] = useState(0);
  const frameKey = `${frame?.n ?? 0}:${reloadN}`;
  return (
    <section id={`run-${app}`} className="rounded-3xl border p-6" style={{ borderColor: tint(BLUE, 0.33), background: tint(BLUE, 0.04) }}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: BLUE }}>
            Run it
          </p>
          <h2 className="font-display mt-2 text-2xl">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">{intro}</p>
        </div>
        <div className="flex items-center gap-2">
          {inspector && (
            <span className="rounded-full border border-hairline bg-card px-3 py-1 font-mono text-[11px] text-fg-muted">
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${inspector.up ? "bg-vibe-green" : "bg-vibe-red"}`} />
              {inspector.up ? "adk web ready" : "adk web unavailable"}
            </span>
          )}
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03]" style={{ background: BLUE }}>
            <TerminalSquare size={16} />
            {open ? "Hide adk web" : "Open adk web"}
          </button>
        </div>
      </div>

      {figure && <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-card p-4">{figure}</div>}

      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        <Instruction n={1} title="Send your idea in the chat box">
          <input value={idea} onChange={(e) => setIdea(e.target.value)} className="mt-2 w-full rounded-lg border border-hairline bg-input px-3 py-2 font-mono text-xs text-fg" placeholder={DEFAULT_IDEA} />
          <CopyLine text={idea.trim() || DEFAULT_IDEA} />
        </Instruction>
        <Instruction n={2} title={stepTitles?.[0] ?? "Watch the run"}>
          <p className="mt-2 text-xs text-fg-muted">{steps[0]}</p>
        </Instruction>
        <Instruction n={3} title={stepTitles?.[1] ?? "Then"}>
          <p className="mt-2 text-xs text-fg-muted">{steps[1]}</p>
        </Instruction>
      </ol>

      {open && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-hairline bg-card">
          <div className="flex items-center justify-between gap-4 border-b border-hairline bg-overlay px-3 py-1.5 font-mono text-[11px] text-fg-muted">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0">{url}</span>
              <span className="shrink-0 opacity-50">·</span>
              <LoadedBadge key={frameKey} app={app} onReload={() => setReloadN((n) => n + 1)} />
            </div>
            <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 hover:text-fg">
              open in a new tab <ExternalLink size={12} />
            </a>
          </div>
          <iframe
            key={frameKey}
            title="adk web"
            src={url}
            className="h-[680px] w-full bg-[#1e1e1e]"
            onLoad={() => {
              // A reloaded frame: the dev UI focuses its chat box while it boots, and the
              // browser scrolls this page to it. Wait for that scroll (or four seconds),
              // then put the panel back at the top of the view.
              if (!frame) return;
              const y0 = window.scrollY;
              const t0 = Date.now();
              const id = setInterval(() => {
                if (Math.abs(window.scrollY - y0) < 40 && Date.now() - t0 < 4000) return;
                clearInterval(id);
                const el = document.getElementById(`run-${app}`);
                if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 170 });
              }, 100);
            }}
          />
        </div>
      )}
    </section>
  );
}

export function VerifyPanel({ checking, onCheck, intro, title = "Execution verification.", children }: { checking: boolean; onCheck: () => void; intro: string; title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-hairline bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Verify</p>
          <h2 className="font-display mt-2 text-2xl">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">{intro}</p>
        </div>
        <button onClick={onCheck} className="flex items-center gap-2 rounded-xl border border-hairline bg-overlay px-4 py-2 font-mono text-xs text-fg-muted hover:text-fg">
          <RefreshCw size={13} className={checking ? "animate-spin" : ""} /> Check again
        </button>
      </div>
      <ul className="mt-5 grid gap-2 md:grid-cols-2">{children}</ul>
    </section>
  );
}


function Instruction({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-hairline bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white" style={{ background: BLUE }}>
          {n}
        </span>
        {title}
      </div>
      {children}
    </li>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-hairline bg-input px-3 py-2 text-left font-mono text-xs text-fg hover:border-vibe-cyan/60"
      title="Copy"
    >
      <span className="truncate">{text}</span>
      {copied ? <Check size={13} className="shrink-0 text-vibe-green" /> : <Copy size={13} className="shrink-0 text-fg-muted" />}
    </button>
  );
}

export function CheckRow({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) {
  const color = ok ? GREEN : "var(--fg-muted)";
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-hairline bg-overlay p-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: color, color, background: ok ? tint(color, 0.1) : "transparent" }}>
        {ok ? <Check size={13} /> : <X size={12} className="opacity-40" />}
      </span>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-fg-muted">{children}</div>
      </div>
    </li>
  );
}
