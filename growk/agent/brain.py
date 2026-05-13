"""
GrowK Brain — The AI Decision Engine

Async Claude integration with:
- Cached system prompt (1h TTL beta) — large stable context, low cost
- Lean per-cycle user prompt
- Structured JSON response parsing
- SafetyController validation on every command
- Human Task Queue creation with dedup against existing pending tasks
- Token + cache usage tracking
"""
import json
import logging
from datetime import datetime
from typing import Optional

import anthropic

from devices.base import WaterReading, DosingCommand, DoserChannel
from agent.prompt_engine import SYSTEM_PROMPT, build_analysis_prompt
from agent.safety import SafetyController
from data.store import TASK_TYPES, TASK_PRIORITIES

logger = logging.getLogger("growk.brain")

CHANNEL_MAP = {
    "nutrient_a": DoserChannel.NUTRIENT_A,
    "nutrient_b": DoserChannel.NUTRIENT_B,
    "ph_up": DoserChannel.PH_UP,
    "ph_down": DoserChannel.PH_DOWN,
    "supplement": DoserChannel.SUPPLEMENT,
}

# Beta header to enable 1-hour cache TTL (default is 5 minutes)
CACHE_TTL_BETA = "extended-cache-ttl-2025-04-11"


class GrowKBrain:
    def __init__(self, api_key: str, model: str, safety: SafetyController):
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model
        self._safety = safety
        self._decision_history: list[dict] = []

    async def analyze_and_decide(
        self,
        current_reading: WaterReading,
        recent_readings: list[WaterReading],
        system_profile: dict,
        recent_actions: list[dict],
        available_channels: list[DoserChannel],
        pending_human_tasks: Optional[list[dict]] = None,
    ) -> dict:
        """
        Run a full AI analysis cycle.

        Returns a dict with:
        - 'commands':         list of approved DosingCommand (post-safety)
        - 'blocked_commands': list of {command, reason} blocked by safety
        - 'human_tasks':      deduped tasks to create (caller persists)
        - 'analysis':         AI's English analysis text
        - 'message':          Hebrew message for the grower
        - 'status':           healthy|attention|warning|critical
        - 'concerns':         list of strings
        - 'next_check_minutes': int
        - 'raw_response':     full parsed JSON from Claude
        - 'tokens_input' / 'tokens_output' / 'cache_creation_tokens' /
          'cache_read_tokens': usage breakdown
        """
        pending_human_tasks = pending_human_tasks or []
        existing_task_types = {t.get("type") for t in pending_human_tasks}

        user_prompt = build_analysis_prompt(
            current_reading=current_reading,
            recent_readings=recent_readings,
            system_profile=system_profile,
            recent_actions=recent_actions,
            available_channels=available_channels,
            pending_human_tasks=pending_human_tasks,
        )

        logger.info("Sending analysis request to Claude...")
        logger.debug(f"User prompt length: {len(user_prompt)} chars")

        try:
            message = await self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral", "ttl": "1h"},
                    }
                ],
                messages=[{"role": "user", "content": user_prompt}],
                extra_headers={"anthropic-beta": CACHE_TTL_BETA},
            )

            response_text = message.content[0].text
            logger.debug(f"Claude response (first 200): {response_text[:200]}")

            ai_decision = _parse_json_response(response_text)

            approved_commands, blocked_commands = self._validate_actions(
                ai_decision.get("actions", []), current_reading
            )

            human_tasks = self._extract_human_tasks(
                ai_decision.get("human_tasks_to_create", []),
                existing_task_types,
            )

            usage = message.usage
            tokens_input = getattr(usage, "input_tokens", 0) or 0
            tokens_output = getattr(usage, "output_tokens", 0) or 0
            cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
            cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

            logger.info(
                f"Tokens — input: {tokens_input}, output: {tokens_output}, "
                f"cache_create: {cache_creation}, cache_read: {cache_read}"
            )

            self._decision_history.append({
                "timestamp": datetime.now().isoformat(),
                "status": ai_decision.get("status", "unknown"),
                "approved_count": len(approved_commands),
                "blocked_count": len(blocked_commands),
                "tasks_count": len(human_tasks),
            })

            return {
                "commands": approved_commands,
                "blocked_commands": blocked_commands,
                "human_tasks": human_tasks,
                "analysis": ai_decision.get("analysis", ""),
                "message": ai_decision.get("message_to_grower", ""),
                "status": ai_decision.get("status", "unknown"),
                "concerns": ai_decision.get("concerns", []),
                "next_check_minutes": ai_decision.get("next_check_minutes", 15),
                "raw_response": ai_decision,
                "tokens_input": tokens_input,
                "tokens_output": tokens_output,
                "cache_creation_tokens": cache_creation,
                "cache_read_tokens": cache_read,
            }

        except anthropic.APIError as e:
            logger.error(f"Claude API error: {e}")
            return self._fallback_response(f"API error: {e}")
        except Exception as e:
            logger.error(f"Brain error: {e}", exc_info=True)
            return self._fallback_response(f"Error: {e}")

    def _validate_actions(
        self, ai_actions: list, current_reading: WaterReading
    ) -> tuple[list[DosingCommand], list[dict]]:
        approved: list[DosingCommand] = []
        blocked: list[dict] = []

        for action in ai_actions:
            channel_name = action.get("channel", "")
            channel = CHANNEL_MAP.get(channel_name)

            if channel is None:
                logger.warning(f"Unknown channel in AI response: {channel_name}")
                blocked.append({
                    "command": f"{channel_name} {action.get('amount_ml')}ml",
                    "reason": f"Unknown channel '{channel_name}'",
                })
                continue

            try:
                amount_ml = float(action.get("amount_ml", 0))
            except (TypeError, ValueError):
                blocked.append({
                    "command": f"{channel_name}",
                    "reason": f"Invalid amount_ml: {action.get('amount_ml')}",
                })
                continue

            command = DosingCommand(
                channel=channel,
                amount_ml=amount_ml,
                reason=action.get("reason", "AI recommended"),
                confidence=0.9,
            )

            is_safe, reason = self._safety.validate_command(command, current_reading)
            if is_safe:
                approved.append(command)
                logger.info(f"APPROVED: {command}")
            else:
                blocked.append({"command": str(command), "reason": reason})
                logger.warning(f"BLOCKED: {command} — {reason}")

        return approved, blocked

    def _extract_human_tasks(
        self, ai_tasks: list, existing_task_types: set[str]
    ) -> list[dict]:
        out = []
        for task in ai_tasks:
            t_type = task.get("type")
            if t_type not in TASK_TYPES:
                logger.warning(f"Unknown human task type: {t_type}")
                continue
            if t_type in existing_task_types:
                logger.info(f"Skipping duplicate {t_type} task — already pending")
                continue

            priority = task.get("priority", "medium")
            if priority not in TASK_PRIORITIES:
                priority = "medium"

            normalized = {
                "type": t_type,
                "priority": priority,
                "title": task.get("title", t_type),
                "reason": task.get("reason", ""),
                "payload": task.get("payload", {}) or {},
                "expires_in_hours": task.get("expires_in_hours"),
            }
            out.append(normalized)
            existing_task_types.add(t_type)  # also dedup within this same response
        return out

    def _fallback_response(self, error: str) -> dict:
        return {
            "commands": [],
            "blocked_commands": [],
            "human_tasks": [],
            "analysis": f"AI unavailable: {error}. Maintaining current state.",
            "message": "המערכת עובדת במצב שמרני — ה-AI לא זמין כרגע",
            "status": "attention",
            "concerns": [error],
            "next_check_minutes": 5,
            "raw_response": None,
            "tokens_input": 0,
            "tokens_output": 0,
            "cache_creation_tokens": 0,
            "cache_read_tokens": 0,
        }

    def get_recent_decisions(self, count: int = 10) -> list[dict]:
        return self._decision_history[-count:]


def _parse_json_response(response_text: str) -> dict:
    """Parse Claude's JSON response, tolerating markdown code fences."""
    text = response_text.strip()
    if text.startswith("```"):
        # Strip ```json\n ... ```
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0] if "```" in text else text
    return json.loads(text)
