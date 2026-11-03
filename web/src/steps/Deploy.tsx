import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, RefreshCw, Rocket } from "lucide-react";
import { In, StepHeader } from "../components/shared";
import { api, useRunEvents } from "../lib/api";
import type { DeployStatus } from "../lib/types";
import { COLORS, tint } from "./colors";

/*
 * Step 9: the Runner, the app on top of the workflow, Cloud Run. One part:
 * read how the app drives the graph, run it locally, deploy it with a button.
 */

const GREEN = COLORS.green;
const CYAN = COLORS.cyan;
const AMBER = COLORS.amber;
const PURPLE = COLORS.purple;
const RED = COLORS.red;
const mono = { fontFamily: "var(--font-mono)" } as const;


const CODE_GCLOUD = `gcloud run deploy vibestudio --source vibestudio \\
  --project $GOOGLE_CLOUD_PROJECT --region us-central1 \\
  --labels dev-tutorial-codelab=vibetube --allow-unauthenticated \\
  --memory 2Gi --cpu 2 --timeout 3600 --concurrency 40 \\
  --max-instances 1 --min-instances 1 --session-affinity \\
  --set-env-vars GOOGLE_CLOUD_PROJECT=…,STUDIO_VERTEX=1,STUDIO_MEMORY_BANK=…,STUDIO_RAG_CORPUS=…,VIBETUBE_URL=…,VIBETUBE_EVENT=…,VIBETUBE_NAME=…,VIBETUBE_PROJECT=…`;

const CODE_RUNNER = `# vibestudio/server/runner.py
self._svc = DatabaseSessionService(db_url=config.DB_URL)
self._runner = Runner(app_name=config.APP, agent=wf, session_service=self._svc)

async for ev in self._runner.run_async(user_id=config.USER, session_id=run_id, new_message=message):
    self._absorb(ev)    # fold the ADK event into the run state, publish one app event

# the gate's answer and the render's delivery are the same call, with a function_response part
part = Part(function_response=FunctionResponse(id=call_id, name=name, response=response))`;


function ArchFigure() {
  const box = (x: number, y: number, w: number, h: number, label: string, sub: string, color: string, dashed = false) => (
    <g key={label}>
      <rect x={x} y={y} width={w} height={h} rx={12} fill={tint(color, 0.06)} stroke={color} strokeOpacity="0.75" strokeDasharray={dashed ? "6 4" : undefined} />
      <text x={x + 14} y={y + 20} fontSize="11" style={mono} fill={color}>{label}</text>
      <text x={x + 14} y={y + 35} fontSize="8.5" style={mono} fill="currentColor" opacity="0.65">{sub}</text>
    </g>
  );
  return (
    <figure className="m-0 mt-4">
      <svg viewBox="0 0 940 320" className="h-auto w-full text-fg" role="img" aria-label="Google Cloud architectural boundary. Cloud Run hosts the unified service, containing vibestudio/web (React frontend) and vibestudio/server (FastAPI application with ADK Runner over the production workflow). The frontend and backend communicate via REST endpoints and a Server-Sent Events (SSE) telemetry stream. Asynchronous runner execution invokes GEAP platform services including Gemini, Memory Bank, RAG Engine, and Veo.">
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {/* the viewer, outside */}
        <rect x="14" y="120" width="110" height="60" rx="10" fill="var(--overlay)" stroke="var(--hairline)" />
        <text x="69" y="145" textAnchor="middle" fontSize="10" style={mono} fill="currentColor">client browser</text>
        <text x="69" y="161" textAnchor="middle" fontSize="8" style={mono} fill="currentColor" opacity="0.6">https endpoint</text>
        <line x1="124" y1="150" x2="176" y2="150" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
        <text x="150" y="142" textAnchor="middle" fontSize="7.5" style={mono} fill="currentColor" opacity="0.7">https</text>

        {/* Google Cloud: the ground */}
        {box(160, 14, 766, 292, "Google Cloud", "your project", GREEN)}

        {/* Cloud Run: the whole app in one service */}
        {box(178, 58, 480, 226, "Cloud Run", "one container, one URL · vibestudio/", GREEN, true)}
        {box(194, 106, 176, 160, "vibestudio/web", "the React page", CYAN)}
        <text x="208" y="162" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">idea · backlog · graph</text>
        <text x="208" y="177" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">events · stage · pick</text>
        <text x="208" y="192" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">player · thumbnail · publish</text>
        <text x="208" y="207" fontSize="8.5" style={mono} fill="currentColor" opacity="0.7">profile · avatar · history</text>
        <line x1="370" y1="160" x2="452" y2="160" stroke={CYAN} strokeWidth="1.3" markerEnd="url(#arch-arrow)" />
        <text x="411" y="152" textAnchor="middle" fontSize="8" style={mono} fill={CYAN}>SSE /api/events</text>
        <line x1="452" y1="200" x2="370" y2="200" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" markerEnd="url(#arch-arrow)" />
        <text x="411" y="216" textAnchor="middle" fontSize="8" style={mono} fill="currentColor" opacity="0.7">REST /api/*</text>
        {box(454, 106, 190, 160, "vibestudio/server", "FastAPI · one process", AMBER)}
        <rect x="466" y="150" width="166" height="24" rx="7" fill={tint(AMBER, 0.14)} stroke={AMBER} />
        <text x="549" y="166" textAnchor="middle" fontSize="8.5" style={mono} fill={AMBER}>Runner(agent=wf)</text>
        <text x="468" y="194" fontSize="8" style={mono} fill="currentColor" opacity="0.7">platform · bus · files · publish</text>
        <text x="468" y="208" fontSize="8" style={mono} fill="currentColor" opacity="0.7">avatar · telemetry · graphinfo</text>
        <text x="468" y="222" fontSize="8" style={mono} fill="currentColor" opacity="0.7">agent/ · the finished graph</text>
        <text x="468" y="236" fontSize="8" style={mono} fill="currentColor" opacity="0.7">the render poller answers the call</text>

        {/* GEAP */}
        <line x1="644" y1="162" x2="716" y2="162" stroke={PURPLE} strokeWidth="1.3" markerEnd="url(#arch-arrow)" />
        <text x="680" y="154" textAnchor="middle" fontSize="8" style={mono} fill={PURPLE}>run_async</text>
        {box(718, 106, 190, 160, "GEAP", "the services the graph calls", PURPLE)}
        <text x="732" y="162" fontSize="9" style={mono} fill="currentColor" opacity="0.85">Gemini · the agent nodes</text>
        <text x="732" y="180" fontSize="9" style={mono} fill="currentColor" opacity="0.85">Memory Bank · the callbacks</text>
        <text x="732" y="198" fontSize="9" style={mono} fill="currentColor" opacity="0.85">RAG Engine · read_feedback</text>
        <text x="732" y="216" fontSize="9" style={mono} fill="currentColor" opacity="0.85">Veo · render_desk</text>
        <text x="732" y="240" fontSize="8" style={mono} fill="currentColor" opacity="0.6">Cloud Trace · the spans</text>

        {/* the deploy */}
        <text x="418" y="298" textAnchor="middle" fontSize="8.5" style={mono} fill={GREEN}>gcloud run deploy --source vibestudio · the folder becomes the container</text>
      </svg>
      <figcaption className="mt-2 text-xs text-fg-muted">
        The web frontend never interfaces with ADK directly or accesses disk storage. The FastAPI server hosts the ADK Runner, render poller, asset publishing pipeline, and session state. Outbound model inference, semantic memory, vector retrieval, and video generation dispatch to GEAP platform services in the same project.
      </figcaption>
    </figure>
  );
}

/** The deploy, run from here - or already run by setup: setup_codelab.sh
 *  starts vibestudio/deploy.py in the background, so this page usually opens
 *  on a service that is live, or on a build that is a few minutes in. The
 *  gcloud command (wrapped by deploy.py, which fills in the env values) runs
 *  as a worker on the lab server when the button is pressed; the output of
 *  setup's deploy is read from its log. */
function DeployRunner() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<DeployStatus | null>(null);
  useRunEvents((verb, line) => {
    if (verb === "deploy") setLines((l) => [...l.slice(-299), line]);
  });
  const refresh = useCallback(() => api.deployStatus(true).then(setStatus).catch(() => {}), []);
  useEffect(() => {
    api.deployStatus(true).then((st) => {
      setStatus(st);
      if (st.running) {
        setRunning(true);
        setLines(st.by === "setup" && !st.worker
          ? ["setup started this deploy in the background; the tail of runs/deploy_setup.log appears here", ...st.log_tail]
          : ["a deploy is already running on this server; its remaining output appears here"]);
      }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const st = await api.deployStatus(!running);
      setStatus(st);
      if (st.by === "setup" && !st.worker && st.log_tail.length) setLines((l) => (l.length && l[0].startsWith("setup started") ? [l[0], ...st.log_tail] : l));
      if (!st.running) {
        setRunning(false);
        refresh();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [running, refresh]);
  const run = async () => {
    setLines([]);
    let r: { ok: boolean; detail: string };
    try {
      r = await api.deployRun();
    } catch (e) {
      // a failed request used to reject inside the click handler, so the page
      // showed nothing at all and the button looked dead
      setLines([`could not reach the learning center: ${(e as Error).message}`,
                "Is it still running? Its log is runs/lab.log; scripts/start.sh starts it again."]);
      return;
    }
    if (!r.ok) {
      setLines([`could not start: ${r.detail}`]);
      return;
    }
    setRunning(true);
  };
  const url = status?.url || "";
  const exit = status?.last_exit?.code ?? null;
  const bySetup = status?.by === "setup";
  const since = status?.started_at ? Math.max(0, Math.round((Date.now() / 1000 - status.started_at) / 60)) : null;
  const deployedAgo = status?.at ? Math.max(0, Math.round((Date.now() / 1000 - status.at) / 60)) : null;
  return (
    <section className="rounded-3xl border p-6" style={{ borderColor: tint(GREEN, 0.33), background: tint(GREEN, 0.04) }}>
      {status && (status.running || url || status.status === "failed" || status.status === "interrupted") ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 font-mono text-xs" style={{ borderColor: tint(status.running ? AMBER : url && status.reachable !== false ? GREEN : RED, 0.4), background: tint(status.running ? AMBER : url && status.reachable !== false ? GREEN : RED, 0.06) }}>
          <span className={`h-2 w-2 rounded-full ${status.running ? "animate-pulse" : ""}`} style={{ background: status.running ? AMBER : url && status.reachable !== false ? GREEN : RED }} />
          {status.running ? (
            <span>
              {bySetup && !status.worker ? "Setup is deploying VibeStudio in the background" : "Deploying"}
              {since !== null ? ` · ${since} min so far` : ""} · Cloud Build takes four or five minutes; nothing to do here but read
            </span>
          ) : url ? (
            <span>
              Already live{bySetup ? ", deployed by setup" : ""}{deployedAgo !== null ? ` ${deployedAgo} min ago` : ""}{status.seconds ? ` in ${status.seconds}s` : ""}
              {status.reachable === false ? " · not answering right now" : status.reachable ? " · answers /api/health" : ""}
            </span>
          ) : (
            <span>The deploy {status.status === "interrupted" ? "was interrupted" : "failed"}{status.detail ? ` · ${status.detail}` : ""} · the log below says why; press the button to try again</span>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: GREEN }}>
            Deployment
          </p>
          <h2 className="font-display mt-2 text-2xl">{url && !status?.running ? "On Cloud Run since setup." : "Deploying to Cloud Run."}</h2>
          <p className="mt-2 max-w-2xl text-sm text-fg-muted">
            <code className="font-mono text-fg">setup_codelab.sh</code> started this deploy in the background, the way it starts the corpus and the bank, so the app is usually live before this page is reached - and the Post my video button in the top bar has been sending it the night since step 3. There is nothing to deploy again now: the app carries its own complete copy of the agent, so your edits in the workbench do not change it. <b>Deploy again</b> is for a new revision - after you change the room or your name in <code className="font-mono text-fg">.env</code>, or if the service stops answering - and runs the same <code className="font-mono text-fg">vibestudio/deploy.py</code>: Cloud Build parses the multi-stage Dockerfile, compiles the frontend bundle and FastAPI server into a unified container image, and Cloud Run serves a new revision at the same URL (two to five minutes; the night the app holds in memory starts over). One deploy at a time.
            {status?.gcloud_project ? (
              <>
                {" "}
                Project <code className="font-mono text-fg">{status.gcloud_project}</code>.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 md:items-end">
          {url && !running ? (
            <>
              <a href={url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03]" style={{ background: GREEN }}>
                Open Vibe Studio <ExternalLink size={15} />
              </a>
              <button onClick={run} title="A new revision of the same service: after you change the room or your name in .env, or when the app stops answering. Not needed otherwise - the app carries its own complete agent." className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2 font-mono text-xs transition-colors hover:bg-overlay" style={{ borderColor: tint(GREEN, 0.45), color: GREEN }}>
                <Rocket size={13} /> Deploy again
              </button>
              <span className="max-w-[260px] text-right font-mono text-[10px] leading-snug text-fg-muted">
                nothing to deploy now · again only after a change to <code className="text-fg">.env</code>, or if the app stops answering
              </span>
            </>
          ) : (
            <button onClick={run} disabled={running} className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-[1.03] disabled:opacity-50" style={{ background: GREEN }}>
              {running ? <RefreshCw size={16} className="animate-spin" /> : <Rocket size={16} />}
              {running ? (bySetup && !status?.worker ? "Setup is deploying…" : "Deploying…") : "Deploy to Cloud Run"}
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Deployment command</p>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-hairline bg-input px-3 py-2 font-mono text-[11px] leading-relaxed text-fg">{CODE_GCLOUD}</pre>
          <p className="mt-2 text-xs text-fg-muted">
            Allocates a warm instance with session affinity enabled to maintain workflow session continuity within the hosting process. Target environment variables ingest configuration from{" "}
            <code className="font-mono text-fg">.env</code> alongside provisioned resource identifiers in <code className="font-mono text-fg">runs/memorybank.json</code> and{" "}
            <code className="font-mono text-fg">runs/ragcorpus.json</code>.
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Pre-deployment checklist</p>
          <ul className="mt-1 space-y-1 text-xs text-fg-muted">
            <li>{status?.app_built ? "✓" : "·"} Frontend bundle built ({status?.app_built ? "vibestudio/web/dist verified" : "run vibestudio/run.sh once or build via Dockerfile"})</li>
            <li>· Active gcloud credentials with Cloud Run, Cloud Build, and Artifact Registry APIs enabled</li>
            <li>· Cloud Run runtime service account granted GEAP permissions (roles/aiplatform.user)</li>
          </ul>
        </div>
      </div>
      {(lines.length > 0 || running) && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-input">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span>gcloud run deploy · output{bySetup && !status?.worker ? " · runs/deploy_setup.log" : ""}</span>
            <span>{running ? "running…" : exit === 0 ? "done" : exit === null ? "" : `exit ${exit}`}</span>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">{lines.filter((l) => !/Warning|warn\(/.test(l)).join("\n") || "starting…"}</pre>
        </div>
      )}
      {url && !running && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between" style={{ borderColor: tint(GREEN, 0.4), background: tint(GREEN, 0.06) }}>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: GREEN }}>
              Active Service Endpoint
            </p>
            <p className="mt-1 font-mono text-sm text-fg">{url}</p>
            <p className="mt-1 text-xs text-fg-muted">
              Access the live service endpoint to initiate end-to-end runs. Submit prompt concepts, resolve policy approval gates, monitor asynchronous video generation, and publish completed assets. The application executes the complete ADK workflow on serverless infrastructure.
            </p>
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: GREEN }}>
            Open Vibe Studio <ExternalLink size={14} />
          </a>
        </motion.div>
      )}
      {exit !== null && exit !== 0 && !running && <p className="mt-3 font-mono text-xs" style={{ color: RED }}>the deploy exited with {exit}; the output above says why</p>}
    </section>
  );
}

export function Deploy() {
  return (
    <div className="space-y-12">
      <StepHeader
        kicker="Step 9 · Deploy"
        color={GREEN}
        title="Production deployment architecture."
        blurb="The production application on Cloud Run. The service wraps the workflow in an ADK Runner, exposing Server-Sent Events (SSE) to stream live execution progress directly to the web client. Setup put it on Cloud Run while you read, and the Post my video button has been publishing through it since step 3; open it, run a night in it, and read how it drives the graph. The deploy is one command, kept here for a new revision."
      />

      <In delay={0.2}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Architecture & Topology</p>
          <h2 className="font-display mt-2 text-2xl">System topology across Cloud Run and GEAP platform services.</h2>
          <ArchFigure />
          <div className="mt-4 max-w-3xl overflow-hidden rounded-2xl border border-hairline bg-input">
            <div className="border-b border-hairline px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">vibestudio/server/runner.py · the Runner</div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
              <code>{CODE_RUNNER}</code>
            </pre>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fg-muted">
            The ADK Runner executes workflow graphs asynchronously on a dedicated worker thread with an isolated event loop, ensuring long-running node execution does not block HTTP request processing. Each ADK event stream item folds into the aggregate run state and broadcasts downstream via SSE, streaming node transitions, gate suspensions with option candidates, render receipts, polling status checks, video deliveries, and publication events. The frontend renders workflow topologies dynamically via <code className="font-mono text-fg">GET /api/graph</code>, reflecting the current state of <code className="font-mono text-fg">wf.graph</code>.
          </p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-hairline bg-input px-4 py-3 font-mono text-[11px] leading-relaxed text-fg">
            <pre className="m-0">{`vibestudio/
  server/
    main.py                 FastAPI — the page, /api, /static
    api.py                  the REST surface — run, pick, publish, backlog, profile, history
    runner.py               the Runner over the finished workflow, the render poller
    platform/               bus (the SSE stream), files, publish, avatar, telemetry, graphinfo
    agent/                  the finished agent, byte-equal to the lab's agent/ (checks/verify_app.py)
      graph.py              the workflow — direction_gate (4d), persist_direction (5a), policy_check (5b),
                            quarantine and the edge list (5c), read_feedback (7b), store_video (8b)
      desk.py               render_desk and render_submit, the LongRunningFunctionTool (8a)
      schemas.py            Directions, CleanedDirection, Script (4c, 5b, 5c)
      cleanup_tools.py      find_policy_hits, suggest_replacement (5c)
      trends.py · backlog.txt · comments.md · policy_words.txt · policy_replacements.txt
      platform/
        memory.py           recall_taste, remember_pick, Memory Bank (6)
        rag.py              retrieve, RAG Engine (7)
        videogen.py         start, check, Veo (8)
        state.py · config.py
  web/                      the React page
  Dockerfile · deploy.py · run.sh

The developmental stage applications (stage0_prompt through stage6_video) incrementally verified discrete subgraphs.
The production deployment executes wf from agent/graph.py as a unified graph. The external delivery
script is superseded because runner.py polls Veo asynchronously in-process and dispatches the resumption call automatically.`}</pre>
          </div>
        </section>
      </In>

      <In delay={0.3}>
        <section className="rounded-3xl border border-hairline bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Runtime environment</p>
          <p className="mt-2 max-w-3xl text-sm text-fg-muted">
            Cloud Run provides fully managed serverless container execution for web applications and agent workflows. Compute resources scale dynamically with traffic while maintaining per-request billing granularity. The deployment configuration mandates min-instances=1 and session affinity to preserve ephemeral in-memory state across multi-turn asynchronous workflow suspensions. In distributed enterprise topologies, session persistence delegates to an external state store such as GEAP Agent Runtime or Cloud Spanner.
          </p>
        </section>
      </In>

      <In delay={0.4}>
        <DeployRunner />
      </In>

    </div>
  );
}
