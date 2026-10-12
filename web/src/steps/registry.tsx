import { t } from "../i18n";
import type { ReactNode } from "react";
import { COLORS } from "./colors";
import { Story } from "./Story";
import { Overview } from "./Overview";
import { SinglePrompt } from "./SinglePrompt";
import { FanOut } from "./FanOut";
import { PolicyGate } from "./PolicyGate";
import { Memory } from "./Memory";
import { Rag } from "./Rag";
import { Video } from "./Video";
import { Deploy } from "./Deploy";
import { Summary } from "./Summary";

export { COLORS };

export interface Step {
  slug: string;
  label: string;
  color: string;
  element: ReactNode;
  /** Text on the Next button leading out of this step. */
  nextLabel?: string;
  /** Sub-pages, each at /step/<slug>/<id>; shown as chips in the top bar. */
  parts?: { id: string; label: string }[];
}

/**
 * The workshop, in order. Each entry is a page at /step/<slug>. Numbering
 * matches the codelab: 1 story (introduction), 2 what you build (setup),
 * 3 a single prompt (3a ADK at a glance, 3b the agent, 3c tools), 4 the fan-out.
 */
export const STEPS: Step[] = [
  { slug: "story", label: t("The story"), color: COLORS.cyan, element: <Story />, nextLabel: t("Enter the studio") },
  {
    slug: "overview",
    label: t("What you build"),
    color: COLORS.purple,
    element: <Overview />,
    nextLabel: t("Start building"),
  },
  {
    slug: "single-prompt",
    label: t("Monolithic agent"),
    color: COLORS.blue,
    element: <SinglePrompt />,
    parts: [
      { id: "a", label: t("ADK agent architecture") },
      { id: "b", label: t("Monolithic agent specification") },
      { id: "c", label: t("Tools in Agent") },
    ],
  },
  {
    slug: "fan-out",
    label: t("Agentic workflow fundamentals"),
    color: COLORS.amber,
    element: <FanOut />,
    parts: [
      { id: "a", label: t("Graph architecture and execution chains") },
      { id: "b", label: t("Parallel research fan-out") },
      { id: "c", label: t("Agent nodes") },
      { id: "d", label: t("Human-in-the-loop") },
    ],
  },
  {
    slug: "policy-gate",
    label: t("State and Router"),
    color: COLORS.red,
    element: <PolicyGate />,
    parts: [
      { id: "a", label: t("Workflow State") },
      { id: "b", label: t("The router node") },
      { id: "c", label: t("Agent modes and the task node") },
    ],
  },
  {
    slug: "memory",
    label: "Memory Bank",
    color: COLORS.purple,
    element: <Memory />,
    parts: [
      { id: "a", label: "Memory Bank" },
      { id: "b", label: t("Callbacks") },
    ],
  },
  {
    slug: "rag",
    label: "RAG Engine",
    color: COLORS.cyan,
    element: <Rag />,
    parts: [
      { id: "a", label: "RAG Engine" },
      { id: "b", label: t("The third reader") },
    ],
  },
  {
    slug: "video",
    label: t("The video"),
    color: COLORS.amber,
    element: <Video />,
    parts: [
      { id: "a", label: t("A long-running tool") },
      { id: "b", label: t("render_desk in the graph") },
    ],
  },
  {
    slug: "deploy",
    label: t("Deploy"),
    color: COLORS.green,
    element: <Deploy />,
  },
  {
    slug: "summary",
    label: t("Summary"),
    color: COLORS.purple,
    element: <Summary />,
  },
];
