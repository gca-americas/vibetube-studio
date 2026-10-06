import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type LoadedStatus } from "../lib/api";
import { COLORS, tint } from "../steps/colors";

const clock = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Before a run: import the app the way adk web will, in a fresh interpreter,
 *  and say whether it loads or what ADK objects to. Then the question that
 *  matters: does adk web have this save? The server compares what it built
 *  its Runner from with the files on disk and puts memory right when it is
 *  behind, so the answer here is verified, not waited for. */
export function LoadCheck({ app, intro }: { app: string; intro?: string }) {
  const [load, setLoad] = useState<{ ok: boolean; edges?: number | null; tools?: number; error: string } | null>(null);
  const [loaded, setLoaded] = useState<LoadedStatus | null>(null);
  const [asking, setAsking] = useState("");   // "" · "loading" · "verifying"

  const run = async () => {
    window.dispatchEvent(new Event("vibe:sync"));   // the editors first: what is on disk is what gets checked
    setAsking("loading");
    setLoad(null);
    setLoaded(null);
    try {
      const r = await api.labLoad(app);
      setLoad(r);
      if (!r.ok) return;
      setAsking("verifying");
      const st = await api.loaded(app);
      setLoaded(st.status === "stale" ? await api.refreshLoaded(app) : st);
    } catch (e) {
      setLoad({ ok: false, error: `could not reach the learning center: ${(e as Error).message}` });
    } finally {
      setAsking("");
    }
  };

  const busy = asking !== "";
  const what = load?.ok ? (load.edges == null ? `loads · an agent with ${load.tools ?? 0} tool${load.tools === 1 ? "" : "s"}` : `loads · ${load.edges} edges`) : "";
  const ready = loaded !== null && (loaded.status === "current" || loaded.status === "fresh");
  const tone = load?.ok ? (loaded === null ? COLORS.amber : ready ? COLORS.green : COLORS.red) : COLORS.red;

  return (
    <section className="rounded-3xl border border-hairline bg-card p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fg-muted">Before you run</p>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{intro ?? `Save your edits, then click the button. It loads ${app} the way adk web will and tells you either that it loads or what ADK objects to.`}</p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex shrink-0 items-center gap-2 rounded-xl border border-hairline bg-overlay px-4 py-2 font-mono text-xs text-fg-muted hover:text-fg disabled:opacity-60"
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {asking === "loading" ? "Loading…" : asking === "verifying" ? "Asking adk web…" : "Check the workflow loads"}
        </button>
      </div>
      {load && (
        <div className="mt-3 rounded-xl border p-3 font-mono text-[11.5px]" style={{ borderColor: tint(tone, 0.4), color: tone, background: tint(tone, 0.06) }}>
          {!load.ok ? (
            load.error
          ) : (
            <>
              {what}
              <span className="mt-1 block opacity-90">
                {loaded === null
                  ? "asking adk web whether it has this save…"
                  : ready
                    ? `adk web has your save from ${clock(loaded.saved_at)} · ready to run`
                    : `adk web could not take your save · ${loaded.detail}`}
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
