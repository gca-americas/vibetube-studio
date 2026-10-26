/**
 * Wire types shared with the backend. The Python side of this contract is
 * server/schemas.py; keep the two in sync by hand (there is no codegen).
 */

export type StageStatus =
  | "idle"
  | "now"
  | "pass"
  | "fail"
  | "retry"
  | "degraded"
  | "blocked"
  | "skip"
  | "stall"
  | "wait";

export interface WorkerExit {
  verb: string;
  code: number;
  at: number;
}

export interface RunSnapshot {
  /** Verb of a worker currently running, or null. */
  busy: string | null;
  last_exit: WorkerExit | null;
  updated_at: number;
}

export type RunEvent =
  | { type: "snapshot"; data: RunSnapshot }
  | { type: "log"; verb: string; line: string; at: number }
  | { type: "worker"; event: "started" | "exited"; verb: string; code?: number; at: number };

export interface InspectorStatus {
  up: boolean;
  url: string;
  apps: string[];
}

/** Evidence for step 3, read from the stage0_prompt sessions in the store. */
export interface Stage0Status {
  tools_wired: string[];
  tools_complete: boolean;
  sessions: number;
  latest_session_id: string | null;
  tool_calls: Record<string, number>;
  called_trends: boolean;
  called_backlog: boolean;
  turns: number;
  last_reply: string;
}

/** Evidence for step 4b, from stage1_fanout/agent.py and its sessions. */
export interface Stage1Status {
  edges: string[][];
  edges_complete: boolean;
  join_defined: boolean;
  sessions: number;
  runs: number;
  nodes_ran: string[];
  readers_ran: boolean;
  joined: boolean;
  backlog_count: number | null;
  bundle: string;
}

/** Evidence for steps 4c and 4d, from stage2_direction/agent.py and its sessions. */
export interface Stage2Status {
  edges: string[][];
  chain: string[];
  proposer_defined: boolean;
  proposer_wired: boolean;
  gate_wired: boolean;
  persist_wired: boolean;
  gate_has_request_input: boolean;
  gate_payload_ok: boolean;
  proposer_mode: string;
  sessions: number;
  nodes_ran: string[];
  asked: number;
  answered: number;
  candidates: string[];
  proposed_titles: string[];
  direction: string | null;
  user_prefs: Record<string, unknown> | null;
  state_keys: string[];
}

/** Evidence for steps 5a and 5b, from stage3_router/agent.py and its sessions. */
export interface Stage3Status {
  edges: string[][];
  chain: string[];
  router_wired: boolean;
  routes_wired: boolean;
  reroute_wired: boolean;
  scripter_defined: boolean;
  persist_wired: boolean;
  state_write_wired: boolean;
  policy_route_wired: boolean;
  quarantine_kind: string | null;
  sessions: number;
  nodes_ran: string[];
  routes: string[];
  ok_runs: number;
  block_runs: number;
  tool_calls: Record<string, number>;
  cleaned: { title: string; angle: string; hook: string } | null;
  cleaned_script_title: string;
  blocked_message: string;
  script_title: string;
  direction: string | null;
  angle: string | null;
  hook: string | null;
  user_prefs: { last_direction?: string } | null;
  state_keys: string[];
}

/** Evidence for step 6: the two memory callbacks in stage4_memory/agent.py, the bank, and the latest run. */
export interface Stage4Status {
  bank_connected: boolean;
  recall_wired: boolean;
  remember_wired: boolean;
  recall_kw: string | null;
  remember_kw: string | null;
  sessions: number;
  nodes_ran: string[];
  proposed_titles: string[];
  memory_facts: { id: string; topic: string; fact: string; updated: string }[];
  memory_written: { action: string; id?: string; fact?: string }[];
  direction: string | null;
}

export interface MemoryBank {
  connected: boolean;
  engine: string | null;
  memories: { id: string; topic: string; fact: string; updated: string }[];
  error?: string;
}

export interface Stage5Status {
  corpus_blocked?: string;
  corpus_connected: boolean;
  feedback_wired: boolean;
  edges: string[][];
  sessions: number;
  nodes_ran: string[];
  feedback_ran: boolean;
  feedback_query: string | null;
  feedback_passages: string[];
  feedback_note: string | null;
  proposed: { title: string; angle: string; sources: string[] }[];
  cited_feedback: boolean;
}

export interface RagCorpus {
  blocked?: string;
  connected: boolean;
  corpus: string | null;
  files: { id: string; display_name: string; description: string }[];
  comments: number;
  error?: string;
}

export interface Stage6Status {
  tool: string | null;
  tool_wrapped: boolean;
  deliver_wired: boolean;
  chain_wired: boolean;
  sessions: number;
  session: { id: string; user: string } | null;
  nodes_ran: string[];
  desk_ran: boolean;
  submitted: { call_id: string; prompt: string; operation: string } | null;
  pending: { call_id: string; prompt: string; operation: string } | null;
  delivered: boolean;
  render_url: string;
  render_status: string;
  store_video_ran: boolean;
  render_file: { status?: string; url?: string; path?: string; prebaked?: boolean; operation?: string; prompt?: string; reason?: string };
  real_video: boolean;
}

export interface DeployStatus {
  running: boolean;
  last_exit: { code: number; at: number } | null;
  url: string;
  service: string;
  project: string;
  region: string;
  at: number | null;
  gcloud_project: string;
  app_built: boolean;
}
