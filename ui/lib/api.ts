const BASE = (process.env.NEXT_PUBLIC_ORCH_API_BASE || "/api/orch").replace(/\/$/, "");
const STREAM_BASE_ENV = process.env.NEXT_PUBLIC_ORCH_STREAM_BASE;

function streamBase(): string {
  if (STREAM_BASE_ENV) return STREAM_BASE_ENV.replace(/\/$/, "");
  if (typeof window !== "undefined" && BASE.startsWith("/") && window.location.protocol === "http:") {
    const hostname = window.location.hostname === "0.0.0.0" ? "localhost" : window.location.hostname;
    const host = hostname.includes(":") ? `[${hostname}]` : hostname;
    return `${window.location.protocol}//${host}:3001/api`;
  }
  return BASE;
}

export type HealthStatus = "ok" | "error" | "down" | "unreachable" | "unknown";

export interface Chat {
  id: number;
  kind: "incident" | "user";
  title: string;
  incident_id: number | null;
  created_at: number;
  resolved_at?: number | null;
  incident_summary?: string | null;
}

export interface Message {
  id: number;
  chat_id: number;
  role: "user" | "agent" | "system";
  agent: "rick" | "morty" | "darwin" | null;
  content: string;
  ts: number;
}

export interface ToolCall {
  id: number;
  chat_id: number;
  tool: "page_devops" | "restart_server" | "patch_code";
  args: { reason?: string };
  status: "pending_approval" | "approved" | "denied" | "executing" | "executed" | "failed";
  result: any;
  tier: number;
  ts: number;
}

export interface Settings {
  healthUrl: string;
  allowedTier: 0 | 1 | 2;
}

export interface IncidentReport {
  id: number;
  incident_id: number;
  audience: "customer_success" | "developer" | "devops_sre";
  title: string;
  content: string;
  ts: number;
  started_at: number;
  resolved_at: number | null;
  incident_summary: string | null;
  initial_error: string;
  chat_title: string | null;
  chat_id: number | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  getHealth: () => j<{ status: HealthStatus; message: string; ts: number }>(`${BASE}/health-target`),
  getSettings: () => j<Settings>(`${BASE}/settings`),
  setSettings: (s: Partial<Settings>) =>
    j<Settings>(`${BASE}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    }),
  listChats: () => j<Chat[]>(`${BASE}/chats`),
  getChat: (id: number) =>
    j<{ chat: Chat; messages: Message[]; tool_calls: ToolCall[]; active: boolean }>(`${BASE}/chats/${id}`),
  createChat: (title: string) =>
    j<{ id: number }>(`${BASE}/chats`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  postMessage: (chatId: number, content: string) =>
    j<{ ok: true; message: Message }>(`${BASE}/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  approve: (chatId: number, toolCallId: number, approved: boolean) =>
    j<{ ok: true; tool_call?: ToolCall }>(`${BASE}/chats/${chatId}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolCallId, approved }),
  }),
  listLogs: () => j<any[]>(`${BASE}/logs`),
  listReports: () => j<IncidentReport[]>(`${BASE}/reports`),
};

function openStream(url: string, onEvent: (ev: any) => void): () => void {
  let closed = false;
  let connected = false;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  const es = new EventSource(url);
  const markOpen = () => {
    if (closed) return;
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    if (!connected) {
      connected = true;
      onEvent({ type: "stream_open" });
    }
  };
  es.onopen = () => {
    markOpen();
  };
  es.onmessage = (e) => {
    if (closed) return;
    try {
      markOpen();
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  es.onerror = () => {
    if (closed || errorTimer) return;
    errorTimer = setTimeout(() => {
      if (!closed) {
        connected = false;
        onEvent({ type: "stream_error" });
      }
    }, 3000);
  };
  return () => {
    closed = true;
    if (errorTimer) clearTimeout(errorTimer);
    es.onopen = null;
    es.onmessage = null;
    es.onerror = null;
    es.close();
  };
}

export function streamChat(chatId: number, onEvent: (ev: any) => void): () => void {
  return openStream(`${streamBase()}/chats/${chatId}/stream`, onEvent);
}

export function streamGlobal(onEvent: (ev: any) => void): () => void {
  return openStream(`${streamBase()}/stream`, onEvent);
}

export const TOOL_LABELS: Record<string, string> = {
  page_devops: "Page DevOps Team",
  restart_server: "Restart Server",
  patch_code: "Patch Code",
};

export const TIER_LABELS = ["Page only", "Page + Restart", "Page + Restart + Patch"];

export function incidentOutcome(chat: Chat): "active" | "resolved" | "unresolved" | "neutral" {
  if (chat.kind !== "incident") return "neutral";
  if (!chat.resolved_at) return "active";
  return chat.incident_summary?.toLowerCase().includes("could not resolve") ? "unresolved" : "resolved";
}

export function incidentColor(outcome: ReturnType<typeof incidentOutcome>): string {
  if (outcome === "resolved") return "#16a34a";
  if (outcome === "active" || outcome === "unresolved") return "#dc2626";
  return "#71717a";
}
