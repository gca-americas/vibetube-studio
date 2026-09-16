import { useCallback, useEffect, useState } from "react";
import { Check, FastForward, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { STEPS } from "../steps/registry";
import { tint } from "../steps/colors";

/** At the top of every page: the edits every earlier page asked for, and one
 *  button that writes the answers into the files and hands them to adk web.
 *  The pages are the registry's order; the holes and their pages come from
 *  the registry on the server, so nothing here has to be kept in step. */
type Plan = { name: string; page: string; label: string; state: string };

function pageIndex(page: string): number {
  const [slug, part] = page.split("/");
  let i = 0;
  for (const s of STEPS) {
    const parts = s.parts?.map((p) => p.id) ?? [""];
    for (const p of parts) {
      if (s.slug === slug && (p === (part ?? "") || (!s.parts && !part))) return i;
      i++;
    }
  }
  return -1;
}

export function CatchUp({ page, color }: { page: string; color: string }) {
  const [plan, setPlan] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPlan(await api.holesPlan());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setFilled(null);
    load();
  }, [load, page]);

  const here = pageIndex(page);
  const earlier = (plan ?? []).filter((h) => pageIndex(h.page) < here).sort((a, b) => pageIndex(a.page) - pageIndex(b.page));
  const open = earlier.filter((h) => h.state === "open");
  if (here < 0 || earlier.length === 0) return null;

  const fill = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.fillHoles(open.map((h) => h.name));
      setFilled(r.filled);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tone = open.length > 0 ? color : "var(--vibe-green)";
  return (
    <section className="mb-8 rounded-2xl border px-5 py-4" style={{ borderColor: tint(tone, 0.4), background: tint(tone, 0.05) }}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: tone }}>
            Earlier steps
          </p>
          {open.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-fg">
                {open.length} of the {earlier.length} edits from earlier steps {open.length === 1 ? "is" : "are"} still open. One click writes the answers into the files and adk web picks them up.
              </p>
              <ul className="mt-2 grid gap-x-6 gap-y-0.5 font-mono text-[11px] text-fg-muted md:grid-cols-2">
                {open.map((h) => (
                  <li key={h.name}>
                    {h.page} · {h.label}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-fg-muted">
              {filled ? `Filled ${filled.length} edit${filled.length === 1 ? "" : "s"}; adk web has them. ` : ""}
              All {earlier.length} edits from earlier steps are in place.
            </p>
          )}
          {error && <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--vibe-red)" }}>{error}</p>}
        </div>
        {open.length > 0 ? (
          <button onClick={fill} disabled={busy} className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60" style={{ background: color }}>
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <FastForward size={15} />}
            Fill in every earlier step
          </button>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: tint(tone, 0.2), color: tone }}>
            <Check size={16} />
          </span>
        )}
      </div>
    </section>
  );
}
