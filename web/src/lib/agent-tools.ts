/**
 * Tools the chat agent can call. Each tool is a thin wrapper around the
 * Python agent's HTTP API (running on Railway in prod, localhost in dev).
 *
 * Tools are read-mostly. Writes are limited to creating Human Tasks — the
 * actual physical actions still flow through the autonomous safety chain
 * by way of `dose_approval` tasks the grower confirms.
 */
import { tool } from "ai";
import { z } from "zod";

const AGENT_URL = (process.env.AGENT_API_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_API_TOKEN || "";

async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (AGENT_TOKEN) headers["Authorization"] = `Bearer ${AGENT_TOKEN}`;

  const r = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Agent ${path} → ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as T;
}

export const agentTools = {
  getCurrentState: tool({
    description:
      "Get the current sensor reading, last AI decision, system profile, and pending task counts. Call this whenever the grower asks about how things are right now.",
    inputSchema: z.object({}),
    execute: async () => agentFetch("/api/state"),
  }),

  getRecentReadings: tool({
    description:
      "Get raw sensor readings over a recent time window. Use when the grower asks about trends or history.",
    inputSchema: z.object({
      hours: z.number().min(1).max(168).default(24),
      limit: z.number().min(10).max(500).default(200),
    }),
    execute: async ({ hours, limit }) =>
      agentFetch(`/api/readings?hours=${hours}&limit=${limit}`),
  }),

  getRecentDecisions: tool({
    description:
      "Get the recent autonomous AI decisions log. Use when the grower asks 'why did you do X' or wants to review recent reasoning.",
    inputSchema: z.object({
      limit: z.number().min(1).max(50).default(10),
    }),
    execute: async ({ limit }) => agentFetch(`/api/decisions?limit=${limit}`),
  }),

  getPendingTasks: tool({
    description:
      "Get the list of currently pending Human Tasks (things the system has asked the grower to do).",
    inputSchema: z.object({}),
    execute: async () => agentFetch("/api/tasks?status=pending"),
  }),

  proposeAction: tool({
    description:
      "Propose a dosing action to the grower. This does NOT execute the dose. It creates a 'dose_approval' Human Task that the grower must confirm. Use when, based on the data, you'd recommend dosing but want explicit human approval first.",
    inputSchema: z.object({
      channel: z.enum([
        "nutrient_a",
        "nutrient_b",
        "ph_up",
        "ph_down",
        "supplement",
      ]),
      amount_ml: z.number().min(0.1).max(50),
      reason_he: z.string().describe("Hebrew explanation for the grower"),
      reason_en: z.string().describe("English technical reason"),
    }),
    execute: async (params) => {
      // We post a synthetic 'dose_approval' task via the agent's task creation
      // path. The agent has no public 'create task' endpoint yet, so we fake
      // one by piggybacking on the Python store with a direct DB insert via a
      // future endpoint. For now: just return the proposal as a structured
      // result; the grower can act on it from the UI.
      return {
        kind: "proposal",
        channel: params.channel,
        amount_ml: params.amount_ml,
        reason_he: params.reason_he,
        reason_en: params.reason_en,
        note: "Proposal — no task created yet (write-tool wiring is next iteration). Display this to the grower for review.",
      };
    },
  }),

  requestObservation: tool({
    description:
      "Ask the grower to perform a physical observation: take a photo, inspect roots, check water level, etc. Use this whenever you want information you can't sense directly.",
    inputSchema: z.object({
      observation_type: z.enum([
        "photo",
        "root_inspection",
        "water_level",
        "general",
      ]),
      title_he: z.string().describe("Short Hebrew title"),
      reason_he: z.string().describe("Hebrew explanation of what and why"),
    }),
    execute: async (params) => {
      // Same caveat as proposeAction — we'd want a dedicated endpoint for
      // this. For now return structured payload and let the chat render it.
      return {
        kind: "observation_request",
        ...params,
        note: "Observation request — render as a card in chat with a 'Mark done' button.",
      };
    },
  }),
};

export type AgentToolset = typeof agentTools;
