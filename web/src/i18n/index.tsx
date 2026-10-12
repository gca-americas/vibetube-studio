import { Fragment, type ReactNode } from "react";
import es from "./es.json";
import pt from "./pt.json";

/** The page in three languages. English is the source and the key: every
 *  string in the code is English, and t() looks it up in the active
 *  language's dictionary, falling back to the English it was given, so a
 *  missing translation can never blank a page. The language is settled once,
 *  when the page loads (the ?lang= parameter, then the remembered choice,
 *  then English), and switching reloads the page: module-level text is then
 *  evaluated in the new language with everything else. Console output,
 *  code, commands and the embedded adk web stay English. */
export type Lang = "en" | "es" | "pt";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "es", label: "ES" },
  { id: "pt", label: "PT" },
];
const KEY = "vibe.lang";

function detect(): Lang {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  const v = fromUrl || stored || "en";
  return (LANGS.some((l) => l.id === v) ? v : "en") as Lang;
}

export const LANG: Lang = detect();
try {
  document.documentElement.lang = LANG;
  if (new URLSearchParams(window.location.search).get("lang")) window.localStorage.setItem(KEY, LANG);
} catch {
  /* a document without storage still renders, in the detected language */
}

const DICT: Record<Lang, Record<string, string>> = { en: {}, es, pt };

/** The translation of an English string, or the string itself. */
export function t(s: string): string {
  return DICT[LANG][s] ?? s;
}

/** A template with {0}, {1}… placeholders filled with plain values. */
export function tf(template: string, ...values: (string | number | null | undefined)[]): string {
  return t(template).replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ""));
}

/** A template whose placeholders are React nodes: inline code, links, bold. */
export function tx(template: string, parts: ReactNode[]): ReactNode {
  const text = t(template);
  const out: ReactNode[] = [];
  const re = /\{(\d+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<Fragment key={out.length}>{parts[Number(m[1])]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Remember the choice and reload: the whole page re-evaluates in it. */
export function setLang(l: Lang) {
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    /* no storage: the ?lang= parameter carries it for this load */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", l);
  window.location.href = url.toString();
}
