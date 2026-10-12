// Wrap the page's English in t()/tf()/tx() and write the catalog of strings.
//
//   node scripts/i18n-wrap.mjs            rewrite src/steps, src/components and App.tsx
//   node scripts/i18n-wrap.mjs --dry      only report; checks/verify_i18n.py builds src/i18n/catalog.json from the sources
//
// What is translated: JSX text (a run of text and inline elements becomes one
// template with {0} {1}… placeholders, so a sentence stays one sentence),
// allowlisted attributes (title, blurb, label…), and string literals that
// read as prose in object fields and call arguments (the figures' labels).
// What is not: code, commands, paths, class names, identifiers, anything
// under <pre>, <code>, CopyLine, CopyBlock, CodeEditor, and the i18n module.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src");
const DRY = process.argv.includes("--dry");
const FILES = [...walk(path.join(ROOT, "steps")), ...walk(path.join(ROOT, "components")), path.join(ROOT, "App.tsx")]
  .filter((f) => f.endsWith(".tsx"));

const INLINE = new Set(["code", "b", "i", "em", "strong", "span", "a", "kbd", "br", "sub", "sup", "Link", "small", "u"]);
const SKIP_TAGS = new Set(["pre", "code", "style", "script", "CopyLine", "CopyBlock", "CodeEditor", "textarea", "input", "svg", "defs", "marker", "path", "rect", "circle", "line", "polygon", "ellipse", "g"]);
// svg <text> is the exception to the svg skip: its content is a label
const TEXT_TAGS = new Set(["text", "tspan"]);
const ATTRS = new Set(["title", "blurb", "intro", "label", "placeholder", "aria-label", "message", "kicker", "what", "note", "description", "caption", "subtitle", "nextLabel", "alt", "hint", "question", "lead", "heading"]);
const PROP_SKIP = new Set(["line", "cmd", "code", "path", "symbol", "pattern", "id", "key", "href", "src", "to", "className", "style", "color", "icon", "viewBox", "d", "fill", "stroke", "fontFamily", "anchor", "slug", "app", "name", "verb", "page", "route", "font", "mono", "type", "kind", "state", "status", "group", "f", "behavior", "block", "inline", "letterSpacing", "textAnchor", "fontWeight", "fontSize", "display", "position", "transition", "ease", "mode", "cmd", "method", "headers", "variant", "size", "align"]);
const CALL_SKIP = /^(set[A-Z]\w*|use[A-Z]\w*|setTimeout|setInterval|fetch|console\.\w+|new (RegExp|Error|URL|Event|CustomEvent|Date)|RegExp|Error|document\.\w+|window\.\w+|\w+\.(querySelector\w*|getElementById|matchMedia|setItem|getItem|removeItem|addEventListener|removeEventListener|dispatchEvent|classList\.\w+|includes|startsWith|endsWith|indexOf|split|replace|test|match|join|padStart|padEnd|localeCompare|toLocale\w+|scrollIntoView|scrollTo|toggle|push|unshift|add|has|get|set|delete|focus|open|postMessage))$/;
const CODEISH = /[=(){}<>\[\]`$\\]|^\s*(python|gcloud|uv |npm|node|git|curl|\.\/|\/|https?:|runs\/|agent\/|stage\d|scripts\/|web\/|checks\/|vibestudio)/;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Does a string read as prose rather than code, a name, or a symbol? */
function isProse(s) {
  const txt = s.trim();
  if (txt.length < 2) return false;
  if (STOP.has(txt)) return false;
  if (CODEISH.test(txt)) return false;
  const words = txt.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length >= 2) return true;
  // a single word: only if it is a real word with a capital or long enough, not an identifier
  return words.length === 1 && !/[_./:]/.test(txt) && /^[A-Z][a-z]{3,}$|^[a-z]{5,}$/.test(txt) && txt === words[0];
}

const catalog = new Map(); // template -> Set(files)
function record(tpl, file) {
  if (!catalog.has(tpl)) catalog.set(tpl, new Set());
  catalog.get(tpl).add(path.relative(ROOT, file));
}

function tagName(el) {
  const open = ts.isJsxElement(el) ? el.openingElement : el;
  return open.tagName.getText();
}

function collapse(text) {
  return text.replace(/\s+/g, " ");
}

/** The text React renders for a JSX text node: lines trimmed, blank lines
 *  dropped, lines joined by one space; a leading or trailing space on the
 *  same line as a tag is kept, one across a line break is not. */
function jsxText(raw) {
  if (!raw.includes("\n")) return raw.replace(/\s+/g, " ");
  const lines = raw.split("\n");
  const out = [];
  lines.forEach((l, i) => {
    let t = l;
    if (i > 0) t = t.replace(/^\s+/, "");
    if (i < lines.length - 1) t = t.replace(/\s+$/, "");
    if (t !== "") out.push(t);
  });
  return out.join(" ").replace(/[ \t]+/g, " ");
}

// product and code words that are not prose even when they stand alone
const STOP = new Set(["https", "http", "Gemini", "Studio", "Vibe", "Runner", "Veo", "Workflow", "Agent", "JoinNode", "Event", "RequestInput", "START", "adk web", "Memory Bank", "RAG Engine", "GEAP", "ADK", "Vertex", "Cloud Run", "Cloud Build", "VibeStudio", "VibeTube", "vibetube.dev", "model", "Model", "middle", "start", "end"]);

function rewrite(file) {
  const src = fs.readFileSync(file, "utf8");
  if (/from "\.\.?\/i18n"/.test(src)) { console.log(`  ${path.relative(ROOT, file)}: already wrapped, skipped`); return { changed: false, count: 0 }; }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = []; // {start, end, text}
  const used = new Set();
  const done = new Set(); // node positions already covered by an edit

  function covered(node) {
    for (const e of edits) if (node.getStart() >= e.start && node.getEnd() <= e.end) return true;
    return false;
  }

  function quoteTpl(s) {
    return JSON.stringify(s);
  }

  // ── JSX children: text runs become templates ──
  function handleChildren(parent, children, insideSkip) {
    if (insideSkip) return;
    const kids = children.filter((c) => !(ts.isJsxText(c) && jsxText(c.getFullText()) === ""));
    const hasText = kids.some((c) => ts.isJsxText(c) && c.getFullText().trim() !== "");
    const hasBlock = kids.some((c) => (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && !INLINE.has(tagName(c)) && !TEXT_TAGS.has(tagName(c)));
    if (!hasText) return;
    if (hasBlock) {
      // mixed with block elements: translate each standalone text node on its own
      for (const c of kids) {
        if (ts.isJsxText(c)) {
          const raw = c.getFullText();
          const txt = jsxText(raw).trim();
          if (!isProse(txt)) continue;
          const lead = "";
          const tail = /\s$/.test(raw) ? " " : "";
          edits.push({ start: c.getStart(), end: c.getEnd(), text: `${lead}{t(${quoteTpl(txt)})}${tail}` });
          used.add("t"); record(txt, file);
        }
      }
      return;
    }
    // one template over the run
    const parts = []; let tpl = ""; let n = 0;
    for (const c of kids) {
      if (ts.isJsxText(c)) {
        tpl += jsxText(c.getFullText());
      } else if (ts.isJsxExpression(c)) {
        if (!c.expression) continue;
        // {" "} and friends are just spacing
        const ex = c.expression;
        if (ts.isStringLiteral(ex) && ex.text.trim() === "") { tpl += " "; continue; }
        tpl += `{${n++}}`; parts.push(ex.getText());
      } else {
        tpl += `{${n++}}`; parts.push(c.getText());
      }
    }
    tpl = collapse(tpl).trim();
    if (!/[A-Za-z]{2,}/.test(tpl.replace(/\{\d+\}/g, ""))) return;   // only placeholders and symbols
    if (!isProse(tpl.replace(/\{\d+\}/g, "x"))) return;
    const first = kids[0], last = kids[kids.length - 1];
    const start = first.getStart(), end = last.getEnd();
    const lead = /^\s/.test(first.getText()) && ts.isJsxText(first) ? "" : "";
    const call = parts.length ? `{tx(${quoteTpl(tpl)}, [${parts.join(", ")}])}` : `{t(${quoteTpl(tpl)})}`;
    edits.push({ start, end, text: lead + call });
    used.add(parts.length ? "tx" : "t"); record(tpl, file);
    // text inside inline parts (e.g. <b>repeatable</b>) is translated on its own
    for (const c of kids) {
      if ((ts.isJsxElement(c)) && INLINE.has(tagName(c))) handleInlineInner(c);
    }
  }

  function handleInlineInner(el) {
    const kids = el.children.filter((c) => !(ts.isJsxText(c) && c.getFullText().trim() === ""));
    if (kids.length === 1 && ts.isJsxText(kids[0])) {
      const txt = jsxText(kids[0].getFullText()).trim();
      if (!isProse(txt)) return;
      // only inside <b>/<strong>/<em>/<i>/<span>/<a>/<Link>, never <code>/<kbd>
      if (["code", "kbd"].includes(tagName(el))) return;
      // the edit replaces the inner text in place; the outer template keeps the element's source,
      // so apply this inner edit to the element's source text through a nested rewrite marker
      inner.push({ el, start: kids[0].getStart(), end: kids[0].getEnd(), text: `{t(${quoteTpl(txt)})}` });
      used.add("t"); record(txt, file);
    }
  }
  const inner = []; // inner edits inside inline elements referenced by templates

  // ── attributes ──
  function handleAttr(attr) {
    if (!ts.isJsxAttribute(attr) || !attr.initializer) return;
    const name = attr.name.getText();
    if (!ATTRS.has(name)) return;
    const init = attr.initializer;
    if (ts.isStringLiteral(init)) {
      if (!isProse(init.text)) return;
      edits.push({ start: init.getStart(), end: init.getEnd(), text: `{t(${quoteTpl(init.text)})}` });
      used.add("t"); record(init.text, file);
    } else if (ts.isJsxExpression(init) && init.expression) {
      handleExpression(init.expression, true);
    }
  }

  // ── expressions: string literals and templates that read as prose ──
  function handleExpression(ex, force = false, arg = false) {
    if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) {
      if (!isProse(ex.text)) return;
      if (arg && ex.text.trim().split(/\s+/).length < 2) return;
      if (covered(ex)) return;
      edits.push({ start: ex.getStart(), end: ex.getEnd(), text: `t(${quoteTpl(ex.text)})` });
      used.add("t"); record(ex.text, file);
    } else if (ts.isTemplateExpression(ex)) {
      let tpl = ex.head.text; const vals = [];
      ex.templateSpans.forEach((sp, i) => { tpl += `{${i}}`; vals.push(sp.expression.getText()); tpl += sp.literal.text; });
      if (!isProse(tpl.replace(/\{\d+\}/g, "x"))) return;
      if (covered(ex)) return;
      edits.push({ start: ex.getStart(), end: ex.getEnd(), text: `tf(${quoteTpl(tpl)}, ${vals.join(", ")})` });
      used.add("tf"); record(tpl, file);
    } else if (ts.isConditionalExpression(ex)) {
      handleExpression(ex.whenTrue, force, arg); handleExpression(ex.whenFalse, force, arg);
    } else if (ts.isParenthesizedExpression(ex)) {
      handleExpression(ex.expression, force, arg);
    } else if (ts.isBinaryExpression(ex) && (ex.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || ex.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      handleExpression(ex.left, force, arg); handleExpression(ex.right, force, arg);
    }
  }

  // ── the walk ──
  function visit(node, insideSkip) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagName(node);
      const skip = insideSkip || (SKIP_TAGS.has(tag) && !TEXT_TAGS.has(tag));
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      for (const a of open.attributes.properties) {
        if (ts.isJsxAttribute(a) && a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression && !ATTRS.has(a.name.getText())) {
          // non-text attributes may still hold prose in object literals / conditionals (steps=[...], pill={…})
          if (!PROP_SKIP.has(a.name.getText())) visitExpr(a.initializer.expression, skip);
        } else handleAttr(a);
      }
      if (ts.isJsxElement(node)) {
        const textTag = TEXT_TAGS.has(tag);
        handleChildren(node, node.children, skip && !textTag);
        for (const c of node.children) visit(c, skip && !textTag);
      }
      return;
    }
    if (ts.isJsxFragment(node)) {
      handleChildren(node, node.children, insideSkip);
      for (const c of node.children) visit(c, insideSkip);
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) visitExpr(node.expression, insideSkip);
      return;
    }
    if (ts.isPropertyAssignment(node) || ts.isCallExpression(node) || ts.isArrayLiteralExpression(node)) {
      visitExpr(node, insideSkip);
      return;
    }
    ts.forEachChild(node, (c) => visit(c, insideSkip));
  }

  // expressions outside JSX text: object fields, call arguments, arrays
  function visitExpr(node, insideSkip) {
    if (insideSkip) { ts.forEachChild(node, (c) => visit(c, insideSkip)); return; }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText().replace(/^["']|["']$/g, "");
      if (!PROP_SKIP.has(key)) handleExpression(node.initializer);
      ts.forEachChild(node.initializer, (c) => visit(c, false));
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (!CALL_SKIP.test(callee)) for (const a of node.arguments) handleExpression(a, false, true);
      for (const a of node.arguments) visit(a, false);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const e of node.elements) { handleExpression(e); visit(e, false); }
      return;
    }
    if (ts.isConditionalExpression(node) || ts.isTemplateExpression(node) || ts.isStringLiteral(node)) {
      handleExpression(node);
    }
    ts.forEachChild(node, (c) => visit(c, false));
  }

  // module-level statements too: const CHORES = [...], const RULES = [{ text: ... }]
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (d.initializer) visitExpr(d.initializer, false);
    } else visit(st, false);
  }

  if (!edits.length && !inner.length) return { changed: false, count: 0 };
  // inner edits apply inside the source of inline elements that outer templates embed:
  // rewrite the template parts' text by applying inner edits to the file first, then recompute? Simpler:
  // apply inner edits as ordinary edits when they are not already inside an outer edit range,
  // and when they are, patch the outer edit's text.
  for (const ie of inner) {
    const outer = edits.find((e) => ie.start >= e.start && ie.end <= e.end);
    if (!outer) { edits.push({ start: ie.start, end: ie.end, text: ie.text }); continue; }
    const original = src.slice(ie.start, ie.end);
    outer.text = outer.text.replace(original, ie.text);
  }
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue;             // overlapping edit: the outer one already covers it
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  // import only what the final text calls (an edit dropped as overlapping may have been the sole tx)
  const names = ["t", "tf", "tx"].filter((n) => new RegExp(`\\b${n}\\(`).test(out));
  if (names.length) {
    const rel = path.relative(path.dirname(file), path.join(ROOT, "i18n")).replace(/\\/g, "/");
    const imp = `import { ${names.join(", ")} } from "${rel.startsWith(".") ? rel : "./" + rel}";\n`;
    const firstImport = out.indexOf("import ");
    out = out.slice(0, firstImport) + imp + out.slice(firstImport);
  }
  if (!DRY) fs.writeFileSync(file, out);
  return { changed: true, count: edits.length };
}

let total = 0;
for (const f of FILES) {
  const r = rewrite(f);
  if (r.changed) { total += r.count; console.log(`  ${path.relative(ROOT, f)}: ${r.count} strings`); }
}
const cat = Object.fromEntries([...catalog.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, [...v]]));
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "i18n-wrapped.json"), JSON.stringify(cat, null, 1) + "\n");
console.log(`${total} strings wrapped in ${FILES.length} files · ${catalog.size} distinct, listed in scripts/i18n-wrapped.json${DRY ? " (dry run: files untouched)" : ""}`);
