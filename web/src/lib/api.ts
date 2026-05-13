import type {
  StateResponse,
  HumanTask,
  DecisionRow,
  WaterReading,
  SystemProfile,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8765";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (API_TOKEN) h["Authorization"] = `Bearer ${API_TOKEN}`;
  return h;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

export async function getState(): Promise<StateResponse> {
  return fetchJson<StateResponse>("/api/state");
}

export async function getReadings(hours = 24, limit = 200) {
  return fetchJson<{ readings: WaterReading[] }>(
    `/api/readings?hours=${hours}&limit=${limit}`
  );
}

export async function getDecisions(limit = 20) {
  return fetchJson<{ decisions: DecisionRow[] }>(`/api/decisions?limit=${limit}`);
}

export async function getTasks(status: "pending" | "done" | "dismissed" | "expired" = "pending") {
  return fetchJson<{ tasks: HumanTask[] }>(`/api/tasks?status=${status}`);
}

export async function completeTask(id: number, response = "") {
  return fetchJson<{ ok: true }>(`/api/tasks/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

export async function dismissTask(id: number, response = "") {
  return fetchJson<{ ok: true }>(`/api/tasks/${id}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

export async function updateSystemProfile(patch: Partial<SystemProfile>) {
  return fetchJson<{ system_profile: SystemProfile }>("/api/system", {
    method: "POST",
    body: JSON.stringify(patch),
  });
}
