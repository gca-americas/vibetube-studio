import { useEffect, useRef, useState } from "react";
import type { InspectorStatus, RunEvent, RunSnapshot, Stage0Status, Stage1Status, Stage2Status, Stage3Status, Stage4Status, Stage5Status, Stage6Status, MemoryBank, RagCorpus, DeployStatus } from "./types";

/**
 * The only place the frontend talks to the backend. Everything goes through
 * /api (JSON) or /api/run/events (SSE); the frontend never reads files or
 * calls ADK directly.
 */

/** A GET that fails loudly. A server error answers with a plain-text body, so
 *  reading it as JSON throws inside whatever called it and the page renders
 *  nothing; every caller gets a readable Error instead. */
async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Whether adk web is running the code on disk for an app. */
export type LoadedStatus = {
  app: string;
  status: "current" | "fresh" | "stale" | "error";
  cached: boolean;
  saved_at: number;
  loaded_at: number | null;
  detail: string;
};

export const api = {
  labInspector: () => get<InspectorStatus>("/api/lab/inspector"),
  loaded: (app: string) => get<LoadedStatus>(`/api/lab/loaded/${app}`),
  refreshLoaded: (app: string) => post<LoadedStatus>(`/api/lab/loaded/${app}/refresh`),
  labLoad: (app: string) => get<{ ok: boolean; edges?: number | null; tools?: number; error: string }>(`/api/lab/load/${app}`),
  labStage2Load: () => get<{ ok: boolean; edges?: number; error: string }>("/api/lab/stage2/load"),
  labStage2: () => get<Stage2Status>("/api/lab/stage2"),
  labStage3: () => get<Stage3Status>("/api/lab/stage3"),
  labStage4: () => get<Stage4Status>("/api/lab/stage4"),
  labStage4Load: () => get<{ ok: boolean; edges?: number; error: string }>("/api/lab/stage4/load"),
  bankRun: (cmd: "connect" | "load" | "list" | "reset") => post<{ ok: boolean; detail: string; run?: string }>(`/api/lab/bank/${cmd}`, {}),
  bankStatus: () => get<{ running: boolean; run: string | null; last_exit: { code: number; at: number; run?: string } | null }>("/api/lab/bank/status"),
  labMemory: () => get<MemoryBank>("/api/lab/memory"),
  labStage5: () => get<Stage5Status>("/api/lab/stage5"),
  labStage5Load: () => get<{ ok: boolean; edges?: number; error: string }>("/api/lab/stage5/load"),
  ragRun: (cmd: "connect" | "load" | "list" | "reset" | "query", text?: string) => post<{ ok: boolean; detail: string; run?: string }>(`/api/lab/rag/${cmd}`, text === undefined ? {} : { text }),
  ragStatus: () => get<{ running: boolean; run: string | null; last_exit: { code: number; at: number; run?: string } | null }>("/api/lab/rag/status"),
  labRag: () => get<RagCorpus>("/api/lab/rag"),
  labStage6: () => get<Stage6Status>("/api/lab/stage6"),
  labStage6Load: () => get<{ ok: boolean; edges?: number; error: string }>("/api/lab/stage6/load"),
  videoRun: (cmd: "deliver" | "status") => post<{ ok: boolean; detail: string; run?: string }>(`/api/lab/video/${cmd}`, {}),
  deployRun: () => post<{ ok: boolean; detail: string }>("/api/lab/deploy", {}),
  deployStatus: () => get<DeployStatus>("/api/lab/deploy/status"),
  videoStatus: () => get<{ running: boolean; run: string | null; last_exit: { code: number; at: number; run?: string } | null }>("/api/lab/video/status"),
  labStage3Load: () => get<{ ok: boolean; edges?: number; error: string }>("/api/lab/stage3/load"),
  labStage1: () => get<Stage1Status>("/api/lab/stage1"),
  labStage0: () => get<Stage0Status>("/api/lab/stage0"),
  holes: () => get<Record<string, string>>("/api/lab/holes"),
  version: () => get<{ running: string; head: string; stale: boolean; subject: string }>("/api/lab/version"),
  workerLog: (verb: "bank" | "rag" | "deliver" | "deploy") => get<{ verb: string; lines: string[] }>(`/api/lab/worker/${verb}/log`),
  holesPlan: () => get<{ name: string; page: string; label: string; state: string }[]>("/api/lab/holes/plan"),
  fillHoles: (names: string[]) => post<{ filled: string[] }>("/api/lab/holes/fill", { names }),
  quarantineSkeleton: () => post<{ ok: boolean; state: string; detail?: string }>("/api/lab/quarantine/skeleton"),
  getCode: (path: string) => get<{ content: string; validation?: { valid: boolean; message: string }; symbol?: string; span?: number[] }>(`/api/code?path=${encodeURIComponent(path)}`),
  putCode: (path: string, content: string) => post("/api/code", { path, content }),
};

/**
 * Live run state over Server-Sent Events. The server pushes a full snapshot
 * whenever anything under runs/ changes, plus worker log lines. The browser's
 * EventSource reconnects on its own if the connection drops.
 */
export function useRunEvents(onLog?: (verb: string, line: string) => void) {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    const es = new EventSource("/api/lab/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const evt = JSON.parse(m.data) as RunEvent;
      if (evt.type === "snapshot") setSnapshot(evt.data);
      else if (evt.type === "log") onLogRef.current?.(evt.verb, evt.line);
    };
    return () => es.close();
  }, []);

  return { snapshot, connected };
}
