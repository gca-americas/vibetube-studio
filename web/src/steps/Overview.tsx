import { t } from "../i18n";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { In, StepHeader } from "../components/shared";
import { COLORS, tint } from "./colors";

type Kind = "start" | "function" | "join" | "agent" | "human" | "router" | "task" | "desk";

interface GNode {
  name: string;
  kind: Kind;
  layer: number;
  row: number;
  rows: number;
  step: string;
}

/** The finished workflow, the way the app draws it: layers snake across rows,
 *  the first row runs left to right, the second runs back. */
const ALL_NODES: GNode[] = [
  { name: "__START__", kind: "start", layer: 0, row: 0, rows: 1, step: "" },
  { name: "scan_trends", kind: "function", layer: 1, row: 0, rows: 3, step: "step 4" },
  { name: "read_backlog", kind: "function", layer: 1, row: 1, rows: 3, step: "step 4" },
  { name: "read_feedback", kind: "function", layer: 1, row: 2, rows: 3, step: "step 7" },
  { name: "join_research", kind: "join", layer: 2, row: 0, rows: 1, step: "step 4" },
  { name: "propose_directions", kind: "agent", layer: 3, row: 0, rows: 1, step: "step 4 · 6" },
  { name: "direction_gate", kind: "human", layer: 4, row: 0, rows: 1, step: "step 4" },
  { name: "persist_direction", kind: "function", layer: 5, row: 0, rows: 1, step: "step 5" },
  { name: "policy_check", kind: "router", layer: 6, row: 0, rows: 1, step: "step 5" },
  { name: "scripter", kind: "agent", layer: 7, row: 0, rows: 2, step: "step 5 · 6" },
  { name: "quarantine", kind: "task", layer: 7, row: 1, rows: 2, step: "step 5" },
  { name: "render_desk", kind: "desk", layer: 8, row: 0, rows: 1, step: "step 8" },
  { name: "store_video", kind: "function", layer: 9, row: 0, rows: 1, step: "step 8" },
];

const ALL_EDGES: { from: string; to: string; route?: string }[] = [
  { from: "__START__", to: "scan_trends" },
  { from: "__START__", to: "read_backlog" },
  { from: "__START__", to: "read_feedback" },
  { from: "scan_trends", to: "join_research" },
  { from: "read_backlog", to: "join_research" },
  { from: "read_feedback", to: "join_research" },
  { from: "join_research", to: "propose_directions" },
  { from: "propose_directions", to: "direction_gate" },
  { from: "direction_gate", to: "persist_direction" },
  { from: "persist_direction", to: "policy_check" },
  { from: "policy_check", to: "scripter", route: "OK" },
  { from: "policy_check", to: "quarantine", route: "BLOCK" },
  { from: t("quarantine"), to: "scripter" },
  { from: t("scripter"), to: "render_desk" },
  { from: "render_desk", to: "store_video" },
];

const ALL_ORDER = ["__START__", "scan_trends", "read_backlog", "read_feedback", "join_research", "propose_directions", "direction_gate", "persist_direction", "policy_check", t("scripter"), "render_desk", "store_video"];

const KIND_COLOR: Record<Kind, string> = {
  start: "currentColor",
  function: "currentColor",
  join: COLORS.cyan,
  agent: COLORS.purple,
  human: COLORS.amber,
  router: COLORS.red,
  task: COLORS.purple,
  desk: COLORS.amber,
};
const KIND_LABEL: Record<Kind, string> = {
  start: "",
  function: t("function"),
  join: "join",
  agent: t("agent"),
  human: t("your pick"),
  router: t("router"),
  task: "agent (mode: task)",
  desk: t("long-running tool"),
};

const COLS = 5;
const COL = 200;
const STACK = 84;
const W = 160;
const H = 34;
const PAD = 26;
const mono = { fontFamily: "var(--font-mono)" } as const;

/** The workflow drawn the way the app draws it. `only` limits it to the nodes
 *  built so far (layers are re-packed, a layer's stack is re-counted);
 *  `highlight` marks the node added in the current part. */
export function SnakeGraph({ only, highlight, cols = COLS, label, hover, onHover }: { only?: string[]; highlight?: string; cols?: number; label?: string; hover?: string | null; onHover?: (name: string | null) => void } = {}) {
  const NODES = useMemo(() => {
    const keep = only ? ALL_NODES.filter((n) => only.includes(n.name)) : ALL_NODES;
    const layers = [...new Set(keep.map((n) => n.layer))].sort((a, b) => a - b);
    return keep.map((n) => {
      const layer = layers.indexOf(n.layer);
      const same = keep.filter((m) => m.layer === n.layer);
      return { ...n, layer, row: same.indexOf(n), rows: same.length };
    });
  }, [only]);
  const names = new Set(NODES.map((n) => n.name));
  const EDGES = ALL_EDGES.filter((e) => names.has(e.from) && names.has(e.to));
  const ORDER = ALL_ORDER.filter((n) => names.has(n));
  const rowOf = (layer: number) => Math.floor(layer / cols);
  const colOf = (layer: number) => (rowOf(layer) % 2 === 0 ? layer % cols : cols - 1 - (layer % cols));
  const rows = Math.max(...NODES.map((n) => rowOf(n.layer))) + 1;
  const stackOf = Array.from({ length: rows }, (_, r) => Math.max(1, ...NODES.filter((n) => rowOf(n.layer) === r).map((n) => n.rows)));
  const rowTop: number[] = [];
  let y = PAD;
  for (let r = 0; r < rows; r++) {
    rowTop.push(y);
    y += stackOf[r] * STACK + 34;
  }
  const height = y;
  const width = PAD * 2 + Math.min(cols, NODES.length) * COL - (COL - W);
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of NODES) {
    const r = rowOf(n.layer);
    const mid = rowTop[r] + (stackOf[r] * STACK) / 2;
    pos.set(n.name, { x: PAD + W / 2 + colOf(n.layer) * COL, y: mid + (n.row - (n.rows - 1) / 2) * STACK });
  }
  const layerOf = new Map(NODES.map((n) => [n.name, n.layer]));
  const labelAbove = new Set(EDGES.filter((e) => pos.get(e.from)!.x === pos.get(e.to)!.x && pos.get(e.from)!.y > pos.get(e.to)!.y).map((e) => e.to));
  const path = (from: string, to: string) => {
    const A = pos.get(from)!;
    const B = pos.get(to)!;
    const la = layerOf.get(from)!;
    const lb = layerOf.get(to)!;
    if (rowOf(la) !== rowOf(lb)) {
      const y1 = from === "__START__" ? A.y + 14 : A.y + H / 2;
      const y2 = B.y - H / 2;
      return A.x === B.x ? `M${A.x} ${y1} L${B.x} ${y2}` : `M${A.x} ${y1} C ${A.x} ${(y1 + y2) / 2}, ${B.x} ${(y1 + y2) / 2}, ${B.x} ${y2}`;
    }
    if (A.x === B.x) {
      const up = B.y < A.y;
      return `M${A.x} ${A.y + (up ? -H / 2 : H / 2)} L${B.x} ${B.y + (up ? H / 2 : -H / 2)}`;
    }
    const dir = rowOf(la) % 2 === 0 ? 1 : -1;
    const x1 = from === "__START__" ? A.x + 14 * dir : A.x + (W / 2) * dir;
    const x2 = B.x - (W / 2) * dir;
    return A.y === B.y ? `M${x1} ${A.y} L${x2} ${B.y}` : `M${x1} ${A.y} C ${x1 + 34 * dir} ${A.y}, ${x2 - 34 * dir} ${B.y}, ${x2} ${B.y}`;
  };
  const period = ORDER.length * 0.5 + 1.5;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto h-auto w-full min-w-[760px] max-w-[1080px] text-fg" role="img" aria-label={label ?? t("The finished workflow: START fans out to scan_trends, read_backlog and read_feedback, then join_research, propose_directions, direction_gate, persist_direction, policy_check routing OK to scripter and BLOCK to quarantine, render_desk, store_video.")}>
        <defs>
          <marker id="ov-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0L10 5 0 10z" fill="#7b8794" />
          </marker>
        </defs>
        {EDGES.map((e) => {
          const A = pos.get(e.from)!;
          const B = pos.get(e.to)!;
          const label = e.route ?? (e.from === "quarantine" ? "cleaned" : "");
          const vertical = A.x === B.x;
          return (
            <g key={`${e.from}-${e.to}`}>
              <path d={path(e.from, e.to)} fill="none" stroke={e.route === "BLOCK" ? COLORS.red : e.route === "OK" ? COLORS.green : "currentColor"} strokeOpacity={e.route ? 0.9 : 0.45} strokeWidth="1.3" strokeDasharray={e.from === "quarantine" ? "5 4" : undefined} markerEnd="url(#ov-arrow)" />
              {label && (
                <text x={(A.x + B.x) / 2 + (vertical ? 10 : 0)} y={(A.y + B.y) / 2 + (vertical ? 12 : -7)} fontSize="10" style={mono} fill={label === "BLOCK" ? COLORS.red : label === "OK" ? COLORS.green : COLORS.purple} textAnchor={vertical ? "start" : "middle"}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {NODES.map((n) => {
          const p = pos.get(n.name)!;
          const color = KIND_COLOR[n.kind];
          const idx = ORDER.indexOf(n.name);
          if (n.kind === "start") {
            return (
              <g key={n.name} onMouseEnter={onHover ? () => onHover(n.name) : undefined} onMouseLeave={onHover ? () => onHover(null) : undefined} style={onHover ? { cursor: "pointer" } : undefined}>
                <circle cx={p.x} cy={p.y} r={15} fill="var(--overlay)" stroke={hover === n.name ? COLORS.cyan : "currentColor"} strokeOpacity={hover === n.name ? 1 : 0.6} strokeWidth={hover === n.name ? 2 : 1} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" style={mono} fill="currentColor">START</text>
              </g>
            );
          }
          return (
            <g key={n.name} transform={`translate(${p.x - W / 2} ${p.y - H / 2})`} onMouseEnter={onHover ? () => onHover(n.name) : undefined} onMouseLeave={onHover ? () => onHover(null) : undefined} style={onHover ? { cursor: "pointer" } : undefined}>
              {idx >= 0 && (
                <motion.rect x={-5} y={-5} width={W + 10} height={H + 10} rx={13} fill="none" stroke={color === "currentColor" ? COLORS.cyan : color} strokeWidth={5} initial={{ opacity: 0 }} animate={{ opacity: [0, 0.5, 0] }} transition={{ duration: 1.0, delay: idx * 0.5, repeat: Infinity, repeatDelay: period - 1.0 }} />
              )}
              {n.name === highlight && <rect x={-4} y={-4} width={W + 8} height={H + 8} rx={12} fill="none" stroke={COLORS.red} strokeWidth="1.5" strokeDasharray="5 4" />}
              <rect width={W} height={H} rx={9} fill={hover === n.name ? tint(color === "currentColor" ? COLORS.cyan : color, 0.16) : n.kind === "function" ? "var(--overlay)" : tint(color, 0.08)} stroke={hover === n.name ? (color === "currentColor" ? COLORS.cyan : color) : color === "currentColor" ? "var(--hairline)" : color} strokeWidth={hover === n.name ? 2 : 1.2} />
              <text x={W / 2} y={21} textAnchor="middle" fontSize="12.5" style={mono} fill={color === "currentColor" ? "currentColor" : color}>{n.name}</text>
              <text x={W / 2} y={labelAbove.has(n.name) ? -8 : H + 13} textAnchor="middle" fontSize="9.5" style={mono} fill={n.name === highlight ? COLORS.red : "currentColor"} opacity={n.name === highlight ? 1 : 0.6}>
                {n.name === highlight ? t("new in this part") : `${KIND_LABEL[n.kind]}${n.step ? ` · ${n.step}` : ""}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const YOU = [t("Type the video idea."), t("Pick one of four directions."), t("Publish the clip when it lands.")];
const WHAT_YOU_LEARN = [
  t("Graph engineering foundations: Workflow, edge tuples, START, JoinNode for parallel fan-out, and deterministic router nodes."),
  t("Agent modes and lifecycle callbacks: chat, single_turn, and task modes as graph nodes, with interceptors."),
  t("Human-in-the-loop orchestration: RequestInput to suspend workflows for human decisions and resume with structured schemas."),
  t("Hierarchical agent memory: Session state via parameter binding and persistent GEAP Memory Bank context."),
  t("Knowledge grounding: GEAP RAG Engine corpus integrated as a parallel retrieval node for audience feedback."),
  t("Long-running workflows and deployment: LongRunningFunctionTool receipts, resuming by ID, and Cloud Run deployment."),
];

const LEGEND: { kind: Kind; label: string }[] = [
  { kind: "function", label: t("function node") },
  { kind: "join", label: "join" },
  { kind: "agent", label: t("agent as a node") },
  { kind: "human", label: "your decision (RequestInput)" },
  { kind: "router", label: t("router") },
  { kind: "task", label: "agent (mode: task)" },
  { kind: "desk", label: t("long-running tool") },
];

export function Overview() {
  return (
    <div className="space-y-12">
      <StepHeader
        kicker={t("Step 2 · What you build today")}
        color={COLORS.purple}
        title={t("A production pipeline as an explicit graph.")}
        blurb={t("An ADK Workflow executes end-to-end video production, managing parallel research, human-in-the-loop pauses, asynchronous video generation, and Cloud Run deployment.")}
      />

      {/* The graph, drawn the way the app draws it */}
      <In delay={0.15}>
        <div className="rounded-3xl border border-hairline bg-card p-5 shadow-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("The workflow you finish with · each node names the step that adds it")}</p>
          <SnakeGraph />
          <div className="mt-2 flex flex-wrap gap-4 font-mono text-[10px] text-fg-muted">
            {LEGEND.map((l) => (
              <span key={l.kind} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded" style={{ border: `1.5px solid ${KIND_COLOR[l.kind] === "currentColor" ? "var(--hairline)" : KIND_COLOR[l.kind]}`, background: l.kind === "function" ? "var(--overlay)" : tint(KIND_COLOR[l.kind], 0.08) }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      </In>

      {/* You vs automated */}
      <In delay={0.35}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-vibe-amber/40 bg-vibe-amber/5 p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-vibe-amber">{t("Your inputs, per video")}</p>
            <ol className="mt-4 space-y-3">
              {YOU.map((t, i) => (
                <li key={t} className="flex items-start gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-vibe-amber text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-3xl border border-hairline bg-card p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("What you learn")}</p>
            <ul className="mt-4 space-y-2">
              {WHAT_YOU_LEARN.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-fg-muted">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vibe-cyan" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </In>

    </div>
  );
}
