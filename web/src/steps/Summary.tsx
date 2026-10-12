import { t, tx } from "../i18n";
import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { In, StepHeader } from "../components/shared";
import { COLORS, tint } from "./colors";
import { SnakeGraph } from "./Overview";

/*
 * Step 10: the whole workflow, and every concept it carries. Hover a node
 * for what it taught and where; the pulse walks the graph the way a run does.
 */

const PURPLE = COLORS.purple;
const AMBER = COLORS.amber;
const CYAN = COLORS.cyan;
const GREEN = COLORS.green;
const RED = COLORS.red;
const BLUE = COLORS.blue;
const mono = { fontFamily: "var(--font-mono)" } as const;

/* ── the design rules, each with a picture ─────────────────────────────── */

const box = (x: number, y: number, w: number, label: string, color?: string, dashed = false, h = 22) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={7} fill={color ? tint(color, 0.1) : "var(--overlay)"} stroke={color ?? "var(--hairline)"} strokeWidth={color ? 1.3 : 1} strokeDasharray={dashed ? "4 3" : undefined} />
    <text x={x + w / 2} y={y + h / 2 + 3.5} fontSize="8.5" style={mono} textAnchor="middle" fill={color ?? "currentColor"}>{label}</text>
  </g>
);
const arrow = (x1: number, y1: number, x2: number, y2: number, color = "currentColor", dashed = false) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.1" strokeDasharray={dashed ? "4 3" : undefined} markerEnd="url(#rule-arrow)" />
);
const note = (x: number, y: number, text: string, color?: string, anchor: "start" | "middle" | "end" = "start") => (
  <text x={x} y={y} fontSize="7.5" style={mono} textAnchor={anchor} fill={color ?? "currentColor"} opacity={color ? 1 : 0.7}>{text}</text>
);
const person = (cx: number, cy: number, color = BLUE) => (
  <g>
    <circle cx={cx} cy={cy} r="4.5" fill={tint(color, 0.15)} stroke={color} strokeWidth="1.2" />
    <path d={`M${cx - 8} ${cy + 16} a8 8 0 0 1 16 0`} fill={tint(color, 0.15)} stroke={color} strokeWidth="1.2" />
  </g>
);

function RuleFigure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 320 118" role="img" aria-label={label} className="h-auto w-full text-fg">
      <defs>
        <marker id="rule-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

const RULES: { text: string; figure: React.ReactNode }[] = [
  {
    text: t("Graphs pause for people and for receipts, never for a wait. RequestInput and the pending tool call both suspend the run; nothing stays alive on a timer."),
    figure: (
      <RuleFigure label={t("Two paused nodes: direction_gate, resumed by a person's answer, and render_desk, resumed by the receipt of the render. A clock, struck out: nothing waits on a timer.")}>
        {person(60, 14)}
        {note(60, 46, t("a person answers"), BLUE, "middle")}
        {arrow(60, 50, 60, 62, BLUE)}
        {box(16, 64, 88, "direction_gate", AMBER)}
        <rect x="186" y="8" width="26" height="30" rx="3" fill="var(--overlay)" stroke={AMBER} strokeWidth="1.1" />
        <line x1="191" y1="16" x2="207" y2="16" stroke={AMBER} strokeWidth="1" /><line x1="191" y1="22" x2="207" y2="22" stroke={AMBER} strokeWidth="1" /><line x1="191" y1="28" x2="203" y2="28" stroke={AMBER} strokeWidth="1" />
        {note(199, 50, t("the render's receipt"), AMBER, "middle")}
        {arrow(199, 54, 199, 62, AMBER)}
        {box(155, 64, 88, "render_desk", AMBER)}
        {note(60, 100, t("paused, on disk"), undefined, "middle")}
        {note(199, 100, t("paused, on disk"), undefined, "middle")}
        <circle cx="290" cy="75" r="11" fill="none" stroke={RED} strokeWidth="1.2" />
        <line x1="290" y1="75" x2="290" y2="68" stroke={RED} strokeWidth="1.2" /><line x1="290" y1="75" x2="295" y2="78" stroke={RED} strokeWidth="1.2" />
        <line x1="280" y1="86" x2="300" y2="64" stroke={RED} strokeWidth="1.6" />
        {note(290, 100, t("never a wait"), RED, "middle")}
      </RuleFigure>
    ),
  },
  {
    text: t("Every resume is one function_response carrying the call's id, whoever sends it: a page, a console, another process, after a restart."),
    figure: (
      <RuleFigure label={t("Three senders, a page, a console and another process after a restart, each sending the same function_response with the call's id into the one open call.")}>
        {box(8, 8, 92, t("the page"), BLUE)}
        {box(8, 42, 92, "a console", BLUE)}
        {box(8, 76, 92, t("another process"), BLUE)}
        {note(54, 112, t("even after a restart"), undefined, "middle")}
        <path d="M100 19 C 140 19, 150 53, 186 53" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        <path d="M100 53 L 186 53" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        <path d="M100 87 C 140 87, 150 53, 186 53" fill="none" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        {note(143, 86, "function_response(id)", undefined, "middle")}
        {box(188, 40, 124, t("the open call"), AMBER, true, 26)}
        {note(250, 82, t("id call_3719769"), AMBER, "middle")}
        {note(250, 96, t("one id, one answer, one resume"), undefined, "middle")}
      </RuleFigure>
    ),
  },
  {
    text: t("Nodes share state by key name. candidates, direction, render_url move through the graph without being passed between nodes."),
    figure: (
      <RuleFigure label={t("A state store in the middle with three keys. propose_directions writes candidates and persist_direction reads it; persist_direction writes direction and scripter reads it; store_video writes render_url and the app reads it. No edge carries any of them.")}>
        <rect x="110" y="6" width="100" height="106" rx="9" fill={tint(GREEN, 0.06)} stroke={GREEN} strokeWidth="1.1" />
        {note(160, 20, "state", GREEN, "middle")}
        {["candidates", "direction", "render_url"].map((k, i) => (
          <g key={k}>
            <rect x="118" y={30 + i * 26} width="84" height="18" rx="4" fill="var(--overlay)" stroke="var(--hairline)" />
            <text x="160" y={42 + i * 26} fontSize="8" style={mono} textAnchor="middle" fill="currentColor">{k}</text>
          </g>
        ))}
        {["propose_directions", "persist_direction", "store_video"].map((n, i) => (
          <g key={n}>
            <text x="100" y={42 + i * 26} fontSize="7.5" style={mono} textAnchor="end" fill="currentColor">{n}</text>
            {arrow(102, 39 + i * 26, 116, 39 + i * 26, GREEN)}
          </g>
        ))}
        {["persist_direction", "scripter", "the app"].map((n, i) => (
          <g key={n}>
            {arrow(204, 39 + i * 26, 218, 39 + i * 26, GREEN)}
            <text x="222" y={42 + i * 26} fontSize="7.5" style={mono} fill="currentColor">{n}</text>
          </g>
        ))}
        {note(6, 108, t("writes by key"))}
        {note(314, 108, t("reads by key"), undefined, "end")}
      </RuleFigure>
    ),
  },
  {
    text: t("Routing is plain code and policy is data. The gate is a function and a text file, decided before any money is spent."),
    figure: (
      <RuleFigure label={t("policy_check, a plain function, reads policy_words.txt, a text file, and routes OK to the scripter or BLOCK to quarantine, before the render that costs money.")}>
        <rect x="6" y="10" width="88" height="34" rx="4" fill="var(--overlay)" stroke="currentColor" strokeOpacity="0.5" />
        <path d="M84 10 L 94 20 L 84 20 Z" fill="var(--overlay)" stroke="currentColor" strokeOpacity="0.5" />
        {note(50, 26, "policy_words.txt", undefined, "middle")}
        {note(50, 37, "data", RED, "middle")}
        {arrow(50, 46, 50, 62)}
        {box(8, 64, 84, "policy_check", RED)}
        {note(50, 100, t("a function · code"), RED, "middle")}
        <path d="M92 70 C 118 70, 118 44, 140 44" fill="none" stroke={GREEN} strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        <path d="M92 80 C 118 80, 118 100, 140 100" fill="none" stroke={RED} strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        {note(116, 40, '"OK"', GREEN, "middle")}
        {note(116, 112, '"BLOCK"', RED, "middle")}
        {box(142, 33, 66, "scripter", PURPLE)}
        {box(142, 89, 66, "quarantine", PURPLE)}
        {arrow(208, 44, 232, 44)}
        {box(234, 33, 78, "render_desk", AMBER, true)}
        {note(273, 70, t("Veo · costs money"), AMBER, "middle")}
        {note(273, 82, t("decided before this"), undefined, "middle")}
      </RuleFigure>
    ),
  },
  {
    text: t("Context that belongs to one agent rides a callback on that agent. Research that produces data before the model runs is a node in the fan-out."),
    figure: (
      <RuleFigure label={t("Left: propose_directions with a before_model_callback that reads Memory Bank, the creator's taste, context for that one agent. Right: read_feedback, a node in the fan-out beside the other readers, that reads the RAG corpus and hands data to the join before any model runs.")}>
        <line x1="164" y1="8" x2="164" y2="110" stroke="var(--hairline)" />
        {box(32, 40, 100, "propose_directions", PURPLE)}
        <rect x="30" y="10" width="104" height="18" rx="9" fill={tint(CYAN, 0.12)} stroke={CYAN} strokeWidth="1" />
        <text x="82" y="22" fontSize="7.5" style={mono} textAnchor="middle" fill={CYAN}>before_model_callback</text>
        {arrow(82, 28, 82, 38, CYAN)}
        {note(82, 78, t("Memory Bank · the creator's taste"), CYAN, "middle")}
        {note(82, 92, t("one agent's context"), undefined, "middle")}
        {note(82, 104, t("rides that agent"), undefined, "middle")}
        {box(172, 12, 72, "scan_trends")}
        {box(172, 40, 72, "read_backlog")}
        {box(172, 68, 72, "read_feedback", CYAN)}
        {arrow(244, 23, 268, 46)}
        {arrow(244, 51, 268, 51)}
        {arrow(244, 79, 268, 56)}
        {box(270, 40, 44, "join", CYAN)}
        {note(208, 96, t("RAG Engine · the comments"), CYAN, "middle")}
        {note(244, 108, t("data, before any model: a node"), undefined, "middle")}
      </RuleFigure>
    ),
  },
  {
    text: t("The app owns the loop, not the graph: a Runner drives it, an event stream shows it, the graph itself does not know a page exists."),
    figure: (
      <RuleFigure label={t("The app, holding the page, a Runner and an event stream, drives the graph and shows its events. The graph, in its own box, has no arrow back to the page.")}>
        <rect x="8" y="8" width="150" height="104" rx="10" fill={tint(BLUE, 0.05)} stroke={BLUE} strokeWidth="1.1" />
        {note(83, 22, t("the app"), BLUE, "middle")}
        {box(18, 30, 60, t("the page"), BLUE)}
        {box(88, 30, 60, "Runner", BLUE)}
        {box(18, 82, 130, t("event stream"), BLUE)}
        {arrow(48, 52, 48, 80, BLUE)}
        {note(52, 68, "shows", BLUE)}
        <rect x="186" y="8" width="126" height="104" rx="10" fill="var(--overlay)" stroke="var(--hairline)" />
        {note(249, 22, t("the graph"), undefined, "middle")}
        {box(196, 32, 50, "join")}
        {box(256, 32, 48, "propose")}
        {box(196, 62, 50, "gate", AMBER)}
        {box(256, 62, 48, "desk", AMBER)}
        {arrow(148, 41, 184, 41, BLUE)}
        {note(166, 36, "runs", BLUE, "middle")}
        <path d="M186 90 L 150 90" fill="none" stroke={BLUE} strokeWidth="1.1" markerEnd="url(#rule-arrow)" />
        {note(166, 100, "events", BLUE, "middle")}
        {note(249, 104, t("knows no page"), undefined, "middle")}
      </RuleFigure>
    ),
  },
];

/* ── share the video ────────────────────────────────────────────────────── */

/** The screenshot slot: web/public/share.png when it exists, a marked space until then. */
function ShareImage() {
  const [missing, setMissing] = useState(false);
  return (
    <div className="mt-5">
      {!missing && (
        <img src="/share.png" alt={t("A published clip on vibetube.dev")} className="w-full rounded-2xl border border-hairline" onError={() => setMissing(true)} />
      )}
      {missing && (
        <div className="flex aspect-[16/7] w-full items-center justify-center rounded-2xl border border-dashed border-hairline bg-overlay font-mono text-[11px] text-fg-muted">
          {t("image · web/public/share.png")}</div>
      )}
    </div>
  );
}

type Kind = "start" | "func" | "join" | "agent" | "human" | "router" | "task" | "desk";

interface NodeInfo {
  name: string;
  kind: Kind;
  step: string;
  to: string;
  concepts: string[];
}

const NODES: NodeInfo[] = [
  {
    name: "START",
    kind: "start",
    step: t("Step 4a · Graph architecture and execution chains"),
    to: "/step/fan-out/a",
    concepts: [
      "Workflow graph initialization and edge list definition",
      "START sentinel routing concurrent root execution chains",
      "Tuple-based linear subgraphs composed into an execution DAG",
    ],
  },
  {
    name: "scan_trends",
    kind: "func",
    step: t("Step 4b · Parallel research fan-out"),
    to: "/step/fan-out/b",
    concepts: [
      "Deterministic FunctionNode that receives node_input and emits Event(output=...)",
      "Concurrent edge traversal from START executed in parallel",
      "Dynamic trend ingestion into structured context dictionaries",
    ],
  },
  {
    name: "read_backlog",
    kind: "func",
    step: t("Step 4b · Parallel research fan-out"),
    to: "/step/fan-out/b",
    concepts: [
      "Local file ingestion of creator backlog context",
      "Resolves idea_text from initial invocation payload",
      "Stateless node execution shared between development and production",
    ],
  },
  {
    name: "read_feedback",
    kind: "func",
    step: t("Step 7b · The third reader"),
    to: "/step/rag/b",
    concepts: [
      "GEAP RAG Engine corpus integration with dense vector search",
      "Semantic similarity query for context-driven passage retrieval",
      "Parallel retrieval reader feeding directly into JoinNode synchronization",
    ],
  },
  {
    name: "join_research",
    kind: "join",
    step: t("Step 4b · Parallel research fan-out"),
    to: "/step/fan-out/b",
    concepts: [
      "JoinNode synchronization barrier awaiting all incoming inbound edges",
      "Aggregates branch outputs into a unified dictionary keyed by node name",
      "Modular edge topology where adding research branches requires a single edge definition",
    ],
  },
  {
    name: "propose_directions",
    kind: "agent",
    step: t("Step 4c · Agent nodes"),
    to: "/step/fan-out/c",
    concepts: [
      "Single-turn AgentNode executing Gemini structured inference",
      "output_schema guarantees validated multi-candidate Pydantic models",
      "before_model_callback injects personalized taste memories from Agent Runtime",
    ],
  },
  {
    name: "direction_gate",
    kind: "human",
    step: t("Step 4d · Human-in-the-loop"),
    to: "/step/fan-out/d",
    concepts: [
      "RequestInput event suspends workflow execution asynchronously",
      "Exposes response_schema, candidate payload, and unique interrupt_id",
      "Execution resumes via FunctionResponse targeting matching call_id",
    ],
  },
  {
    name: "persist_direction",
    kind: "func",
    step: t("Step 5a · Workflow State"),
    to: "/step/policy-gate/a",
    concepts: [
      "Event(state=...) commits variables to shared session state",
      "parameter_binding injects state variables directly into node signatures",
      "User-scoped keys persist across sessions; mirrored to disk for external workers",
    ],
  },
  {
    name: "policy_check",
    kind: "router",
    step: t("Step 5b · The router node"),
    to: "/step/policy-gate/b",
    concepts: [
      "RouterNode emits Event(route=...) for deterministic conditional branching",
      "Policy-as-data enforcement through dynamic evaluation against policy rules",
      "Dictionary-based target routing maps outcome labels to downstream nodes",
    ],
  },
  {
    name: "scripter",
    kind: "agent",
    step: t("Step 5b · The router node"),
    to: "/step/policy-gate/b",
    concepts: [
      "Downstream AgentNode generating complete video script and visual prompts",
      "after_agent_callback commits selected direction to long-term Memory Bank",
      "Pydantic-validated production script with shot breakdown and dialogue",
    ],
  },
  {
    name: "quarantine",
    kind: "task",
    step: t("Step 5c · Agent modes and the task node"),
    to: "/step/policy-gate/c",
    concepts: [
      "Autonomous task-mode loop that iterates tool calls until finish_task is invoked",
      "Interactive remediation that identifies violations and applies replacements",
      "Sanitizes non-compliant directions before re-entering generation pipeline",
    ],
  },
  {
    name: "render_desk",
    kind: "desk",
    step: t("Step 8a · A long-running tool"),
    to: "/step/video/a",
    concepts: [
      "LongRunningFunctionTool emits pending receipt without blocking worker thread",
      "Workflow suspends waiting for asynchronous external tool completion",
      "Resumed by call_id via external delivery poller or webhook",
    ],
  },
  {
    name: "store_video",
    kind: "func",
    step: t("Step 8b · render_desk in the graph"),
    to: "/step/video/b",
    concepts: [
      "Persists final video asset URI and metadata into shared session state",
      "Inter-process synchronization between background poller and workflow runner",
      "Terminal node completing end-to-end multi-modal content generation",
    ],
  },
];

const KIND_LABEL: Record<Kind, string> = {
  start: t("entry sentinel"),
  func: t("function node"),
  join: t("join barrier"),
  agent: t("agent node"),
  human: t("human-in-the-loop gate"),
  router: t("conditional router"),
  task: t("task-mode agent"),
  desk: t("long-running tool"),
};

const STEP_ROWS = [
  {
    step: t("Step 3 · Monolithic Agent Architecture"),
    covered: t("Single-agent orchestration with function tools; function_call and function_response mechanics; architectural limitations of unstructured natural language coordination between pipeline stages"),
  },
  {
    step: t("Step 4 · Agentic Workflow Fundamentals"),
    covered: t("Workflow DAG initialization, START sentinel, edge lists as chained tuples; JoinNode synchronization barriers; AgentNode with structured output_schema; RequestInput suspension with response_schema, candidate payload, and interrupt_id"),
  },
  {
    step: t("Step 5 · State Management & Conditional Routing"),
    covered: "Event(state=...) mutation, parameter_binding injection, user-scoped persistence; deterministic RouterNode branching; policy-as-data enforcement; autonomous task-mode agents with tool remediation loops",
  },
  {
    step: t("Step 6 · Long-Term Memory Bank"),
    covered: t("Memory Bank lifecycle covering episodic ingestion, LLM consolidation, and custom user-scoped topics; memories.generate and retrieve APIs; before_model_callback dynamic context injection and after_agent_callback preference extraction"),
  },
  {
    step: "Step 7 · Enterprise Retrieval (RAG Engine)",
    covered: t("GEAP RAG Engine infrastructure covering corpus management, document chunking, and text-embedding-004 vector search; parallel retrieval reader integrated into JoinNode synchronization; grounded multi-modal generation"),
  },
  {
    step: t("Step 8 · Long-Running Video Generation"),
    covered: t("LongRunningFunctionTool protocol, pending receipt generation, asynchronous workflow suspension at agent nodes; decoupled delivery resumption by call_id across independent processes; Veo video generation API with exponential backoff"),
  },
  {
    step: t("Step 9 · Production Deployment Architecture"),
    covered: "ADK Runner orchestration with run_async; decoupled FastAPI server with Server-Sent Events (SSE) telemetry stream; containerized deployment to Google Cloud Run with session affinity and warm instances",
  },
];

export function Summary() {
  const [hover, setHover] = useState<string | null>(null);
  const node = NODES.find((n) => n.name === hover) ?? null;
  return (
    <div className="space-y-12">
      <StepHeader
        kicker={t("Step 10 · Summary")}
        color={PURPLE}
        title={t("Complete workflow topology and architectural summary.")}
        blurb={t("Comprehensive review of the production workflow topology, from initial idea fan-out to long-running video asset delivery. Inspect each node to review underlying architectural patterns, state contracts, and lifecycle hooks.")}
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("Workflow Topology")}</p>
          <SnakeGraph hover={hover === "START" ? "__START__" : hover} onHover={(n) => setHover(n === "__START__" ? "START" : n)} label={t("Complete production workflow topology where START fans out to scan_trends, read_backlog, and read_feedback, synchronizing at join_research before propose_directions. The direction_gate suspends for human review, followed by persist_direction and policy_check routing to either scripter or quarantine. The workflow concludes at render_desk and store_video. Select a node to inspect architectural details.")} />
          <div className="mt-4 min-h-[112px] rounded-2xl border border-hairline bg-overlay p-4">
            {node ? (
              <motion.div key={node.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-sm text-fg">
                    {node.name} <span className="text-fg-muted">· {KIND_LABEL[node.kind] || "entry sentinel"}</span>
                  </p>
                  <Link to={node.to} className="font-mono text-[11px] text-vibe-cyan hover:underline">
                    {node.step} →
                  </Link>
                </div>
                <ul className="mt-2 grid gap-1 text-sm text-fg-muted md:grid-cols-3">
                  {node.concepts.map((c) => (
                    <li key={c} className="rounded-xl border border-hairline bg-card px-3 py-2">
                      {c}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : (
              <p className="text-sm text-fg-muted">{t("Select or hover a node to inspect its architectural pattern, implementation details, and learning module.")}</p>
            )}
          </div>
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("Curriculum Overview")}</p>
          <h2 className="font-display mt-2 text-2xl">{t("Core architectural concepts by module.")}</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  <th className="pb-2 pr-4">{t("Step")}</th>
                  <th className="pb-2">{t("Concepts")}</th>
                </tr>
              </thead>
              <tbody>
                {STEP_ROWS.map((r) => (
                  <tr key={r.step} className="border-t border-hairline align-top">
                    <td className="py-2 pr-4 font-semibold text-fg">{r.step}</td>
                    <td className="py-2 text-fg-muted">{r.covered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("Design rules the graph follows")}</p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {RULES.map((r) => (
              <li key={r.text} className="rounded-2xl border border-hairline bg-overlay p-3">
                <div className="rounded-xl bg-card p-2">{r.figure}</div>
                <p className="mt-3 text-sm text-fg-muted">{r.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </In>

      <In delay={0.35}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("Share it")}</p>
          <h2 className="font-display mt-2 text-2xl">{t("Post your video.")}</h2>
          <ol className="mt-3 max-w-3xl list-decimal space-y-2 pl-5 text-sm text-fg-muted">
            <li>
              {tx("Go to {0} and select the event you are in.", [<a href="https://vibetube.dev" target="_blank" rel="noreferrer" className="font-mono text-fg underline decoration-hairline underline-offset-4">
                vibetube.dev
              </a>])}</li>
            <li>{t("Click on your video.")}</li>
            <li>{t("Share it on social media and say what you made: the idea you started from, and the video the workflow made of it.")}</li>
          </ol>
          <ShareImage />
        </section>
      </In>
    </div>
  );
}
