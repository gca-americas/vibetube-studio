import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, RefreshCw } from "lucide-react";
import { In, StepHeader } from "../components/shared";
import { LoadCheck } from "../components/LoadCheck";
import { api, useRunEvents } from "../lib/api";
import type { Stage3Status } from "../lib/types";
import { COLORS, tint } from "./colors";
import { CheckRow, DEFAULT_IDEA, EditPanel, RunPanel, VerifyPanel } from "./FanOut";
import { SnakeGraph } from "./Overview";

/*
 * Step 5, in parts:
 *   5a  state: persist_direction reads candidates from shared state by parameter
 *       name and writes the pick back with Event(state=...); append it, write the
 *       state, run, open the State tab
 *   5b  the router node: policy_check returns a route, the edge dict maps it;
 *       finish the router's return, wire the router, run both routes
 *   5c  agent modes; quarantine rebuilt as a task-mode agent that replaces the
 *       refused words with tools until the direction is clean, then hands it to
 *       the scripter; reroute quarantine -> scripter
 */

const RED = COLORS.red;
const AMBER = COLORS.amber;
const CYAN = COLORS.cyan;
const PURPLE = COLORS.purple;
const GREEN = COLORS.green;

type Part = "a" | "b" | "c";
const PARTS: { id: Part; label: string }[] = [
  { id: "a", label: "Workflow State" },
  { id: "b", label: "The router node" },
  { id: "c", label: "Agent modes and the task node" },
];

export function PolicyGate() {
  const { part: partParam } = useParams();
  const part: Part = PARTS.some((p) => p.id === partParam) ? (partParam as Part) : "a";
  const idx = PARTS.findIndex((p) => p.id === part);
  return (
    <div className="space-y-12">
      {part === "a" && <StateNode />}
      {part === "b" && <RouterNode />}
      {part === "c" && <TaskNode />}
      <div className="flex items-center justify-between border-t border-hairline pt-6">
        {idx > 0 ? (
          <Link to={`/step/policy-gate/${PARTS[idx - 1].id}`} className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-fg-muted hover:text-fg">
            ← 5{PARTS[idx - 1].id} · {PARTS[idx - 1].label}
          </Link>
        ) : (
          <span />
        )}
        {idx < PARTS.length - 1 && (
          <Link to={`/step/policy-gate/${PARTS[idx + 1].id}`} className="flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold text-white" style={{ background: RED }}>
            Continue to 5{PARTS[idx + 1].id} · {PARTS[idx + 1].label} <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

function useStage3() {
  const [status, setStatus] = useState<Stage3Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const { snapshot } = useRunEvents();
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.labStage3());
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


/** The router and its two exits; with reroute, the 5c edge back to the scripter. */
function RouterFigure({ reroute }: { reroute: boolean }) {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  return (
    <figure className="m-0">
      <svg viewBox="0 0 620 190" role="img" aria-label={reroute ? "persist_direction feeds policy_check, a router. OK goes to scripter, BLOCK goes to quarantine, and quarantine now continues to scripter." : "persist_direction feeds policy_check, a router. OK goes to scripter, BLOCK goes to quarantine, where the run ends."} className="h-auto w-full text-fg" style={{ maxWidth: "100%" }}>
        <defs>
          <marker id="rt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <rect x="10" y="82" width="132" height="26" rx="8" {...box} />
        <text x="76" y="99" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor">persist_direction</text>
        <line x1="142" y1="95" x2="188" y2="95" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#rt-arrow)" />
        {/* the diamond */}
        <polygon points="260,50 330,95 260,140 190,95" fill={tint(AMBER, 0.12)} stroke={AMBER} strokeWidth="1.2" />
        <text x="260" y="92" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill={AMBER}>policy_check</text>
        <text x="260" y="106" fontSize="8.5" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor" opacity="0.7">a function node</text>
        {/* OK */}
        <path d="M330 95 C 370 95, 380 40, 430 40" fill="none" stroke={GREEN} strokeWidth="1.2" markerEnd="url(#rt-arrow)" />
        <text x="372" y="56" fontSize="9.5" fontFamily="var(--font-mono)" fill={GREEN}>route="OK"</text>
        <rect x="432" y="27" width="108" height="26" rx="8" {...box} />
        <text x="486" y="44" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor">scripter</text>
        <text x="486" y="66" fontSize="8.5" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor" opacity="0.6">agent node</text>
        {/* BLOCK */}
        <path d="M330 95 C 370 95, 380 150, 430 150" fill="none" stroke={RED} strokeWidth="1.2" markerEnd="url(#rt-arrow)" />
        <text x="366" y="142" fontSize="9.5" fontFamily="var(--font-mono)" fill={RED}>route="BLOCK"</text>
        <rect x="432" y="137" width="108" height="26" rx="8" fill={reroute ? tint(PURPLE, 0.12) : "var(--overlay)"} stroke={reroute ? PURPLE : "var(--hairline)"} />
        <text x="486" y="154" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill={reroute ? PURPLE : "currentColor"}>quarantine</text>
        <text x="486" y="176" fontSize="8.5" fontFamily="var(--font-mono)" textAnchor="middle" fill="currentColor" opacity="0.6">{reroute ? "task agent · clean the words" : "placeholder · says blocked, run ends"}</text>
        {reroute && (
          <>
            <path d="M540 150 C 590 150, 590 40, 542 40" fill="none" stroke={PURPLE} strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#rt-arrow)" />
            <text x="598" y="99" fontSize="9" fontFamily="var(--font-mono)" fill={PURPLE} textAnchor="middle" transform="rotate(90 598 99)">cleaned</text>
          </>
        )}
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">
        {reroute ? "After Step 5c, the refused direction is cleaned and continues to the scripter instead of ending the run." : "The router returns a route name; the edge dict maps each name to a node. In Step 5b, a blocked direction ends the run."}
      </figcaption>
    </figure>
  );
}

/* ───────────────────────── 5a ───────────────────────── */


/** How the pick becomes a direction that later nodes can read: the gate's
 *  answer arrives as node_input, persist_direction writes the direction to
 *  session state, and the readers pull it by key. */
function SaveFigure() {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  const mono = { fontFamily: "var(--font-mono)" } as const;
  const keyRow = (y: number, k: string, v: string, color?: string) => (
    <g key={k}>
      <text x={452} y={y} fontSize="9.5" style={mono} fill={color ?? RED}>{k}</text>
      <text x={548} y={y} fontSize="9" style={mono} fill="currentColor" opacity="0.7">{v}</text>
    </g>
  );
  return (
    <figure className="m-0 min-w-[860px]">
      <svg viewBox="0 0 940 246" role="img" aria-label="direction_gate passes the pick to persist_direction as node_input. persist_direction writes direction, angle, hook and user:prefs to session state with Event(state=...), and candidates is bound into its parameter from state by name. adk web shows the keys in its State tab, and downstream nodes read direction and angle. The output, the chosen candidate, goes to policy_check only." className="h-auto w-full text-fg">
        <defs>
          <marker id="sv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
          <marker id="sv-arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={RED} />
          </marker>
        </defs>

        {/* the gate and its answer */}
        <rect x="12" y="126" width="118" height="28" rx="8" {...box} />
        <text x="71" y="144" fontSize="10" style={mono} textAnchor="middle" fill="currentColor">direction_gate</text>
        <text x="71" y="170" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">the form input</text>
        <line x1="130" y1="140" x2="196" y2="140" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#sv-arrow)" />
        <text x="163" y="128" fontSize="9" style={mono} textAnchor="middle" fill="currentColor">{'{"pick": "2"}'}</text>
        <text x="163" y="156" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">node_input</text>

        {/* persist_direction */}
        <rect x="198" y="112" width="150" height="56" rx="10" fill={tint(RED, 0.1)} stroke={RED} strokeWidth="1.3" />
        <text x="273" y="136" fontSize="10.5" style={mono} textAnchor="middle" fill={RED}>persist_direction</text>
        <text x="273" y="153" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">resolves 2 → candidates[1]</text>

        {/* session state */}
        <rect x="440" y="14" width="250" height="140" rx="12" {...box} strokeDasharray="0" />
        <text x="452" y="34" fontSize="10.5" style={mono} fill="currentColor">session state</text>
        <text x="678" y="34" fontSize="8.5" style={mono} textAnchor="end" fill="currentColor" opacity="0.6">one dict per run</text>
        <line x1="440" y1="42" x2="690" y2="42" stroke="var(--hairline)" />
        {keyRow(60, "candidates", "written by the gate", "currentColor")}
        {keyRow(80, "direction", '"Tiny dragon guards…"')}
        {keyRow(100, "angle", "the twist")}
        {keyRow(120, "hook", "the sticker line")}
        {keyRow(140, "user:prefs", "{last_direction}")}

        {/* write */}
        <path d="M348 126 C 390 126, 400 90, 438 90" fill="none" stroke={RED} strokeWidth="1.4" markerEnd="url(#sv-arrow-red)" />
        <text x="392" y="86" fontSize="9" style={mono} textAnchor="middle" fill={RED}>Event(state={'{…}'})</text>
        <text x="392" y="98" fontSize="8" style={mono} textAnchor="middle" fill={RED} opacity="0.8">writes the direction</text>
        {/* bind */}
        <path d="M438 140 C 400 140, 390 156, 350 156" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" strokeDasharray="4 3" markerEnd="url(#sv-arrow)" />
        <text x="394" y="172" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">candidates, bound</text>
        <text x="394" y="183" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">by parameter name</text>

        {/* readers of session state */}
        <line x1="690" y1="70" x2="748" y2="52" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" markerEnd="url(#sv-arrow)" />
        <rect x="750" y="38" width="176" height="28" rx="8" {...box} />
        <text x="838" y="52" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">adk web · State tab</text>
        <text x="838" y="62" fontSize="7.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">shows the merged keys</text>
        <line x1="690" y1="110" x2="748" y2="114" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" markerEnd="url(#sv-arrow)" />
        <rect x="750" y="100" width="176" height="28" rx="8" {...box} />
        <text x="838" y="114" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">remember_pick · memory</text>
        <text x="838" y="124" fontSize="7.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">reads direction, angle</text>

        {/* output */}
        <line x1="273" y1="168" x2="273" y2="208" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#sv-arrow)" />
        <text x="265" y="186" fontSize="9" style={mono} textAnchor="end" fill="currentColor">Event(output=chosen)</text>
        <text x="265" y="198" fontSize="8" style={mono} textAnchor="end" fill="currentColor" opacity="0.6">output goes to the next node only</text>
        <rect x="214" y="210" width="118" height="28" rx="8" {...box} />
        <text x="273" y="228" fontSize="10" style={mono} textAnchor="middle" fill="currentColor">policy_check</text>
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">
        Session state is the merged result of every <code className="font-mono">Event(state=...)</code> in the run. adk web shows it in the State tab, and a function node's parameters are bound from it by name.
      </figcaption>
    </figure>
  );
}

function StateNode() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const { status, checking, check, open, setOpen } = useStage3();
  const persistOk = status?.persist_wired ?? false;
  const writeOk = status?.state_write_wired ?? false;
  const keys = status?.state_keys ?? [];
  const wrote = !!status?.direction;

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 5a · Workflow State"
        color={RED}
        title="Session state persistence."
        blurb="Downstream nodes require the candidate selected at the approval gate. Session state provides cross-node data persistence across the workflow execution lifecycle."
      />

      <In delay={0.05}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The graph so far</p>
          <h2 className="font-display mt-2 text-2xl">Extending the graph with state persistence.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            The workflow extends the research fan-out, join synchronization, direction proposer, and approval gate. This stage appends <code className="font-mono text-fg">persist_direction</code> after the gate, mapping the selected choice into state for downstream nodes to read.
          </p>
          <div className="mt-4">
            <SnakeGraph only={["__START__", "scan_trends", "read_backlog", "join_research", "propose_directions", "direction_gate", "persist_direction"]} highlight="persist_direction" cols={6} label="The graph after this part. START fans out to scan_trends and read_backlog, then join_research, propose_directions, direction_gate, and the new persist_direction." />
          </div>
        </section>
      </In>

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">State persistence architecture</p>
          <h2 className="font-display mt-2 text-2xl">Structured session state binding.</h2>
          <div className="mt-4 overflow-x-auto">
            <SaveFigure />
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <EditPanel
          label="Edit 1 of 2"
          title="Persist chosen direction to session state."
          intro={
            <>
              Open <code className="font-mono text-fg">agent/graph.py</code> and locate <code className="font-mono text-fg">persist_direction</code>.
              When the user picks an idea, this function finds the matching candidate from <code className="font-mono text-fg">candidates</code>.
              Replace the TODO comment with <code className="font-mono text-fg">yield Event(state={"{...}"})</code> to save <code className="font-mono text-fg">direction</code>, <code className="font-mono text-fg">angle</code>, <code className="font-mono text-fg">hook</code>, and <code className="font-mono text-fg">user:prefs</code> to session state.
              <span className="mt-2 block">
                Saving state here makes these values available to subsequent nodes automatically.
              </span>
            </>
          }
          pill={status ? (writeOk ? "state write in place ✓" : "no Event(state=...) yet") : "…"}
          ok={writeOk}
          hint={hintB}
          setHint={setHintB}
          hint1={<>The values are already computed above the line, including <code className="font-mono">chosen["title"]</code>, <code className="font-mono">chosen.get("angle", "")</code>, and <code className="font-mono">hook</code>. For <code className="font-mono">user:prefs</code>, supply a dict with <code className="font-mono">last_direction</code>.</>}
          hint2={`    yield Event(state={"direction": chosen["title"], "angle": chosen.get("angle", ""),
                       "hook": hook, "user:prefs": {"last_direction": chosen["title"]}})`}
          path="agent/graph.py"
          symbol="persist_direction"
          pattern={/TODO: PERSIST_STATE|Event\(state=/}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <EditPanel
          label="Edit 2 of 2"
          title="Append persist_direction to the workflow chain."
          intro={<>In <code className="font-mono text-fg">stage3_router/agent.py</code>, append <code className="font-mono text-fg">persist_direction</code> to the final chain tuple following <code className="font-mono text-fg">direction_gate</code> to consume and persist the gate's output.</>}
          pill={status ? (persistOk ? "persist_direction in the chain ✓" : `chain ends at ${status.chain[status.chain.length - 1] ?? "…"}`) : "…"}
          ok={persistOk}
          hint={hintA}
          setHint={setHintA}
          hint1={<>One more name at the end of the third tuple, after <code className="font-mono">direction_gate</code>.</>}
          hint2={`    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (join_research, propose_directions, direction_gate,
            persist_direction)])`}
          path="stage3_router/agent.py"
          symbol="root_agent"
          pattern={/direction_gate\)\]\)|persist_direction\)\]\)/}
          onSaved={check}
        />
      </In>

      <In delay={0.4}>
        <LoadCheck app="stage3_router" intro="Save both edits, then verify module loading to ensure the workflow graph imports cleanly without syntax or configuration errors." />
      </In>

      <In delay={0.45}>
        <RunPanel
          app="stage3_router"
          open={open}
          setOpen={setOpen}
          title="Execute the workflow and inspect session state."
          intro="The workflow invokes propose_directions, suspends execution at direction_gate, and resumes upon form submission to persist selected attributes into session state."
          idea={idea}
          setIdea={setIdea}
          steps={[
            "Submit '2' in the approval gate form. A state delta event follows the gate, and persist_direction outputs the resolved candidate dictionary before the run terminates.",
            "Inspect the State tab in adk web. The candidates array was persisted by the gate; direction, angle, hook, and user:prefs are merged by persist_direction. The verification panel reads these persisted keys directly.",
          ]}
        />
      </In>

      <In delay={0.5}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from agent/graph.py, this step's app file, and the latest stage3_router session's state.">
          <CheckRow ok={persistOk} label="persist_direction follows the gate in the chain">
            {status ? (persistOk ? status.chain.join(" → ") : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={writeOk} label="persist_direction yields Event(state=...)">
            {status ? (writeOk ? "Found in agent/graph.py." : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={wrote} label="state.direction holds your pick">
            {status?.direction ? `${status.direction}${status.angle ? ` · ${status.angle.slice(0, 60)}` : ""}` : "Not in state yet."}
          </CheckRow>
          <CheckRow ok={!!status?.user_prefs?.last_direction} label="state has user:prefs">
            {status?.user_prefs?.last_direction ? `last_direction · ${status.user_prefs.last_direction}` : "Not in state yet."}
          </CheckRow>
          {keys.length ? (
            <li className="md:col-span-2 rounded-2xl border border-hairline bg-overlay p-3 font-mono text-[11px] text-fg-muted">
              state keys · {keys.join(" · ")}
            </li>
          ) : null}
        </VerifyPanel>
      </In>
    </div>
  );
}

/* ───────────────────────── 5b ───────────────────────── */

const CODE_ROUTER_SAMPLE = `# a sample router
def length_check(node_input):
    too_long = len(node_input.get("title", "")) > 60
    return Event(output=node_input,
                 route="TRIM" if too_long else "PASS")`;

const CODE_SCRIPT_INSTRUCTION = `# agent/graph.py
SCRIPT_INSTRUCTION = (
    "Write the production script for the approved video "
    "direction. The message you received is the direction "
    "as JSON: title, angle, hook."
    "Deliver: title, description, 3-5 tags, an opening_line, "
    "and EXACTLY 3 shots ...")`;

const CODE_SCRIPT_SCHEMA = `# agent/schemas.py
class Script(BaseModel):
    title: str
    description: str
    tags: list[str]
    opening_line: str
    conclusion_first: bool
    shots: list[Shot]`;

const CODE_SCRIPTER = `# stage3_router/agent.py
scripter = Agent(
    name="scripter",
    model=config.MODEL,
    instruction=SCRIPT_INSTRUCTION,
    output_schema=Script)`;

const CODE_QUARANTINE_STUB = `# stage3_router/agent.py
def quarantine(node_input):
    return Event(
        output={"blocked": True,
                "title": node_input.get("title", "")},
        message="blocked: the channel's policy "
                "refused this direction")`;


function RouterNode() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const { status, checking, check, open, setOpen } = useStage3();
  const routeOk = status?.policy_route_wired ?? false;
  const routerOk = (status?.router_wired ?? false) && (status?.routes_wired ?? false);

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 5b · The router node"
        color={RED}
        title="Deterministic conditional routing."
        blurb="Router nodes introduce deterministic control flow without incurring LLM inference costs. By evaluating payloads against explicit policy rules, the router directs execution branches conditionally via dictionary edge mapping."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Where the graph stands</p>
          <h2 className="font-display mt-2 text-2xl">Integrating policy inspection into the chain.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Upstream execution resolves the user's selection into a candidate dictionary (title, angle, hook). The router evaluates this payload next to determine downstream dispatch.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <RouterFigure reroute={false} />
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sample router</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_ROUTER_SAMPLE}</code>
              </pre>
              <div className="border-t border-hairline px-4 py-2 font-mono text-[11.5px] text-fg">
                <span className="text-fg-muted"># the edge that reads a route</span>
                <br />
                (length_check, {"{"}"TRIM": shorten, "PASS": scripter{"}"})
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fg-muted">
            The returned <code className="font-mono text-fg">Event(output=..., route=...)</code> dictates branch dispatch. The payload is forwarded to the node mapped by the selected route key in the edge dictionary. In <code className="font-mono text-fg">agent/graph.py</code>, <code className="font-mono text-fg">policy_check</code> identifies prohibited terms in the title and angle, preparing the route decision.
          </p>
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Branch destinations</p>
          <h2 className="font-display mt-2 text-2xl">Production scripting vs. quarantine remediation.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            The <code className="font-mono text-fg">scripter</code> agent generates production video scripts from approved directions. It receives the candidate JSON payload and generates a structured <code className="font-mono text-fg">Script</code> object matching the target schema (title, description, tags, opening line, and shot definitions).
          </p>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            When policy violations are detected, execution routes to <code className="font-mono text-fg">quarantine</code>. In this stage, quarantine terminates the workflow upon violation; in 5c, it will be upgraded to an autonomous remediation agent.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The scripter · an agent node</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_SCRIPTER}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">quarantine · a placeholder function node</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_QUARANTINE_STUB}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The scripter's instruction · abridged</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_SCRIPT_INSTRUCTION}</code>
              </pre>
            </div>
            <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
              <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The scripter's output schema</div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg">
                <code>{CODE_SCRIPT_SCHEMA}</code>
              </pre>
            </div>
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <EditPanel
          label="Edit 1 of 2"
          title="Implement conditional routing logic."
          intro={<>Replace the TODO line to return an <code className="font-mono text-fg">Event</code> with <code className="font-mono text-fg">output=node_input</code> and <code className="font-mono text-fg">route="BLOCK"</code> when <code className="font-mono text-fg">bad</code> contains violations, or <code className="font-mono text-fg">route="OK"</code> otherwise.</>}
          pill={status ? (routeOk ? "router returns a route ✓" : "no return with a route yet") : "…"}
          ok={routeOk}
          hint={hintA}
          setHint={setHintA}
          hint1={<>Follow the sample above using <code className="font-mono">return Event(output=node_input, route=...)</code> with a conditional expression on <code className="font-mono">bad</code> for the route.</>}
          hint2={`    return Event(output=node_input, route="BLOCK" if bad else "OK")`}
          path="agent/graph.py"
          symbol="policy_check"
          pattern={/TODO: POLICY_ROUTE|return Event/}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <EditPanel
          label="Edit 2 of 2"
          title="Connect router branches to the execution graph."
          intro={<>Append <code className="font-mono text-fg">policy_check</code> after <code className="font-mono text-fg">persist_direction</code>, then add the edge routing <code className="font-mono text-fg">OK</code> to the scripter and <code className="font-mono text-fg">BLOCK</code> to quarantine.</>}
          pill={status ? (routerOk ? "router wired ✓" : status.router_wired ? "policy_check in the chain; add the route dict" : `chain ends at ${status.chain[status.chain.length - 1] ?? "…"}`) : "…"}
          ok={routerOk}
          hint={hintB}
          setHint={setHintB}
          hint1={<>Apply two edits by making <code className="font-mono">policy_check</code> the final element of the third chain, then adding a fourth tuple that starts with <code className="font-mono">policy_check</code> and routes to the branch dictionary.</>}
          hint2={`    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (join_research, propose_directions, direction_gate,
            persist_direction, policy_check),
           (policy_check, {"OK": scripter, "BLOCK": quarantine})])`}
          path="stage3_router/agent.py"
          symbol="root_agent"
          pattern={/persist_direction|policy_check|"OK"/}
          onSaved={check}
        />
      </In>

      <In delay={0.4}>
        <LoadCheck app="stage3_router" intro="Save both edits above, then verify module loading to confirm the updated router edges compile cleanly." />
      </In>

      <In delay={0.45}>
        <RunPanel
          app="stage3_router"
          open={open}
          setOpen={setOpen}
          title="Execute both routing branches."
          intro="Execute two sessions to validate both conditional branches, testing the compliant path to scripter as well as quarantine interception."
          idea={idea}
          setIdea={setIdea}
          stepTitles={["Run 1 · Compliant execution branch (OK)", "Run 2 · Policy violation branch (BLOCK)"]}
          steps={[
            "Submit the idea and select candidate 1, 2, or 3. These candidates adhere to channel policy. The policy_check node emits the OK route, triggering scripter to generate the structured Script payload.",
            "Click NEW SESSION, submit the prompt again, and select candidate 4. Candidate 4 contains policy-violating terminology. The policy_check node detects the infraction, emits the BLOCK route, and halts execution in quarantine without invoking the scripter.",
          ]}
        />
      </In>

      <In delay={0.5}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from agent/graph.py, this step's app file, and its sessions in runs/sessions.db.">
          <CheckRow ok={routeOk} label="policy_check returns an Event with a route">
            {status ? (routeOk ? "Found in agent/graph.py." : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={routerOk} label="policy_check is in the chain with both routes">
            {status ? (routerOk ? `${status.chain.join(" → ")} → OK | BLOCK` : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={!!status && status.ok_runs > 0 && !!status.script_title} label="An OK run reached the scripter">
            {status?.script_title ? `Script title · ${status.script_title}` : `Completed ${status?.ok_runs ?? 0} OK route${status?.ok_runs === 1 ? "" : "s"} so far`}
          </CheckRow>
          <CheckRow ok={!!status && status.block_runs > 0 && status.nodes_ran.includes("quarantine")} label="A BLOCK run reached quarantine">
            {status ? (status.block_runs > 0 ? `Completed ${status.block_runs} BLOCK route${status.block_runs === 1 ? "" : "s"}${status.blocked_message ? ` · "${status.blocked_message}"` : ""}` : "Answer a run with candidate 4.") : "…"}
          </CheckRow>
        </VerifyPanel>
      </In>
    </div>
  );
}

/* ───────────────────────── 5c ───────────────────────── */

const MODES = [
  { mode: "chat", color: CYAN, who: "Root or standalone conversational agents.", what: "A conversation. Each user message is a turn; the model decides when to call tools, when to ask, and when to stop. Required for a root agent; not allowed after another node." },
  { mode: "single_turn", color: AMBER, who: "propose_directions, scripter.", what: "One model call, no conversation. Input from the previous node, one structured object out. The default for an agent used as a node." },
  { mode: "task", color: PURPLE, who: "quarantine, from now on.", what: "The model works with its tools for as many calls as it needs and ends by calling the built-in finish_task tool. What it hands to finish_task, typed by output_schema, is the node's output." },
];

const CODE_TOOLS = `"""Tools for the quarantine node.

The node is a task-mode agent that calls these until find_policy_hits comes
back clean, then calls finish_task with the cleaned direction. Both tools are
plain functions; ADK reads the signature and the docstring to describe them
to the model.
"""
from __future__ import annotations

import re

from . import config
from .graph import policy_words

REPLACEMENTS_FILE = config.ROOT / "agent" / "policy_replacements.txt"


def find_policy_hits(text: str) -> dict:
    """Which refused words appear in \`text\`. Matches whole words and phrases
    from agent/policy_words.txt, case-insensitive.

    Returns {"hits": [...], "clean": bool}. clean is true when hits is empty.
    """
    low = text.lower()
    hits = [w for w in policy_words()
            if re.search(rf"\\b{re.escape(w)}\\b", low)]
    return {"hits": hits, "clean": not hits}


def _replacements() -> dict[str, str]:
    out = {}
    for line in REPLACEMENTS_FILE.read_text().splitlines():
        if "=>" in line and not line.strip().startswith("#"):
            bad, good = line.split("=>", 1)
            out[bad.strip().lower()] = good.strip()
    return out


def suggest_replacement(word: str) -> dict:
    """The channel's approved stand-in for a refused word, read from
    agent/policy_replacements.txt.

    Returns {"word", "replacement", "listed"}. When the word has no entry,
    listed is false and replacement is a hint to pick a synonym yourself.
    """
    table = _replacements()
    key = word.strip().lower()
    if key in table:
        return {"word": word, "replacement": table[key], "listed": True}
    return {"word": word, "listed": False,
            "replacement": "(no entry: pick a gentle synonym, keep the scene)"}`;

const CODE_REPLACEMENTS = `# agent/policy_replacements.txt
# Stand-ins for refused words, one per line: refused => replacement.
# suggest_replacement reads this file when the quarantine node asks.
competitor => friendly rival
scam => mystery
revenge => rematch
humiliate => surprise
fake => homemade
dangerous stunt => careful experiment
hoax => rumor
theft => heist game
fraud => mix-up
cruelty => mischief`;

const CODE_QUARANTINE_INSTRUCTION = `# agent/graph.py
QUARANTINE_INSTRUCTION = (
    "The channel's policy refused the direction you received. "
    "The message is the direction as JSON: title, angle, hook. "
    "Make it publishable without changing the scene."
    "1. Call find_policy_hits with the title, and again with "
    "   the angle, to learn which words are refused."
    "2. For every refused word call suggest_replacement and "
    "   rewrite the text with the suggestion."
    "3. Call find_policy_hits again on the rewritten title and "
    "   angle. Repeat steps 2 and 3 until both come back clean."
    "4. Only then call finish_task with the cleaned title, "
    "   angle and hook.")`;

const CODE_CLEANED = `# agent/schemas.py
class CleanedDirection(BaseModel):
    """What quarantine hands to finish_task: the three fields the
    scripter reads, with every refused word replaced."""
    title: str
    angle: str
    hook: str = ""`;

/** The three agent modes, side by side: who the model talks to, how many
 *  calls it makes, and how the node ends. */
function ModesFigure() {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  const mono = { fontFamily: "var(--font-mono)" } as const;
  const node = (x: number, y: number, w: number, label: string, color?: string) => (
    <g>
      <rect x={x} y={y} width={w} height={24} rx={7} fill={color ? tint(color, 0.1) : box.fill} stroke={color ?? box.stroke} strokeWidth={color ? 1.3 : 1} />
      <text x={x + w / 2} y={y + 16} fontSize="9.5" style={mono} textAnchor="middle" fill={color ?? "currentColor"}>{label}</text>
    </g>
  );
  return (
    <figure className="m-0 min-w-[820px]">
      <svg viewBox="0 0 940 236" role="img" aria-label="Three agent modes. In chat mode, a person and the model exchange messages turn after turn, and the model calls tools when it decides to; the conversation ends when the model stops. In single_turn mode, the previous node's output goes into one model call, and one typed object comes out for the next node. In task mode, the previous node's output goes to the model, which calls its tools as many times as it needs and ends by calling finish_task; what it hands to finish_task is the node's output." className="h-auto w-full text-fg">
        <defs>
          <marker id="md-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <line x1="316" y1="8" x2="316" y2="228" stroke="var(--hairline)" />
        <line x1="626" y1="8" x2="626" y2="228" stroke="var(--hairline)" />

        {/* chat */}
        <text x="14" y="20" fontSize="11" style={mono} fill={CYAN}>chat</text>
        <text x="60" y="20" fontSize="8.5" style={mono} fill="currentColor" opacity="0.6">a conversation · root conversational agent</text>
        {node(14, 100, 56, "you")}
        {node(220, 100, 80, "model", CYAN)}
        <line x1="70" y1="106" x2="218" y2="106" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <text x="144" y="100" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.75">message 1</text>
        <line x1="218" y1="118" x2="72" y2="118" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <text x="144" y="130" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.75">reply</text>
        <line x1="70" y1="148" x2="218" y2="148" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" strokeDasharray="4 3" markerEnd="url(#md-arrow)" />
        <text x="144" y="160" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">message 2, 3, …</text>
        {node(220, 44, 80, "tools")}
        <path d="M250 100 C 250 84, 250 78, 250 70" fill="none" stroke={CYAN} strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <path d="M270 68 C 270 78, 270 84, 270 98" fill="none" stroke={CYAN} strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <text x="306" y="86" fontSize="8" style={mono} fill={CYAN} opacity="0.9" textAnchor="end">when it decides</text>
        <text x="14" y="196" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">each message is a turn; the model chooses</text>
        <text x="14" y="208" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">when to call tools, when to ask, when to stop</text>

        {/* single_turn */}
        <text x="330" y="20" fontSize="11" style={mono} fill={AMBER}>single_turn</text>
        <text x="418" y="20" fontSize="8.5" style={mono} fill="currentColor" opacity="0.6">one call · propose_directions, scripter</text>
        {node(330, 100, 92, "previous node")}
        {node(454, 100, 70, "model", AMBER)}
        {node(556, 100, 62, "next node")}
        <line x1="422" y1="112" x2="452" y2="112" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <line x1="524" y1="112" x2="554" y2="112" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <text x="437" y="96" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.75">output</text>
        <text x="539" y="96" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.75">object</text>
        <rect x="454" y="52" width="70" height="20" rx="10" fill={tint(AMBER, 0.12)} stroke={AMBER} strokeOpacity="0.6" />
        <text x="489" y="66" fontSize="8.5" style={mono} textAnchor="middle" fill={AMBER}>One model call</text>
        <text x="489" y="146" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">no tools, no follow-up</text>
        <text x="489" y="158" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">the answer is typed by output_schema</text>
        <text x="330" y="196" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">the default for an agent used as a node</text>
        <text x="330" y="208" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">input from the node before, one object out</text>

        {/* task */}
        <text x="640" y="20" fontSize="11" style={mono} fill={PURPLE}>task</text>
        <text x="678" y="20" fontSize="8.5" style={mono} fill="currentColor" opacity="0.6">work with tools until done · quarantine</text>
        {node(640, 100, 92, "previous node")}
        {node(764, 100, 70, "model", PURPLE)}
        {node(866, 100, 62, "next node")}
        <line x1="732" y1="112" x2="762" y2="112" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <line x1="834" y1="112" x2="864" y2="112" stroke={PURPLE} strokeWidth="1.2" markerEnd="url(#md-arrow)" />
        <text x="747" y="96" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.75">output</text>
        <text x="849" y="92" fontSize="8" style={mono} textAnchor="middle" fill={PURPLE}>finish_task</text>
        <text x="849" y="136" fontSize="7.5" style={mono} textAnchor="middle" fill={PURPLE} opacity="0.85">(the output)</text>
        <rect x="744" y="150" width="110" height="34" rx="7" {...box} />
        <text x="799" y="164" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor">find_policy_hits</text>
        <text x="799" y="177" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor">suggest_replacement</text>
        <path d="M786 124 C 786 134, 786 140, 786 148" fill="none" stroke={PURPLE} strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <path d="M812 150 C 812 140, 812 134, 812 126" fill="none" stroke={PURPLE} strokeWidth="1.1" markerEnd="url(#md-arrow)" />
        <text x="740" y="140" fontSize="8" style={mono} textAnchor="end" fill={PURPLE} opacity="0.9">as many calls</text>
        <text x="740" y="151" fontSize="8" style={mono} textAnchor="end" fill={PURPLE} opacity="0.9">as it needs</text>
        <text x="640" y="196" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">ends by calling the built-in finish_task tool;</text>
        <text x="640" y="208" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">what it hands over, typed by output_schema, is the output</text>
      </svg>
    </figure>
  );
}

/** The task node, with the three arguments the student adds pointing at what
 *  each one does: tools gives the model its two calls, mode="task" gives the
 *  loop and finish_task, output_schema shapes what finish_task carries. */
function TaskFigure() {
  const box = { fill: "var(--overlay)", stroke: "var(--hairline)" };
  const mono = { fontFamily: "var(--font-mono)" } as const;
  return (
    <figure className="m-0 min-w-[820px]">
      <svg viewBox="0 0 940 232" role="img" aria-label="The refused direction enters quarantine, a task agent. The model calls find_policy_hits and suggest_replacement as many times as it needs (tools), loops until the text is clean (mode task), and ends by calling finish_task with a CleanedDirection of title, angle and hook (output_schema), which goes to the scripter." className="h-auto w-full text-fg">
        <defs>
          <marker id="tk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
          <marker id="tk-arrow-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill={PURPLE} />
          </marker>
        </defs>
        {/* in */}
        <rect x="14" y="96" width="130" height="40" rx="8" {...box} />
        <text x="79" y="113" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">refused direction</text>
        <text x="79" y="127" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">title, angle, hook, style</text>
        <line x1="144" y1="116" x2="228" y2="116" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#tk-arrow)" />
        <text x="186" y="108" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.7">route BLOCK</text>

        {/* the agent */}
        <rect x="230" y="30" width="360" height="172" rx="14" fill={tint(PURPLE, 0.06)} stroke={PURPLE} strokeWidth="1.3" />
        <text x="246" y="50" fontSize="11" style={mono} fill={PURPLE}>quarantine</text>
        <text x="574" y="50" fontSize="8.5" style={mono} textAnchor="end" fill={PURPLE} opacity="0.9">mode="task"</text>
        <rect x="250" y="96" width="90" height="40" rx="8" fill={tint(PURPLE, 0.12)} stroke={PURPLE} />
        <text x="295" y="113" fontSize="9.5" style={mono} textAnchor="middle" fill={PURPLE}>model</text>
        <text x="295" y="127" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">rewrites, checks</text>
        <rect x="400" y="86" width="170" height="60" rx="8" {...box} />
        <text x="485" y="102" fontSize="8.5" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">tools=[…]</text>
        <text x="485" y="118" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">find_policy_hits</text>
        <text x="485" y="134" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">suggest_replacement</text>
        <path d="M340 108 C 360 108, 370 104, 398 104" fill="none" stroke={PURPLE} strokeWidth="1.1" markerEnd="url(#tk-arrow-p)" />
        <path d="M398 128 C 370 128, 360 124, 342 124" fill="none" stroke={PURPLE} strokeWidth="1.1" markerEnd="url(#tk-arrow-p)" />
        <text x="369" y="98" fontSize="7.5" style={mono} textAnchor="middle" fill={PURPLE}>call</text>
        <text x="369" y="140" fontSize="7.5" style={mono} textAnchor="middle" fill={PURPLE}>result</text>
        <text x="410" y="170" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">as many rounds as it needs,</text>
        <text x="410" y="182" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">until title and angle are clean</text>
        <text x="250" y="170" fontSize="8.5" style={mono} fill={PURPLE}>then · finish_task(…)</text>
        <text x="250" y="182" fontSize="8" style={mono} fill="currentColor" opacity="0.6">the built-in tool task mode adds</text>

        {/* out */}
        <line x1="590" y1="116" x2="670" y2="116" stroke={PURPLE} strokeWidth="1.3" markerEnd="url(#tk-arrow-p)" />
        <text x="630" y="108" fontSize="8" style={mono} textAnchor="middle" fill={PURPLE}>finish_task</text>
        <rect x="672" y="86" width="150" height="60" rx="8" fill={tint(PURPLE, 0.08)} stroke={PURPLE} strokeOpacity="0.7" />
        <text x="747" y="102" fontSize="8.5" style={mono} textAnchor="middle" fill={PURPLE} opacity="0.9">output_schema</text>
        <text x="747" y="118" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">CleanedDirection</text>
        <text x="747" y="134" fontSize="8" style={mono} textAnchor="middle" fill="currentColor" opacity="0.6">title, angle, hook</text>
        <line x1="822" y1="116" x2="858" y2="116" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#tk-arrow)" />
        <rect x="860" y="102" width="68" height="28" rx="8" {...box} />
        <text x="894" y="120" fontSize="9.5" style={mono} textAnchor="middle" fill="currentColor">scripter</text>
      </svg>
    </figure>
  );
}

function TaskNode() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [hintA, setHintA] = useState(0);
  const [hintB, setHintB] = useState(0);
  const { status, checking, check, open, setOpen } = useStage3();
  const [skel, setSkel] = useState(0);          // bumps to reload the editor after the skeleton is written
  const [skelBusy, setSkelBusy] = useState(false);
  const [skelError, setSkelError] = useState<string | null>(null);
  const taskOk = status?.quarantine_kind === "task agent";
  const rerouteOk = status?.reroute_wired ?? false;
  const calls = status?.tool_calls ?? {};
  const looped = (calls.find_policy_hits ?? 0) >= 2 && (calls.suggest_replacement ?? 0) >= 1 && (calls.finish_task ?? 0) >= 1;

  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 5c · Agent modes and the task node"
        color={RED}
        title="Autonomous remediation in task mode."
        blurb="Unlike single-turn agents that return immediate structured responses, task-mode agents run autonomous tool-use loops until explicit completion criteria are met. When policy violations occur, quarantine iterates with analysis tools until the payload is sanitized."
      />

      <In delay={0.1}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Agent execution modes</p>
          <h2 className="font-display mt-2 text-2xl">chat, single_turn, and task modes.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            The <code className="font-mono text-fg">mode</code> parameter controls an Agent's execution lifecycle. While root conversational agents require <code className="font-mono text-fg">chat</code> mode, graph nodes typically operate in <code className="font-mono text-fg">single_turn</code> mode. For complex multi-step reasoning, <code className="font-mono text-fg">task</code> mode enables autonomous tool calling until explicit completion is reached.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {MODES.map((m) => (
              <div key={m.mode} className="rounded-2xl border border-hairline bg-overlay p-4">
                <div className="font-mono text-sm font-semibold" style={{ color: m.color }}>
                  {m.mode}
                </div>
                <p className="mt-2 text-xs text-fg-muted">{m.what}</p>
                <p className="mt-2 text-xs">
                  <span className="text-fg-muted">In this lab · </span>
                  {m.who}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 overflow-x-auto">
            <ModesFigure />
          </div>
        </section>
      </In>

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Autonomous remediation</p>
          <h2 className="font-display mt-2 text-2xl">Iterative policy remediation and graph reconnection.</h2>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            In 5b, blocked candidates abruptly terminated the pipeline. Rebuilding quarantine as a task-mode agent enables automatic payload remediation. The agent repeatedly inspects the payload with <code className="font-mono text-fg">find_policy_hits</code> and substitutes approved terms using <code className="font-mono text-fg">suggest_replacement</code> until the text passes validation, then forwards the cleaned candidate to the scripter.
          </p>
          <div className="mt-4 max-w-3xl overflow-hidden rounded-2xl border border-hairline bg-input">
            <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">The replacement list · data, like the policy</div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
              <code>{CODE_REPLACEMENTS}</code>
            </pre>
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <EditPanel
          key={skel}
          label="Edit 1 of 2"
          title="Configure quarantine as a task-mode agent."
          intro={
            <>
              Upgrade <code className="font-mono text-fg">quarantine</code> from a stub function to an autonomous Agent. Click the button below to insert the Agent definition, then provide the three required parameters, including <code className="font-mono text-fg">mode="task"</code>,{" "}
              <code className="font-mono text-fg">tools=[find_policy_hits, suggest_replacement]</code>, and <code className="font-mono text-fg">output_schema=CleanedDirection</code>.
            </>
          }
          extra={
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <TaskFigure />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
                  <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">tools · agent/cleanup_tools.py</div>
                  <pre className="max-h-[420px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
                    <code>{CODE_TOOLS}</code>
                  </pre>
                </div>
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
                    <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">instruction · QUARANTINE_INSTRUCTION, abridged</div>
                    <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
                      <code>{CODE_QUARANTINE_INSTRUCTION}</code>
                    </pre>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-hairline bg-input">
                    <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">output_schema · what finish_task must carry</div>
                    <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
                      <code>{CODE_CLEANED}</code>
                    </pre>
                  </div>
                </div>
              </div>
              <p className="max-w-3xl text-sm text-fg-muted">
                Task mode equips the agent with autonomous tool execution, concluding when the agent invokes <code className="font-mono text-fg">finish_task</code>. ADK automatically injects this completion tool, validating its arguments against <code className="font-mono text-fg">output_schema</code> to emit a strongly typed <code className="font-mono text-fg">CleanedDirection</code>.
              </p>
              <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-fg-muted">
                  {!status
                    ? "…"
                    : status.quarantine_kind === "function"
                      ? "Update quarantine to an Agent first. Click here →"
                      : status.quarantine_kind === "task agent"
                        ? "quarantine is a task agent."
                        : status.quarantine_kind
                          ? "The skeleton is in place. Add the three arguments in the editor below."
                          : "quarantine is missing from stage3_router/agent.py. Open the hints and paste the complete node into the editor."}
                  {skelError && <span className="mt-1 block text-vibe-red">{skelError}</span>}
                </p>
                <button
                  onClick={async () => {
                    setSkelBusy(true);
                    setSkelError(null);
                    try {
                      const r = await api.quarantineSkeleton();
                      if (!r.ok) setSkelError(r.detail ?? "could not write the skeleton");
                      await check();
                      setSkel((k) => k + 1);
                    } catch (e) {
                      setSkelError((e as Error).message);
                    } finally {
                      setSkelBusy(false);
                    }
                  }}
                  disabled={skelBusy || status?.quarantine_kind !== "function"}
                  className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  style={{ background: AMBER }}
                >
                  {skelBusy ? <RefreshCw size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                  Put the Agent skeleton in place
                </button>
              </div>
            </div>
          }
          pill={status ? (taskOk ? "task agent ✓" : status.quarantine_kind ? `quarantine is a ${status.quarantine_kind}` : "quarantine is None") : "…"}
          ok={taskOk}
          hint={hintA}
          setHint={setHintA}
          hint1={<>Three lines in place of the TODO comment. <code className="font-mono">tools</code> is a list of the two functions, not strings.</>}
          hint2={`quarantine = Agent(
    name="quarantine",
    model=config.MODEL,
    instruction=QUARANTINE_INSTRUCTION,
    mode="task",
    tools=[find_policy_hits, suggest_replacement],
    output_schema=CleanedDirection,
)`}
          path="stage3_router/agent.py"
          symbol="quarantine"
          pattern={/TODO: QUARANTINE|mode=|tools=|output_schema=/}
          onSaved={check}
        />
      </In>

      <In delay={0.35}>
        <EditPanel
          label="Edit 2 of 2"
          title="Route sanitized directions to the scripter."
          intro={<>Update the workflow topology in <code className="font-mono text-fg">stage3_router/agent.py</code> by adding an edge tuple from <code className="font-mono text-fg">quarantine</code> to <code className="font-mono text-fg">scripter</code>. The scripter now receives compliant input from either the direct OK route or the remediated quarantine output.</>}
          pill={status ? (rerouteOk ? "quarantine → scripter ✓" : "no edge from quarantine yet") : "…"}
          ok={rerouteOk}
          hint={hintB}
          setHint={setHintB}
          hint1={<>Add a fifth tuple after the route dict, specified as <code className="font-mono">(quarantine, scripter)</code>.</>}
          hint2={`    edges=[(START, scan_trends, join_research),
           (START, read_backlog, join_research),
           (join_research, propose_directions, direction_gate,
            persist_direction, policy_check),
           (policy_check, {"OK": scripter, "BLOCK": quarantine}),
           (quarantine, scripter)])`}
          path="stage3_router/agent.py"
          symbol="root_agent"
          pattern={/"BLOCK"|\(quarantine, scripter\)/}
          onSaved={check}
        />
      </In>

      <In delay={0.4}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">The graph now</p>
          <RouterFigure reroute />
        </section>
      </In>

      <In delay={0.45}>
        <LoadCheck app="stage3_router" intro="Save both edits, then verify module loading to confirm the updated workflow graph topology is valid." />
      </In>

      <In delay={0.5}>
        <RunPanel
          app="stage3_router"
          open={open}
          setOpen={setOpen}
          title="Validate autonomous remediation on policy violation."
          intro="Trigger the policy-violating branch to observe quarantine autonomously iterating with its tools to clean the direction before forwarding it to the scripter."
          idea={idea}
          setIdea={setIdea}
          stepTitles={["Select candidate 4 to trigger quarantine", "Observe autonomous tool remediation"]}
          steps={[
            "Select candidate 4 in the approval form. Candidate 4 contains terms that trigger the policy gate. The policy_check node routes execution to quarantine.",
            "Inspect the quarantine event stream as the agent calls find_policy_hits, invokes suggest_replacement to rewrite prohibited terms, re-validates the text, and finally calls finish_task with the sanitized CleanedDirection. Execution then advances to scripter to generate the script for the sanitized direction.",
          ]}
        />
      </In>

      <In delay={0.6}>
        <VerifyPanel checking={checking} onCheck={check} intro="Read from this step's app file and its sessions in runs/sessions.db.">
          <CheckRow ok={taskOk} label="quarantine is a task-mode Agent">
            {status ? (status.quarantine_kind ? `a ${status.quarantine_kind}` : "Edit 1 above.") : "…"}
          </CheckRow>
          <CheckRow ok={rerouteOk} label="quarantine continues to the scripter">
            {status ? (rerouteOk ? "(quarantine, scripter) is in the edge list." : "Edit 2 above.") : "…"}
          </CheckRow>
          <CheckRow ok={looped} label="It worked with its tools and finished the task">
            {Object.keys(calls).length ? Object.entries(calls).map(([k, v]) => `${k} ×${v}`).join("  ·  ") : "No quarantine tool calls yet."}
          </CheckRow>
          <CheckRow ok={!!status?.cleaned} label="finish_task carried a cleaned direction">
            {status?.cleaned ? status.cleaned.title : "Not yet."}
          </CheckRow>
          <CheckRow ok={!!status?.cleaned_script_title} label="The scripter wrote the script for it">
            {status?.cleaned_script_title ? `script title · ${status.cleaned_script_title}` : "Not yet."}
          </CheckRow>
        </VerifyPanel>
      </In>
    </div>
  );
}
