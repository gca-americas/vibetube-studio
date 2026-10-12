import { t, tx } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type LoadedStatus } from "../lib/api";
import { COLORS, tint } from "../steps/colors";

const clock = (s: number | null | undefined) =>
  s ? new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

/** Whether adk web is running the code on disk, stated in the frame's toolbar.
 *
 *  The server stamps each Runner the dev UI builds with the sources it was
 *  built from and compares that with the files now, so this is a verified
 *  answer, not a wait. Three cases are shown: adk web is running the save,
 *  adk web will import the save on the next run, or something in memory is
 *  behind the files and a click puts it right. A fourth is about the frame
 *  itself: the dev UI drew its picture of the app when the frame opened, and
 *  a save made after that is not in the picture until the frame reloads. */
export function LoadedBadge({ app, onReload }: { app: string; onReload?: () => void }) {
  const [st, setSt] = useState<LoadedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shownSave = useRef<number | null>(null);   // the save this frame opened with

  const load = useCallback(async () => {
    try {
      const s = await api.loaded(app);
      setSt(s);
      setErr("");
      if (shownSave.current === null) shownSave.current = s.saved_at;
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [app]);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const reload = async () => {
    setBusy(true);
    try {
      const s = await api.refreshLoaded(app);
      setSt(s);
      shownSave.current = s.saved_at;
      onReload?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <span style={{ color: COLORS.red }}>{tx("could not ask the server: {0}", [err])}</span>;
  if (!st) return <span className="text-fg-muted">{t("checking what adk web has…")}</span>;

  const frameBehind = shownSave.current !== null && st.saved_at > shownSave.current + 0.5;
  const wrong = st.status === "stale" || st.status === "error";
  const tone = wrong || frameBehind ? COLORS.amber : COLORS.green;

  let text: string;
  if (st.status === "error") text = `adk web could not reload your code · ${st.detail}`;
  else if (st.status === "stale") text = `adk web has older code · ${st.detail}`;
  else if (frameBehind) text = `you saved at ${clock(st.saved_at)}, after this frame opened`;
  else if (st.status === "current") text = `adk web is running your save from ${clock(st.saved_at)}`;
  else text = `adk web will import your save from ${clock(st.saved_at)} on the next run`;

  return (
    <span className="flex min-w-0 items-center gap-2" style={{ color: tone }}>
      <span className="truncate">{text}</span>
      {(wrong || frameBehind) && (
        <button
          onClick={reload}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold disabled:opacity-50"
          style={{ borderColor: tint(tone, 0.5), background: tint(tone, 0.12), color: tone }}
        >
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> {wrong ? t("Reload the code") : t("Reload adk web")}
        </button>
      )}
    </span>
  );
}
