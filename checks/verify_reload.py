"""The save-time reload must leave the stage apps importable and every schema
class the same object it was.

Two things went wrong once. agent.schemas was reloaded, which minted a second
Directions class, and graph.py was reloaded first when it was the file edited,
so nodes ended up holding classes from two generations and ADK's validator
refused the graph (from_node.output_schema is to_node.input_schema). This
check runs the reload the way server/services/reload.py runs it after a save
and fails if either could happen again.
Run: python checks/verify_reload.py   (works from the filled OR carved tree)"""
import importlib, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.services import reload as agent_reload   # noqa: E402
import agent.schemas as schemas                       # noqa: E402

STAGES = ["stage0_prompt", "stage1_fanout", "stage2_direction", "stage3_router", "stage4_memory", "stage5_rag", "stage6_video"]
fails: list[str] = []

def load_stage(name: str):
    """Import a stage app fresh, the way the dev UI does after an eviction."""
    for k in [k for k in sys.modules if k == name or k.startswith(name + ".")]:
        del sys.modules[k]
    try:
        return importlib.import_module(name + ".agent").root_agent, ""
    except Exception as e:                              # the carved tree may not build; the point is that reload changes nothing
        return None, f"{type(e).__name__}: {str(e)[:120]}"

# 1 · the reload never touches the schema module, and graph.py always goes last
seen: list[str] = []
real_reload = importlib.reload
agent_reload.importlib.reload = lambda m: seen.append(m.__name__) or real_reload(m)
try:
    for edited in ("agent.graph", "agent.desk", "agent.cleanup_tools", None):
        seen.clear()
        agent_reload.reload_agent_modules(edited)
        if "agent.schemas" in seen:
            fails.append(f"reload({edited}) reloaded agent.schemas")
        if seen and seen[-1] != "agent.graph":
            fails.append(f"reload({edited}) did not reload agent.graph last: {seen}")
finally:
    agent_reload.importlib.reload = real_reload
print("  ✓ agent.schemas is never reloaded; agent.graph is always last" if not fails else "  ✗ " + "; ".join(fails))

# 2 · the schema classes keep their identity across a reload
before = {n: getattr(schemas, n) for n in dir(schemas) if isinstance(getattr(schemas, n), type)}
agent_reload.reload_agent_modules("agent.graph")
for n, cls in before.items():
    if getattr(schemas, n) is not cls:
        fails.append(f"{n} is a different class after reload")
print(f"  ✓ {len(before)} schema classes are the same objects after a reload" if not any("different class" in f for f in fails) else "  ✗ a schema class was replaced")

# 3 · every stage app builds the same way before and after the reloads
baseline = {s: load_stage(s) for s in STAGES}
for edited in ("agent.graph", "agent.desk", None):
    agent_reload.reload_agent_modules(edited)
    for s in STAGES:
        agent, err = load_stage(s)
        b_agent, b_err = baseline[s]
        if (err == "") != (b_err == "") or ("schema" in err.lower() and "schema" not in b_err.lower()):
            fails.append(f"{s} after reload({edited}): {err or 'ok'} (before: {b_err or 'ok'})")
        if agent is not None and getattr(agent, "graph", None) is not None:
            for node in getattr(agent.graph, "nodes", []) or []:
                out = getattr(node, "output_schema", None)
                if isinstance(out, type) and out.__name__ in before and out is not before[out.__name__]:
                    fails.append(f"{s}: {getattr(node, 'name', node)} holds a stale {out.__name__}")
ok_now = sum(1 for s in STAGES if load_stage(s)[1] == "")
print(f"  ✓ the {len(STAGES)} stage apps build the same after every reload ({ok_now} build in this tree)" if not any("after reload" in f or "stale" in f for f in fails) else "  ✗ a stage app changed after a reload")

if fails:
    print("RELOAD VERIFY: " + str(len(fails)) + " FAILURE(S)"); [print("   -", f) for f in fails]; sys.exit(1)
print("RELOAD VERIFY: the save-time reload keeps every schema class and every stage app as it was")
