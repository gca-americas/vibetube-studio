import { t } from "../i18n";
import { motion } from "framer-motion";
import { BookOpen, Clapperboard, ListChecks, Sparkles, Timer, Workflow } from "lucide-react";
import { In, StepHeader } from "../components/shared";
import { COLORS, tint } from "./colors";

const CYAN = COLORS.cyan;
const AMBER = COLORS.amber;
const PURPLE = COLORS.purple;
const GREEN = COLORS.green;
const RED = COLORS.red;
const BLUE = COLORS.blue;
const mono = { fontFamily: "var(--font-mono)" } as const;

const person = (cx: number, cy: number, color = BLUE, r = 7) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={tint(color, 0.15)} stroke={color} strokeWidth="1.4" />
    <path d={`M${cx - r * 1.9} ${cy + r * 3.4} a${r * 1.9} ${r * 1.9} 0 0 1 ${r * 3.8} 0`} fill={tint(color, 0.15)} stroke={color} strokeWidth="1.4" />
  </g>
);
const box = (x: number, y: number, w: number, label: string, color?: string, dashed = false, h = 22) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={7} fill={color ? tint(color, 0.1) : "var(--overlay)"} stroke={color ?? "var(--hairline)"} strokeWidth={color ? 1.3 : 1} strokeDasharray={dashed ? "4 3" : undefined} />
    <text x={x + w / 2} y={y + h / 2 + 3.5} fontSize="8.5" style={mono} textAnchor="middle" fill={color ?? "currentColor"}>{label}</text>
  </g>
);
const note = (x: number, y: number, text: string, color?: string, anchor: "start" | "middle" | "end" = "middle", size = 7.5) => (
  <text x={x} y={y} fontSize={size} style={mono} textAnchor={anchor} fill={color ?? "currentColor"} opacity={color ? 1 : 0.7}>{text}</text>
);
const marker = (id: string, color = "currentColor") => (
  <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill={color} />
  </marker>
);

/** The week as a loop: six chores around one person, again every week. The
 *  chores a model can do alone carry the model's name. */
function WeekLoopFigure() {
  const cx = 180, cy = 140, R = 96;
  const stations = [
    { label: t("research the trend"), who: "Gemini" },
    { label: t("comb the backlog"), who: "Gemini" },
    { label: t("choose a direction"), who: "" },
    { label: t("check the policy"), who: "" },
    { label: t("write the script"), who: "Gemini" },
    { label: t("render the clip"), who: "Veo" },
  ];
  const pt = (i: number, r = R) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  return (
    <figure className="m-0">
      <svg viewBox="0 0 360 290" role="img" aria-label={t("Six chores arranged in a ring around one person: research the trend, comb the backlog, choose a direction, check the policy, write the script, render the clip. The ring repeats every week. Gemini can do the research, the backlog and the script alone; Veo can render alone; choosing and checking are the person's.")} className="h-auto w-full text-fg">
        <defs>{marker("wk-arrow")}</defs>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--hairline)" strokeDasharray="4 4" />
        {stations.map((_, i) => {
          const a = pt(i + 0.5, R); const b = pt(i + 0.62, R);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" markerEnd="url(#wk-arrow)" />;
        })}
        {stations.map((st, i) => {
          const { x, y } = pt(i);
          const w = 104;
          return (
            <g key={st.label}>
              {box(x - w / 2, y - 11, w, st.label, st.who ? undefined : AMBER)}
              {st.who && (() => {
                const left = x < cx;                       // outer side: away from the person in the middle
                const bx = left ? x - w / 2 - 6 : x + w / 2 - 34;
                const c = st.who === "Veo" ? PURPLE : CYAN;
                return (
                  <g>
                    <rect x={bx} y={y - 24} width={40} height={13} rx={6.5} fill={tint(c, 0.15)} stroke={c} strokeWidth="1" />
                    <text x={bx + 20} y={y - 14.5} fontSize="7.5" style={mono} textAnchor="middle" fill={c}>{st.who}</text>
                  </g>
                );
              })()}
            </g>
          );
        })}
        {person(cx, cy - 14)}
        {note(cx, cy + 30, "you", BLUE)}
        {note(cx, 278, "every week, again · the amber ones need your judgment, the rest a model can do alone")}
      </svg>
    </figure>
  );
}

/** The same work as a pipeline that runs itself and comes to the person only
 *  where the person is needed. Each callout is one line of the list beside it. */
function PipelineFigure() {
  return (
    <figure className="m-0">
      <svg viewBox="0 0 440 170" role="img" aria-label={t("A pipeline: research, then choose, where the person is asked; then the policy check, which refuses a bad direction before the render; then the script, the render, where the run waits with nothing kept alive; and a record at the end. Memory and the audience's comments feed the research.")} className="h-auto w-full text-fg">
        <defs>{marker("pl-arrow")}{marker("pl-arrow-c", CYAN)}</defs>
        {box(8, 70, 66, "research")}
        {box(84, 70, 60, "choose", AMBER)}
        {box(154, 70, 60, "policy", RED)}
        {box(224, 70, 56, "script")}
        {box(290, 70, 58, "render", AMBER, true)}
        {box(358, 70, 74, "the record", GREEN)}
        {[74, 144, 214, 280, 348].map((x) => <line key={x} x1={x} y1={81} x2={x + 9} y2={81} stroke="currentColor" strokeWidth="1.1" markerEnd="url(#pl-arrow)" />)}
        <path d="M8 62 L 8 54 L 280 54 L 280 62" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
        {note(200, 48, "runs on its own, in this order", undefined, "start")}
        {person(114, 20, BLUE, 5)}
        <line x1="114" y1="42" x2="114" y2="68" stroke={BLUE} strokeWidth="1.1" markerEnd="url(#pl-arrow)" />
        {note(114, 108, "asks you here,", BLUE)}
        {note(114, 118, "and only here")}
        <line x1="184" y1="92" x2="184" y2="126" stroke={RED} strokeOpacity="0.4" strokeWidth="1" />
        {note(184, 138, "refuses a bad one", RED)}
        {note(184, 148, "before it costs money")}
        {note(319, 108, "waits for minutes", AMBER)}
        {note(319, 118, "with nothing kept alive")}
        <line x1="395" y1="92" x2="395" y2="126" stroke={GREEN} strokeOpacity="0.4" strokeWidth="1" />
        {note(395, 138, "what was cited,", GREEN)}
        {note(395, 148, "refused, shipped")}
        <path d="M30 136 C 30 118, 36 100, 38 94" fill="none" stroke={CYAN} strokeWidth="1.1" markerEnd="url(#pl-arrow-c)" />
        <path d="M52 136 C 52 118, 46 100, 44 94" fill="none" stroke={CYAN} strokeWidth="1.1" markerEnd="url(#pl-arrow-c)" />
        {note(8, 150, "what you picked before,", CYAN, "start")}
        {note(8, 160, "what the audience said", CYAN, "start")}
      </svg>
    </figure>
  );
}

/** The arc of the lab: the workflow is built in the workbench, wrapped in
 *  an app, deployed, and its video lands on VibeTube. */
function ArcFigure() {
  return (
    <figure className="m-0">
      <svg viewBox="0 0 700 96" role="img" aria-label={t("Steps 2 to 8: you build the Workflow in the workbench. Step 9: the graph inside VibeStudio, an app, deployed to Cloud Run. The video it makes is published on vibetube.dev.")} className="h-auto w-full text-fg">
        <defs>{marker("arc-arrow")}</defs>
        <rect x="8" y="14" width="196" height="54" rx="12" fill="var(--overlay)" stroke="var(--hairline)" />
        {note(106, 34, "steps 2 to 8", undefined, "middle", 8)}
        {note(106, 50, "you build the Workflow", CYAN, "middle", 9)}
        <line x1="204" y1="41" x2="236" y2="41" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#arc-arrow)" />
        <rect x="238" y="14" width="226" height="54" rx="12" fill={tint(PURPLE, 0.06)} stroke={PURPLE} strokeWidth="1.2" />
        {note(351, 34, "step 9", undefined, "middle", 8)}
        {note(351, 50, "VibeStudio: the graph inside an app", PURPLE, "middle", 9)}
        {note(351, 62, "deployed to Cloud Run", undefined, "middle", 7.5)}
        <line x1="464" y1="41" x2="496" y2="41" stroke="currentColor" strokeWidth="1.1" markerEnd="url(#arc-arrow)" />
        <rect x="498" y="14" width="194" height="54" rx="12" fill={tint(GREEN, 0.06)} stroke={GREEN} strokeWidth="1.2" />
        {note(595, 34, "vibetube.dev", undefined, "middle", 8)}
        {note(595, 50, "your video, published", GREEN, "middle", 9)}
        {note(350, 88, "one graph, from an idea to a clip on the platform")}
      </svg>
    </figure>
  );
}

const CHORES = [
  t("research what is trending"),
  t("comb through the backlog of ideas"),
  t("choose a direction"),
  t("check it against the channel's policy"),
  t("write the script"),
  t("render the clip"),
];

const WANTS = [
  { icon: Workflow, text: t("Runs the routine steps on its own, in a fixed order.") },
  { icon: ListChecks, text: t("Asks you only for the decisions that need your judgment.") },
  { icon: Sparkles, text: t("Refuses a bad direction before it costs money.") },
  { icon: Clapperboard, text: t("Remembers what you picked last time, and reads what the audience said.") },
  { icon: Timer, text: t("Waits minutes for a render without a process kept alive for it.") },
  { icon: BookOpen, text: t("Leaves a record of every run: what was cited, what was refused, what shipped.") },
];

export function Story() {
  return (
    <div className="space-y-12">
      <StepHeader
        kicker={t("Step 1 · The story")}
        color={COLORS.cyan}
        title={t("You run a digital channel on VibeTube.")}
        blurb={t("You have an active audience and an expanding backlog of creative ideas, but producing each video requires continuous multi-stage execution.")}
      />

      {/* The work, as a wall of chores */}
      <In delay={0.15}>
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[1.1fr_1fr]">
          <div className="rounded-3xl border border-hairline bg-card p-6 shadow-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">{t("Every video, every week")}</p>
            <ul className="mt-4 grid grid-cols-2 gap-2">
              {CHORES.map((c, i) => (
                <motion.li
                  key={c}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className="flex items-center gap-2 rounded-xl border border-hairline bg-overlay px-3 py-2 text-sm"
                >
                  <span className="font-mono text-[10px] text-fg-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span>{c}</span>
                </motion.li>
              ))}
            </ul>
            <div className="mt-4">
              <WeekLoopFigure />
            </div>
            <p className="mt-2 text-sm text-fg-muted">
              {t("Generative models can execute each of these tasks individually: Gemini researches and writes scripts, while Veo renders video clips.")}</p>
          </div>

          <div className="flex flex-col justify-between rounded-3xl border border-vibe-cyan/30 bg-vibe-cyan/5 p-6 shadow-2xl">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-vibe-cyan">{t("Agentic orchestration")}</p>
              <h2 className="font-display mt-3 text-2xl leading-tight md:text-3xl">{t("End-to-end workflow automation.")}</h2>
              <div className="mt-4">
                <PipelineFigure />
              </div>
              <p className="mt-3 text-sm text-fg-muted">{t("The production pipeline delivers:")}</p>
            </div>
            <ul className="mt-4 space-y-3">
              {WANTS.map(({ icon: Icon, text }, i) => (
                <motion.li
                  key={text}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-vibe-cyan/15 text-vibe-cyan">
                    <Icon size={15} />
                  </span>
                  <span>{text}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
      </In>

      <In delay={0.9}>
        <div className="mx-auto max-w-3xl rounded-2xl border border-hairline bg-card/60 px-6 py-5 text-center">
          <p className="text-balance text-base text-fg-muted md:text-lg">
            This workflow provides a <span className="font-semibold text-fg">{t("repeatable")}</span>,{" "}
            <span className="font-semibold text-fg">{t("auditable")}</span> production system. In this lab, you build this pipeline
            using an ADK <span className="font-mono text-fg">Workflow</span>. In the final step, you package the graph into
            a complete application, <span className="font-display text-fg">VibeStudio</span>, and deploy it to Cloud Run.
          </p>
          <div className="mt-5">
            <ArcFigure />
          </div>
        </div>
      </In>
    </div>
  );
}
