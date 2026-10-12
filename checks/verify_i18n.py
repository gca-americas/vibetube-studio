#!/usr/bin/env python3
"""The page's translations are complete and well-formed.

Every English string the page passes to t(), tf() or tx() must be in both
dictionaries (web/src/i18n/es.json, pt.json), with the same {n}
placeholders; a dictionary must not carry keys the page no longer uses.
Writes web/src/i18n/catalog.json (English string -> files) as a side
effect, so the catalog always matches the sources.

    python checks/verify_i18n.py            check
    python checks/verify_i18n.py --catalog  only rebuild the catalog
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
I18N = SRC / "i18n"
LANGS = ("es", "pt")
# the wrapper and hand edits quote keys with JSON.stringify, so a key is one JSON string literal
CALL = re.compile(r'\b(?:t|tf|tx)\(\s*("(?:[^"\\]|\\.)*")')
PH = re.compile(r"\{\d+\}")


def catalog() -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for f in sorted(SRC.rglob("*.tsx")):
        if f.is_relative_to(I18N):
            continue
        text = f.read_text()
        for m in CALL.finditer(text):
            key = json.loads(m.group(1))
            out.setdefault(key, set()).add(str(f.relative_to(SRC)))
    return {k: sorted(v) for k, v in sorted(out.items())}


def main() -> int:
    cat = catalog()
    (I18N / "catalog.json").write_text(json.dumps(cat, indent=1, ensure_ascii=False) + "\n")
    print(f"catalog: {len(cat)} strings in {len({f for v in cat.values() for f in v})} files")
    if "--catalog" in sys.argv:
        return 0
    bad = 0
    for lang in LANGS:
        path = I18N / f"{lang}.json"
        d = json.loads(path.read_text())
        missing = [k for k in cat if k not in d]
        stale = [k for k in d if k not in cat]
        empty = [k for k, v in d.items() if not isinstance(v, str) or not v.strip()]
        # a translation may leave a placeholder out (an English "is/are" or plural "s" it has no use for), never invent one
        shape = [k for k, v in d.items() if k in cat and not set(PH.findall(v)) <= set(PH.findall(k))]
        same = sum(1 for k, v in d.items() if k in cat and v == k)
        print(f"{lang}: {len(d)} entries · {len(missing)} missing · {len(stale)} stale · {len(shape)} placeholder mismatches · {len(empty)} empty · {same} identical to English")
        for label, items in (("missing", missing), ("stale", stale), ("placeholder mismatch", shape), ("empty", empty)):
            for k in items[:8]:
                print(f"   {label}: {k[:110]}")
            if len(items) > 8:
                print(f"   … {len(items) - 8} more {label}")
        bad += len(missing) + len(stale) + len(shape) + len(empty)
    print("OK" if not bad else f"FAIL: {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
