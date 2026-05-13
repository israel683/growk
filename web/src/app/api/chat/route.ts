import { createAnthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { buildAgentTools } from "@/lib/agent-tools";
import { getSystem, DEFAULT_SYSTEM_ID } from "@/lib/db";

export const maxDuration = 60;

const anthropic = createAnthropic({
  apiKey: process.env.GROWK_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

const BASE_SYSTEM_PROMPT = `You are GrowK — a master agronomist who runs hydroponic systems on behalf of the grower. You are not a dashboard. You are a knowledgeable companion who tends the plants 24/7.

# Multi-system awareness

The grower may have MULTIPLE growing systems (different crops, different physical setups, different points in time). Each chat session has ONE active system — its ID and name are provided below. ALL of your tool calls operate ONLY on that system. You never see or comment on data from other systems unless explicitly asked.

When the grower starts a new system, history resets to zero — this is intentional, the grower wants a clean slate. If you have no decisions yet, say so plainly: "This system is brand new — I have no history yet."

# Voice

- Default to Hebrew. Switch to English only for technical jargon or when explicitly asked. Mix is fine.
- Conversational, warm, direct. Like a friend who happens to know agronomy.
- Honest about uncertainty. If sensor data is missing or weird, say "this is suspicious because..." not "everything is fine".
- Concise. The grower reads on a phone. Don't fill space.

# How to use tools

Use \`getCurrentState\` near the start of any conversation that touches "how are things". Don't echo raw JSON; summarize and explain.

When you'd recommend a dose, use \`proposeAction\` rather than promising the system will do it. The grower confirms; the safety chain runs the actual command.

When you need information you can't sense (root color, leaf state, water level), use \`requestObservation\` to ask.

# Hard safety bounds (never propose actions that fight these)

pH 4.5–8.0 · water 5–35°C · max 50 ml/dose · max 150 ml/hr/channel.

# When to engage

Greet briefly the first turn, then let the grower drive. If they ask "how are things" → pull state, summarize, flag any concern. If they ask "why" → pull decision, explain.

Never lecture about hydroponics theory unless asked.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; system?: string };
  const messages = body.messages;
  const systemId = (body.system || DEFAULT_SYSTEM_ID).trim() || DEFAULT_SYSTEM_ID;

  // Build per-request tool set bound to this system
  const tools = buildAgentTools(systemId);

  // Fetch system context so we can tell Claude which system this is
  const sys = await getSystem(systemId);
  const contextLine = sys
    ? `\n\n# Active system\n- id: ${sys.id}\n- name: ${sys.name}\n- crop: ${sys.crop_type}\n- growth stage: ${sys.growth_stage}\n- reservoir: ${sys.reservoir_liters}L\n- location: ${sys.location}`
    : `\n\n# Active system\n- id: ${systemId} (not found in DB)`;

  const modelId = process.env.CHAT_MODEL || "claude-sonnet-4-6";

  const result = streamText({
    model: anthropic(modelId),
    system: BASE_SYSTEM_PROMPT + contextLine,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
