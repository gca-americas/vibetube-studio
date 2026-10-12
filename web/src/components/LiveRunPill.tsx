import { t, tf } from "../i18n";
import { useRunEvents } from "../lib/api";

/**
 * A small live indicator in the top bar: whether the lab server's SSE stream
 * is connected and which console command, if any, is running on it.
 */
export function LiveRunPill() {
  const { snapshot, connected } = useRunEvents();
  const busy = snapshot?.busy ?? null;
  const dot = busy ? "bg-vibe-cyan animate-pulse" : connected ? "bg-vibe-green" : "bg-fg-muted/40";
  return (
    <span className="hidden items-center gap-2 rounded-full border border-hairline bg-card/60 px-3 py-1 font-mono text-[11px] text-fg-muted sm:inline-flex" title={busy ? `python -m agent.${busy} is running` : connected ? t("live: the page hears the server") : t("not connected")}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{busy ? tf("agent.{0} running", busy) : connected ? "live" : t("offline")}</span>
    </span>
  );
}
