import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRunEvents } from "../lib/api";
import { RefreshCw, Check, Loader2, RotateCcw, Save } from "lucide-react";
import { tint } from "../steps/colors";

/**
 * A small in-page Python editor: a transparent textarea over a highlighted
 * <pre>, so typing stays native and the display is colored. Saves through
 * the /api/code endpoint, which syntax-checks before writing and returns the
 * result. Used for the lab's hands-on edits so students never leave the app.
 */

type SaveState = "saved" | "unsaved" | "saving" | "invalid";

interface Validation {
  valid: boolean;
  message: string;
  line?: number | null;
}

/** Identical text metrics for the highlighted layer and the textarea. */
const METRICS: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: "1.6",
  tabSize: 4,
  letterSpacing: "normal",
  fontVariantLigatures: "none",
};

const KEYWORDS = /\b(def|class|if|elif|else|while|for|in|return|yield|import|from|as|try|except|finally|with|pass|break|continue|lambda|global|nonlocal|assert|del|raise|async|await|and|or|not|is|None|True|False)\b/;

function highlight(line: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hash = line.indexOf("#");
  let code = line;
  let comment = "";
  // a '#' outside a string starts a comment (good enough for this file)
  if (hash >= 0 && (line.slice(0, hash).match(/"/g)?.length ?? 0) % 2 === 0) {
    code = line.slice(0, hash);
    comment = line.slice(hash);
  }
  const parts = code.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g);
  const html = parts
    .map((p, i) => {
      if (i % 2 === 1) return `<span class="tok-str">${esc(p)}</span>`;
      return esc(p)
        .replace(KEYWORDS, (m) => `<span class="tok-kw">${m}</span>`)
        .replace(/\b([A-Za-z_]\w*)(?=\()/g, `<span class="tok-fn">$1</span>`);
    })
    .join("");
  return html + (comment ? `<span class="tok-cm">${esc(comment)}</span>` : "");
}

export function CodeEditor({
  path,
  symbol,
  accent,
  highlightPattern,
  onSaved,
}: {
  path: string;
  /** Edit only this top-level function or assignment instead of the whole file. */
  symbol?: string;
  accent: string;
  /** Lines matching this get a soft accent background (the line to edit). */
  highlightPattern?: RegExp;
  onSaved?: (content: string, validation: Validation) => void;
}) {
  const [code, setCode] = useState("");
  const [original, setOriginal] = useState("");
  const [state, setState] = useState<SaveState>("saved");
  const [validation, setValidation] = useState<Validation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  // the file changed on disk while this editor holds unsaved edits: what is there now
  const [onDisk, setOnDisk] = useState<{ content: string; validation: Validation } | null>(null);
  const [reloading, setReloading] = useState(false);
  const known = useRef({ code: "", original: "" });
  known.current = { code, original };

  const fetchFile = useCallback(async () => {
    const r = await fetch(`/api/code?path=${encodeURIComponent(path)}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || typeof d.content !== "string") throw new Error(d.detail || `${r.status} from /api/code`);
    return d as { content: string; validation: Validation };
  }, [path, symbol]);

  const adopt = (d: { content: string; validation: Validation }) => {
    setCode(d.content);
    setOriginal(d.content);
    setValidation(d.validation);
    setOnDisk(null);
    setState("saved");
  };

  useEffect(() => {
    fetchFile()
      .then((d) => {
        adopt(d);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(`Could not load ${path}: ${e.message}. Restart the server (scripts/start.sh) if it predates this build.`));
  }, [fetchFile, path]);

  // Other things write this file too: the catch-up bar, the skeleton button, a
  // rescue in a terminal. The server marks every such write; when it does,
  // the editor takes the file as it is now, unless it holds unsaved edits, in
  // which case it says so and lets the person choose.
  const { snapshot } = useRunEvents();
  useEffect(() => {
    if (!snapshot) return;
    fetchFile()
      .then((d) => {
        const { code: c, original: o } = known.current;
        if (d.content === o) return;                 // nothing new on disk
        if (c === o) adopt(d);                        // no unsaved edits: show the file as it is
        else setOnDisk(d);                            // unsaved edits: do not clobber them
      })
      .catch(() => undefined);
  }, [snapshot?.updated_at, fetchFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (content: string) => {
    setState("saving");
    const res = await fetch("/api/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, symbol }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.validation) {
      setValidation({ valid: false, message: d.detail || `save failed (${res.status})` });
      setState("invalid");
      return;
    }
    setValidation(d.validation);
    setState(d.validation.valid ? "saved" : "invalid");
    if (d.validation.valid) {
      setOriginal(content);
      onSaved?.(content, d.validation);
    }
  };

  const onChange = (v: string) => {
    setCode(v);
    setState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 700);
  };

  const lines = useMemo(() => code.split("\n"), [code]);
  // Which lines sit inside a triple-quoted string (docstrings), so their
  // words are not colored as keywords.
  const inString = useMemo(() => {
    let open = false;
    return lines.map((l) => {
      const before = open;
      const n = (l.match(/"""/g) || []).length;
      if (n % 2 === 1) open = !open;
      return before || n % 2 === 1;   // inside, or the line that opens/closes one
    });
  }, [lines]);
  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  if (loadError) {
    return (
      <div className="rounded-2xl border border-vibe-red/50 bg-card p-4 font-mono text-xs text-vibe-red">{loadError}</div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-card">
      <div className="flex items-center justify-between border-b border-hairline bg-overlay px-3 py-1.5 font-mono text-[11px] text-fg-muted">
        <span>
          {path}
          {symbol && <span className="text-fg"> · {symbol}</span>}
        </span>
        <div className="flex items-center gap-3">
          {onDisk && (
            <button
              onClick={() => adopt(onDisk)}
              className="flex items-center gap-1 rounded-md border px-2 py-0.5 font-bold"
              style={{ borderColor: "var(--vibe-amber)", color: "var(--vibe-amber)" }}
              title="Something else wrote this file. Show it as it is now; your unsaved edits here are dropped."
            >
              <RotateCcw size={11} /> changed on disk · reload
            </button>
          )}
          <span className="flex items-center gap-1.5">
            {state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {state === "saved" && <Check size={12} className="text-vibe-green" />}
            {state === "saved" ? "saved" : state === "saving" ? "saving" : state === "invalid" ? "not saved" : "unsaved"}
          </span>
          <button
            onClick={() => {
              if (onDisk) adopt(onDisk);
              else {
                setCode(original);
                setState("saved");
              }
            }}
            className="flex items-center gap-1 hover:text-fg"
            title="Drop unsaved edits and show the file as it is saved"
          >
            <RotateCcw size={12} /> reset
          </button>
          <button
            onClick={async () => {
              // read the file again from disk, whatever this editor thinks it holds
              setReloading(true);
              try {
                adopt(await fetchFile());
                setLoadError(null);
              } catch (e) {
                setLoadError(`Could not reload ${path}: ${(e as Error).message}`);
              } finally {
                setReloading(false);
              }
            }}
            className="flex items-center gap-1 hover:text-fg"
            title="Read the file from disk again. Unsaved edits here are dropped."
          >
            <RefreshCw size={12} className={reloading ? "animate-spin" : ""} /> reload
          </button>
          <button onClick={() => save(code)} className="flex items-center gap-1 hover:text-fg" title="Save now">
            <Save size={12} /> save
          </button>
        </div>
      </div>

      <div className="relative">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none m-0 overflow-hidden whitespace-pre border-0 px-4 py-3 text-fg"
          style={{ ...METRICS, height: `calc(${Math.max(lines.length, 8)} * 1.6em + 24px)` }}
        >
          {lines.map((l, i) => (
            <div
              key={i}
              className="-mx-4 px-4"
              // Every row is exactly one line tall, even when the line is
              // empty: a zero-height row would shift every later row against
              // the textarea and put the caret on the wrong line.
              style={{
                height: "1.6em",
                ...(highlightPattern?.test(l) ? { background: tint(accent, 0.13), boxShadow: `inset 3px 0 0 ${accent}` } : {}),
              }}
              dangerouslySetInnerHTML={{
                __html: inString[i]
                  ? `<span class="tok-str">${(l || " ").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`
                  : highlight(l) || " ",
              }}
            />
          ))}
        </pre>
        {/* Both layers: same font, size, line-height, padding, tab size, and
            no soft wrap. Any difference between them puts the caret on the
            wrong line, so every metric is set explicitly on both. */}
        <textarea
          ref={taRef}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          wrap="off"
          className="absolute inset-0 m-0 h-full w-full resize-none overflow-x-auto overflow-y-hidden whitespace-pre border-0 bg-transparent px-4 py-3 caret-[var(--fg)] outline-none"
          style={{ ...METRICS, color: "transparent", WebkitTextFillColor: "transparent" }}
        />
      </div>

      <div
        className="flex items-center gap-2 border-t border-hairline px-3 py-1.5 font-mono text-[11px]"
        style={{ color: validation?.valid === false ? "var(--color-vibe-red)" : "var(--fg-muted)" }}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${validation?.valid === false ? "bg-vibe-red" : "bg-vibe-green"}`} />
        {validation ? `${validation.message}${validation.line ? ` (line ${validation.line})` : ""}` : "loading"}
        {validation?.valid === false && <span>· the file on disk was not changed</span>}
      </div>
    </div>
  );
}
