import { t, tf } from "../i18n";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { COLORS, tint } from "../steps/colors";

/** The end of a console command, said plainly. A small "done" in a corner is
 *  easy to miss while you watch the output, so a finished command gets a full
 *  strip: what happened, what to do next, and the button to close. */
export function DoneBanner({
  failed,
  exit,
  message,
  onClose,
  extra,
}: {
  failed: boolean;
  exit: number | null;
  /** One line: what the command did, and what to do next. */
  message: string;
  onClose: () => void;
  /** An action beside Close, for a command that leads somewhere. */
  extra?: ReactNode;
}) {
  const tone = failed ? COLORS.red : COLORS.green;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 border-t px-5 py-4 md:flex-row md:items-center md:justify-between"
      style={{ borderColor: tint(tone, 0.45), background: tint(tone, 0.1) }}
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: tint(tone, 0.2), color: tone }}>
          {failed ? <X size={17} /> : <Check size={17} />}
        </span>
        <div>
          <p className="text-sm font-bold" style={{ color: tone }}>
            {failed ? tf("The command exited with {0}", exit) : t("Finished")}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{failed ? t("The output above says why.") : message}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: tone }} autoFocus>
          {t("Close")}</button>
      </div>
    </motion.div>
  );
}
