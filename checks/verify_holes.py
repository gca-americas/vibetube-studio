"""Author-side proof for the hole registry, with no separate reference tree:
  1. every hole's anchor OR snippet is present where the registry says;
  2. carving then filling a file reproduces the fully filled file, byte for
     byte (the snippets and anchors are exact inverses);
  3. starter/<file> equals the carved file (what students receive is in sync).
Run: python checks/verify_holes.py   (works from the filled OR carved tree)"""
import pathlib
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from checks.holes import HOLES  # noqa: E402
from scripts.carve import SHIP_HOLES  # noqa: E402
from checks.holes import LABEL, PAGE  # noqa: E402


def _read(rel: str) -> str:
    """The live file, or the starter copy when the live one is not in place
    (the nine student files are not in git; a fresh clone has only starter/)."""
    p = ROOT / rel
    if not p.exists():
        p = ROOT / "starter" / rel
    return p.read_text()


def carved(rel: str, src: str) -> str:
    """The file as students receive it: the shipped holes carved, the rest filled."""
    for name, (r, anchor, snippet) in HOLES.items():
        if r != rel:
            continue
        if name in SHIP_HOLES:
            src = src.replace(snippet, anchor, 1)
        else:
            src = src.replace(anchor, snippet, 1)
    return src


def filled(rel: str, src: str) -> str:
    for name, (r, anchor, snippet) in HOLES.items():
        if r == rel:
            src = src.replace(anchor, snippet, 1)
    return src


def main() -> int:
    fails = []
    by_file = defaultdict(list)
    for name, (rel, anchor, snippet) in HOLES.items():
        by_file[rel].append((name, anchor, snippet))
    for rel, items in sorted(by_file.items()):
        live = _read(rel)
        for name, anchor, snippet in items:
            if anchor not in live and snippet not in live:
                print(f"  \u2717 {name}: neither snippet nor anchor found in {rel}")
                fails.append(name)
        full = filled(rel, live)
        if filled(rel, carved(rel, full)) != full:
            print(f"  \u2717 {rel}: carve then fill does not reproduce the filled file")
            fails.append(rel)
        starter = ROOT / "starter" / rel
        if not starter.exists():
            print(f"  \u2717 {rel}: no starter copy at starter/{rel}")
            fails.append(rel)
        elif starter.read_text() != carved(rel, full):
            print(f"  \u2717 starter/{rel} differs from the carved file (rerun scripts/carve.py, then copy)")
            fails.append(rel)
        else:
            names = " + ".join(n for n, _, _ in items)
            print(f"  \u2713 {rel}: {names} round-trip; starter/ matches")
    print()
    for name in SHIP_HOLES:
        if name not in PAGE or name not in LABEL:
            print(f"  \u2717 {name}: no page or label in checks/holes.py (the catch-up bar needs both)")
            fails.append(name)
    if fails:
        print(f"HOLES VERIFY: {len(fails)} FAILURE(S): {fails}")
        return 1
    print(f"HOLES VERIFY: all {len(HOLES)} holes round-trip byte-for-byte; starter/ in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
