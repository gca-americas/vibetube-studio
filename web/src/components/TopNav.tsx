import { LANG, LANGS, setLang, t, tx, type Lang } from "../i18n";
import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, Globe, Moon, Sun } from "lucide-react";
import { STEPS } from "../steps/registry";
import { tint } from "../steps/colors";
import { useTheme } from "./ThemeProvider";
import { LiveRunPill } from "./LiveRunPill";

/**
 * Brand bar plus the step roadmap. Every step is a link, the current one is
 * expanded with its label, completed ones are filled. Mirrors the two-row
 * header used across the Vibetube labs.
 */
export function TopNav({ activeSlug }: { activeSlug: string }) {
  const { theme, toggle } = useTheme();
  const activeRef = useRef<HTMLAnchorElement>(null);
  const activeIndex = STEPS.findIndex((s) => s.slug === activeSlug);
  const active = STEPS[activeIndex];
  const { part } = useParams();
  const activePart = active?.parts ? (active.parts.some((p) => p.id === part) ? part : active.parts[0].id) : undefined;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeSlug]);

  return (
    <nav className="sticky top-0 z-50 border-b border-hairline bg-card/40 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link to={`/step/${STEPS[0].slug}`} className="flex items-center gap-2" aria-label={t("Vibe Studio home")}>
          <span className="font-display text-xl tracking-tight">
            {tx("Vibe{0}", [<span className="holo-text">Studio</span>])}
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-fg-muted sm:inline">
            {t("· Agentic Workflow with ADK")}</span>
        </Link>
        <div className="flex items-center gap-3">
          <LiveRunPill />
          <label className="relative flex items-center gap-1 rounded-full border border-vibe-line bg-vibe-card pl-2 pr-1 text-[11px] font-semibold text-vibe-muted hover:text-vibe-ink" title={t("Language")}>
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <select
              value={LANG}
              onChange={(e) => setLang(e.target.value as Lang)}
              aria-label={t("Language")}
              className="cursor-pointer appearance-none bg-transparent py-0.5 pl-0.5 pr-4 text-inherit outline-none"
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3" aria-hidden="true" />
          </label>
          <button
            onClick={toggle}
            className="rounded-lg p-2 transition-opacity hover:opacity-80"
            aria-label={t("Toggle theme")}
            title={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}
          >
            {theme === "dark" ? <Sun className="h-5 w-5 text-vibe-amber" /> : <Moon className="h-5 w-5 text-vibe-purple" />}
          </button>
        </div>
      </div>

      <div className="border-t border-hairline bg-card/25 px-4 py-2 backdrop-blur-md md:px-8">
        <ol className="mx-auto flex max-w-7xl items-center justify-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
          {STEPS.map((s, i) => {
            const active = i === activeIndex;
            const done = i < activeIndex;
            return (
              <li key={s.slug} className="flex shrink-0 items-center gap-1.5">
                {i > 0 && <span className="px-0.5 text-xs text-fg-muted/30">›</span>}
                <Link
                  to={`/step/${s.slug}`}
                  ref={active ? activeRef : null}
                  title={`Step ${i + 1}: ${s.label}`}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center justify-center gap-1.5 border transition-all ${
                    active
                      ? "rounded-xl px-3 py-1.5 text-xs font-semibold"
                      : "h-7 w-7 rounded-full border-hairline bg-overlay/60 font-mono text-xs text-fg-muted hover:scale-105 hover:bg-hairline hover:text-fg"
                  }`}
                  style={
                    active
                      ? { background: tint(s.color, 0.13), color: s.color, borderColor: tint(s.color, 0.33) }
                      : done
                        ? { color: s.color, borderColor: tint(s.color, 0.4) }
                        : undefined
                  }
                >
                  <span
                    className={active ? "flex h-4 w-4 items-center justify-center rounded-full bg-overlay font-mono text-[10px]" : ""}
                  >
                    {done && !active ? "✓" : i + 1}
                  </span>
                  {active && <span className="whitespace-nowrap">{s.label}</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      {active?.parts && (
        <div className="border-t border-hairline bg-card/20 px-4 py-1.5 backdrop-blur-md md:px-8">
          <ol className="mx-auto flex max-w-7xl items-center justify-center gap-2 overflow-x-auto [scrollbar-width:none]">
            {active.parts.map((p, i) => {
              const on = p.id === activePart;
              const done = active.parts!.findIndex((q) => q.id === activePart) > i;
              return (
                <li key={p.id} className="shrink-0">
                  <Link
                    to={`/step/${active.slug}/${p.id}`}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-all ${on ? "font-semibold" : "text-fg-muted hover:text-fg"}`}
                    style={
                      on
                        ? { background: tint(active.color, 0.13), color: active.color, borderColor: tint(active.color, 0.4) }
                        : { borderColor: done ? tint(active.color, 0.4) : "var(--hairline)" }
                    }
                  >
                    <span className="font-mono">
                      {activeIndex + 1}
                      {p.id}
                    </span>
                    <span>{p.label}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </nav>
  );
}
