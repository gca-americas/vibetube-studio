import { tx } from "../i18n";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

/** Fade-and-rise a block in on mount. */
export function In({
  delay = 0,
  y = 18,
  className = "",
  children,
}: {
  delay?: number;
  y?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Small uppercase label above a heading. */
export function Kicker({ children, color = "var(--color-vibe-cyan)" }: { children: ReactNode; color?: string }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.35em]" style={{ color }}>
      {children}
    </p>
  );
}

/** Standard page header used by every step. */
export function StepHeader({
  kicker,
  title,
  blurb,
  color,
}: {
  kicker: string;
  title: string;
  blurb?: ReactNode;
  color?: string;
}) {
  return (
    <In className="mx-auto max-w-3xl text-center">
      <Kicker color={color}>{kicker}</Kicker>
      <h1 className="font-display text-balance mt-3 text-3xl leading-tight md:text-5xl">{title}</h1>
      {blurb && <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-fg-muted md:text-lg">{blurb}</p>}
    </In>
  );
}

/** Placeholder for a step that is not built yet. */
export function StubScene({ kicker, title, blurb }: { kicker: string; title: string; blurb: string }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <StepHeader kicker={kicker} title={title} blurb={blurb} />
      <In delay={0.25} className="mt-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-card px-5 py-2 font-mono text-xs text-fg-muted">
          {tx("{0}This step is being built", [<span className="h-2 w-2 rounded-full bg-vibe-amber" />])}</div>
      </In>
    </div>
  );
}
