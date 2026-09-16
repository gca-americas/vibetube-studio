import { useEffect } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { STEPS } from "../steps/registry";
import { TopNav } from "./TopNav";
import { CatchUp } from "./CatchUp";

/** Chrome around one step: nav + roadmap on top, the scene, Back/Next below. */
export function StepShell() {
  const { slug, part } = useParams();
  const navigate = useNavigate();
  const index = STEPS.findIndex((s) => s.slug === slug);

  if (index === -1) return <Navigate to={`/step/${STEPS[0].slug}`} replace />;

  const step = STEPS[index];
  const prev = index > 0 ? STEPS[index - 1] : undefined;
  const next = index < STEPS.length - 1 ? STEPS[index + 1] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" && next) navigate(`/step/${next.slug}`);
      if (e.key === "ArrowLeft" && prev) navigate(`/step/${prev.slug}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, next, prev]);

  return (
    <>
      <TopNav activeSlug={step.slug} />
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8 md:py-10">
          <CatchUp page={part ? `${step.slug}/${part}` : step.slug} color={step.color} />
          {step.element}
        </div>

        <div className="flex items-center justify-center gap-3 px-6 pb-8 pt-2">
          {prev ? (
            <Link
              to={`/step/${prev.slug}`}
              className="rounded-full border border-hairline px-5 py-3 text-sm font-semibold text-fg-muted transition-colors hover:text-fg"
            >
              ← Back
            </Link>
          ) : (
            <span className="px-5 py-3 text-sm opacity-0">← Back</span>
          )}
          <span className="min-w-24 text-center font-mono text-xs text-fg-muted">
            Step {index + 1} of {STEPS.length}
          </span>
          {next ? (
            <Link
              to={`/step/${next.slug}`}
              className="group flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold uppercase tracking-widest text-white"
              style={{ background: step.color }}
            >
              {step.nextLabel ?? "Next"}
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
          ) : (
            <Link
              to={`/step/${STEPS[0].slug}`}
              className="rounded-full border border-hairline px-7 py-3 text-sm font-semibold transition-colors hover:text-fg"
            >
              Back to start
            </Link>
          )}
        </div>
      </main>
    </>
  );
}
