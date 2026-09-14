# VibeStudio - Agentic Workflow with ADK

The developer workbench for the **VibeStudio** codelab. You run a short-video
channel, and over ten steps you build the workflow that runs it with the
Agent Development Kit: a research fan-out, an agent as a node, a human pause,
a policy router, a task agent, Memory Bank, RAG Engine, Veo as a long-running
tool, and finally an app on top of the whole graph, deployed to Cloud Run.

The walkthrough is [`CODELAB.md`](CODELAB.md). The interactive workbench pages
with in-page editors, runners, and verify panels are served by
`scripts/start.sh` at http://localhost:4600.

## What it teaches

| Step | Concepts |
|---|---|
| 3 · A single prompt | An `Agent` with function tools; `function_call` and `function_response` events |
| 4 · Fan-out and the human pause | `Workflow`, `START`, edges as tuples, `JoinNode`; an `Agent` as a node with `output_schema`; `RequestInput` |
| 5 · State and Router | `Event(state=...)`, parameter binding, the `user:` prefix; a router node; policy as data; `mode="task"` with tools |
| 6 · Memory Bank | Scope, extraction, consolidation, custom topics; `before_model_callback` and `after_agent_callback` |
| 7 · RAG Engine | A corpus, chunking, an embedding model, retrieval by meaning as one more reader in the fan-out |
| 8 · The video | `LongRunningFunctionTool`, the pending receipt, a suspended workflow resumed by id from another process |
| 9 · Deploy | The `Runner`, an app with one event stream, a container on Cloud Run |

## Run it

```bash
git clone https://github.com/weimeilin79/vibe-studio-lab
cd vibe-studio-lab
./setup_project.sh              # a Google Cloud project with billing, recorded in ~/project_id.txt
./setup_codelab.sh              # uv + deps, the APIs, .env, one model call, then the VibeStudio Workbench in the background on :4600
```

Both scripts can be run again; the second keeps the answers you gave before. It ends with `python scripts/preflight.py`, whose last line is the link to step 1. `scripts/stop.sh` stops the workbench, `scripts/start.sh` starts it again, and `scripts/restart.sh --pull` does both around a pull.

Steps 6 to 9 need a Google Cloud project with GEAP enabled (Cloud Shell
already has credentials): Memory Bank, RAG Engine, Veo, and Cloud Run.
`STUDIO_REAL_VIDEO=0` in `.env` replaces the Veo render with a stand-in that
finishes in five seconds, at no cost.

## Updating a running lab

`scripts/restart.sh` handles the two things a pull cannot: it runs `uv sync` when the dependency lock changed, and rebuilds the page when its sources changed, because neither the venv nor `web/dist` is in the repository.


The built page is not in the repository, and the server holds the Python code in memory, so a pull alone changes neither.

```bash
scripts/restart.sh --pull       # git pull, stop, rebuild if needed, start in the background
```

Then reload the browser tab. Without `--pull` it just restarts. It prints the link and leaves the server in the background, with its log in `runs/lab.log`. `scripts/start.sh` is the foreground equivalent, where Ctrl+C stops everything.

The app of step 9 runs on its own:

```bash
vibestudio/run.sh               # the app on http://localhost:4700
python vibestudio/deploy.py     # the same app on Cloud Run (or the button in step 9)
```

The app sends ADK's traces to Cloud Trace in your project (Trace Explorer, service `vibestudio`). `STUDIO_TRACING=0` turns that off.

## Repository layout

```
vibe-studio-lab/
├── agent/                          # Core backend and workflow graph under development
│   ├── graph.py                    # Workflow graph definition, node functions, and routing logic
│   ├── desk.py                     # Video render desk implementing LongRunningFunctionTool
│   ├── schemas.py                  # Pydantic data contracts (directions, gates, script outputs)
│   ├── trends.py                   # Platform trend pool and sampling helpers
│   ├── backlog.txt                 # Creator video idea notes file
│   ├── comments.md                 # Audience comments dataset used to seed RAG Engine
│   ├── deliver.py                  # Asynchronous video delivery handler (emits function_response)
│   ├── cleanup_tools.py            # Word replacement tools used by the quarantine agent
│   ├── policy_words.txt            # Prohibited keywords for deterministic router checks
│   ├── policy_replacements.txt     # Safe replacement terms used by the cleanup task agent
│   └── platform/                   # Google Cloud service clients and runtime helpers
│       ├── config.py               # Paths, environment variables, locations, and model flags
│       ├── memory.py               # GEAP Memory Bank client and callback interceptors
│       ├── rag.py                  # GEAP RAG Engine corpus management and semantic retrieval
│       ├── videogen.py             # Veo video generation client and operation polling
│       ├── state.py                # Graph session state serialization and file management
│       └── drive.py                # Graph execution helpers for command-line runs
├── stage0_prompt/ … stage6_video/  # Step sandboxes: isolated slices of the pipeline
│   ├── stage0_prompt/agent.py      # Step 3: Single prompt agent with function tools
│   ├── stage1_fanout/agent.py      # Step 4: Parallel research fan-out with JoinNode
│   ├── stage2_direction/agent.py   # Step 4: Agent node with output_schema and RequestInput pause
│   ├── stage3_router/agent.py      # Step 5: Deterministic policy router and task-mode quarantine
│   ├── stage4_memory/agent.py      # Step 6: GEAP Memory Bank integration via callbacks
│   ├── stage5_rag/agent.py         # Step 7: GEAP RAG Engine corpus reader node
│   └── stage6_video/agent.py       # Step 8: LongRunningFunctionTool video render desk
├── starter/                        # The nine student files with their TODO holes; the live copies are not in git
├── server/ & web/                  # VibeStudio Workbench (developer UI on port 4600)
│   ├── server/                     # FastAPI server: code edit API, verifiers, and adk web mount
│   └── web/                        # React + TypeScript frontend: step guides, editor, graph view
├── vibestudio/                     # Completed standalone application (deployed in Step 9)
│   ├── server/                     # FastAPI backend driving the finished agent workflow
│   │   ├── agent/                  # Fully completed agent (isolated copy, works independently)
│   │   └── platform/               # Event bus, avatar generator, publishing client, telemetry
│   ├── web/                        # End-user React production interface
│   ├── run.sh                      # Run production app locally on port 4700
│   └── deploy.py                   # Automated Cloud Run container build and deployment script
├── checks/                         # Verification suite and test registries
│   ├── holes.py                    # Registry of all 17 hands-on student code edits
│   ├── verify_holes.py             # Validates that all holes round-trip and starter/ is in sync
│   ├── verify_pastes.py            # Validates that codelab code snippets match the registry
│   └── verify_app.py               # Validates that vibestudio/ has the complete finished agent
└── scripts/                        # Operational scripts for instructors and students
    ├── setup_project.sh            # One-shot Google Cloud project and billing configuration
    ├── setup_codelab.sh            # Automated dependencies, APIs, .env, and workbench startup
    ├── preflight.py                # Environment and credential diagnostic check
    ├── start.sh / stop.sh          # Foreground workbench server lifecycle management
    ├── restart.sh                  # Background server restart with automated rebuilds
    ├── starter.sh                  # Resets student files from starter/ and clears session state
    ├── rescue.py                   # Instructor helper: solves a specific hole or entire lab
    ├── carve.py                    # Instructor helper: replaces answers with TODO comments
    └── reset.py                    # Clears session database and runtime artifacts between runs
```

### Architecture notes for instructors

- **Independent production app (`vibestudio/`)**: The `vibestudio/` directory contains an isolated, fully worked copy of the finished agent (`vibestudio/server/agent/`). Instructors can demo the complete end-to-end application on port 4700 or Cloud Run at any time, regardless of whether student files in `agent/` have holes filled.
- **Incremental step sandboxes (`stage0_prompt/` to `stage6_video/`)**: Each sandbox folder exposes an independent `root_agent` that isolates the concepts taught in that step. The ADK development UI (`adk web`) automatically discovers each folder as a selectable app in the dropdown.
- **The student hole registry (`checks/holes.py`)**: Every exercise in the workshop is tracked as an explicit entry with its target file, shipped line, and answer. Use `python scripts/rescue.py [HOLE_NAME]` to assist stuck students, or `python scripts/rescue.py` to fill every hole instantly for a rehearsal run.

## The holes

Every hands-on edit in the lab is a *hole*: a line students see (a `TODO`) and the line they write in its place. `checks/holes.py` is the registry of all seventeen, one entry per hole with the file, the shipped line, and the answer. The pages' hints show the same answers.

The scripts around the registry:

| Command | What it does | When |
|---|---|---|
| `scripts/starter.sh` | Copies the nine hands-on files back from `starter/`, wipes local run state and the session store, and verifies. Stop the server first. | Before a class, or after a rehearsal, to reset to what students receive. |
| `python scripts/rescue.py RAG_NODE` | Writes one hole's answer into its file. A section name (`s5`) fills one step; no argument fills every hole. | A student stuck on one edit; or when you want a fully worked tree to rehearse a later step without typing the earlier answers. `carve.py` undoes it. |
| `python scripts/carve.py` | Puts the shipped `TODO` lines back (the inverse of rescue). | After a rescue, to return to the student state. |
| `python scripts/reset.py` | Wipes local run state only: `runs/state.json`, the session store, and worker logs. Keeps the `user:` keys unless `--all`. | Between runs, when the session store is confused. |
| `scripts/restart.sh [--pull]` | Restarts the VibeStudio Workbench in the background, rebuilding the page if its sources changed. | After a `git pull`, or after editing workbench code. |
| `python scripts/preflight.py` | Checks the environment: the SDK, the credentials, and stage app imports. | Setup, and whenever something stops loading. |

Note that the app in `vibestudio/` carries its own complete copy of the agent, so it works whether or not the holes in the lab are filled.

## For authors

Three checks keep the registry, the pages, the codelab, and the app in agreement. Run them after any change to a hole, a stage app, `agent/`, or a code block in `CODELAB.md`:

```bash
python checks/verify_holes.py    # every hole round-trips (carve then fill) and starter/ is in sync
python checks/verify_reload.py   # a save-time reload keeps every schema class and stage app as it was
python checks/verify_pastes.py   # every <!-- code: HOLE --> block in CODELAB.md equals the registry's answer
python checks/verify_app.py      # vibestudio/server/agent/ equals the finished lab agent (--sync to copy)
```

When a hole changes: update `checks/holes.py`, update the codelab block, run `scripts/carve.py`, copy the carved file into `starter/`, run `checks/verify_app.py --sync`, then run all three checks.

The nine files students edit (`agent/graph.py`, `agent/deliver.py`, `stage*/agent.py`) are listed in `.gitignore` and never committed: setup and `scripts/start.sh` copy them from `starter/` when they are missing and leave existing ones alone, so a tree filled in while testing cannot reach a commit. `starter/` is the file that ships.

`scripts/dev.sh` runs the VibeStudio Workbench with hot reload (the API on 4600, Vite on 5173). Diagram sources for the codelab figures live in `img/src/`; the codelab is built with `claat`.
