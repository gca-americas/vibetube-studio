import { t } from "../i18n";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { In, StepHeader } from "../components/shared";
import { COLORS, tint } from "./colors";

/*
 * Step 3a: what an ADK agent is made of. Diagram on the left, a canonical
 * LlmAgent definition on the right; click any piece for a short note.
 * The Interceptor wraps the agent, model and tool calls (before and after
 * each). Context is what the agent reasons with. Collaboration is how it
 * acts and works with others. Session and Memory live outside the agent.
 */

const CYAN = COLORS.cyan;
const BLUE = COLORS.blue;
const PURPLE = COLORS.purple;
const AMBER = COLORS.amber;
const GREEN = COLORS.green;

interface Piece {
  id: string;
  name: string;
  color: string;
  group: "model" | "context" | "collab" | "interceptor" | "state" | "output";
  hook?: boolean;
  what: string;
}

const PIECES: Record<string, Piece> = {
  interceptor: {
    id: "interceptor",
    name: "Interceptor",
    color: AMBER,
    group: "interceptor",
    what: t("Callbacks that run your deterministic code before and after the agent, before and after each model call, and before and after each tool call: before_agent/after_agent, before_model/after_model, before_tool/after_tool. Guardrails the model is not trusted to enforce on itself."),
  },
  model: { id: "model", name: "model", color: CYAN, group: "model", hook: true, what: t("The LLM the agent runs on, for example Gemini. It performs the reasoning; everything else feeds or constrains it.") },
  instruction: { id: "instruction", name: "instruction", color: BLUE, group: "context", what: t("The system prompt: the agent's standing directive, persona, and rules.") },
  skills: { id: "skills", name: "skills", color: BLUE, group: "context", what: "Versioned written procedures (SKILL.md) the agent follows so its steps are repeatable." },
  tools: { id: "tools", name: "tools", color: PURPLE, group: "collab", hook: true, what: t("What the agent can do: plain Python functions or MCP tools it can call. ADK builds the tool declaration from the function's name, signature, and docstring.") },
  subagents: { id: "subagents", name: "subagents", color: PURPLE, group: "collab", what: t("Full agents nested inside this one, invoked as steps of its work.") },
  workflow: { id: "workflow", name: "workflow (graph, direct)", color: PURPLE, group: "collab", what: "How steps are orchestrated: a directed graph of nodes (fan-out, join, routers) or a direct sequence. The Workflow you build in this lab is one of these." },
  output: { id: "output", name: "output_schema", color: GREEN, group: "output", what: "A Pydantic model the agent's final answer must fill, so downstream code (an orchestrator, a UI) always receives structured JSON, never free-form prose." },
  session: { id: "session", name: "Session", color: PURPLE, group: "state", what: t("Per-conversation state and the event log: the working memory of the current run. Lives outside the agent, in a SessionService.") },
  memory: { id: "memory", name: "Memory", color: PURPLE, group: "state", what: t("Long-term memory that persists across sessions. Lives outside the agent, in a MemoryService such as GEAP Memory Bank.") },
};

const CODE = `from google.adk.agents import LlmAgent
from google.adk.tools import mcp_toolset

root_agent = LlmAgent(
    model="gemini-3.5-flash",                 # model
    instruction=BRAND_INSTRUCTION,            # instruction
    skills=[load_skill("brand-audit")],       # skills
    tools=[mcp_toolset("mcp_brand_style")],   # tools
    output_schema=BrandStyleReport,
    before_agent_callback=setup_ctx,          # interceptor
    before_model_callback=require_image,      # interceptor
    after_model_callback=schema_guard,        # interceptor
)`;

export function AdkGlance() {
  const [sel, setSel] = useState<string | null>(null);
  const piece = sel ? PIECES[sel] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-10">
      <StepHeader
        kicker={t("Step 3a · ADK agent architecture")}
        color={BLUE}
        title={t("An ADK agent at a glance.")}
        blurb={t("ADK is Google's code-first framework for building agents in Python. An agent is a model plus the context it reasons with, the tools and collaborators it acts through, and the callbacks that wrap each call. Click any piece.")}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <In delay={0.15} className="flex flex-col gap-2">
          <Bar piece={PIECES.interceptor} onClick={setSel} full>
            <span className="ml-auto font-mono text-[10px] opacity-80">{t("before ▸ ◂ after · agent · model · tool")}</span>
          </Bar>

          <div className="rounded-2xl border border-hairline bg-overlay p-2">
            <GroupLabel color={CYAN} title="Model" tag="the LLM it runs on" />
            <Bar piece={PIECES.model} onClick={setSel} />
            <div className="mt-2">
              <GroupLabel color={BLUE} title={t("Context")} tag="shapes how it reasons" />
              <div className="flex flex-col gap-1.5">
                <Bar piece={PIECES.instruction} onClick={setSel} />
                <Bar piece={PIECES.skills} onClick={setSel} />
              </div>
            </div>
            <div className="mt-2">
              <GroupLabel color={PURPLE} title={t("Collaboration")} tag="collaborate and execute" />
              <div className="flex flex-col gap-1.5">
                <Bar piece={PIECES.tools} onClick={setSel} />
                <Bar piece={PIECES.subagents} onClick={setSel} />
                <Bar piece={PIECES.workflow} onClick={setSel} />
                <Bar piece={PIECES.output} onClick={setSel} />
              </div>
            </div>
          </div>

          <p className="mt-1 px-1 font-mono text-[10px] text-fg-muted">{t("Outside the agent · external state")}</p>
          <div className="flex items-stretch gap-2">
            <MiniChip piece={PIECES.session} onClick={setSel} />
            <MiniChip piece={PIECES.memory} onClick={setSel} />
          </div>
        </In>

        <In delay={0.3}>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-card">
            <div className="flex items-center gap-2 border-b border-hairline bg-overlay px-3 py-2 font-mono text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: BLUE }} />
              <span className="text-fg-muted">{t("agents/brand_style/agent.py · a typical agent definition")}</span>
            </div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-fg">
              <code>{CODE}</code>
            </pre>
            <p className="border-t border-hairline px-4 py-2 text-[11px] text-fg-muted">
              {t("Every field maps to a piece on the left; the comments name them. The agent you meet next, in 3b, uses three of these fields: model, instruction, and tools.")}</p>
          </div>
        </In>
      </div>

      <AnimatePresence>{piece && <Popup piece={piece} onClose={() => setSel(null)} />}</AnimatePresence>
    </div>
  );
}

function GroupLabel({ color, title, tag }: { color: string; title: string; tag: string }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2 px-1">
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
        {title}
      </span>
      <span className="font-mono text-[10px] text-fg-muted">· {tag}</span>
    </div>
  );
}

function Bar({ piece, onClick, full, children }: { piece: Piece; onClick: (id: string) => void; full?: boolean; children?: React.ReactNode }) {
  return (
    <button
      onClick={() => onClick(piece.id)}
      className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
      style={{ background: full ? tint(piece.color, 0.09) : "var(--card)", border: `1px solid ${tint(piece.color, full ? 0.53 : 0.27)}` }}
    >
      <span className="text-sm font-semibold" style={{ color: piece.color }}>
        {piece.name}
      </span>
      {piece.hook && (
        <span className="rounded px-1.5 py-0.5 font-mono text-[9px]" style={{ background: tint(AMBER, 0.13), color: AMBER }} title={t("an interceptor runs before and after this call")}>
          ⟲ before/after
        </span>
      )}
      {children ?? (
        <span className="ml-auto font-mono text-[10px] text-fg-muted opacity-0 transition-opacity group-hover:opacity-100">
          {t("what is this? →")}</span>
      )}
    </button>
  );
}

function MiniChip({ piece, onClick }: { piece: Piece; onClick: (id: string) => void }) {
  return (
    <button
      onClick={() => onClick(piece.id)}
      className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
      style={{ background: "var(--card)", border: `1px solid ${tint(piece.color, 0.27)}`, color: piece.color }}
    >
      {piece.name}
    </button>
  );
}

function Popup({ piece, onClose }: { piece: Piece; onClose: () => void }) {
  const groupLabel = { model: "Model", context: t("Context"), collab: t("Collaboration"), interceptor: t("Interceptor"), state: "External state", output: t("Output") }[piece.group];
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-md rounded-2xl border bg-card p-5"
        style={{ borderColor: tint(piece.color, 0.4) }}
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: piece.color }}>
            {piece.name}
          </h3>
          <span className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider" style={{ background: tint(piece.color, 0.12), color: piece.color }}>
            {groupLabel}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">{piece.what}</p>
        <button onClick={onClose} className="mt-4 text-xs font-semibold text-fg-muted underline decoration-dotted underline-offset-4 hover:text-fg">
          {t("Close")}</button>
      </motion.div>
    </motion.div>
  );
}
