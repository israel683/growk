# GrowK — Intelligent Hydroponics Agent

## What is this project?
GrowK is an LLM-powered hydroponic system controller. It reads water quality sensors, sends the data to Claude API for analysis, and executes dosing commands through peristaltic pumps. The system is designed for a commercial POC to validate product-market fit, with a path to scale to multiple systems.

## Current Stage: POC
Hardware in hand:
- **Sensor**: Tuya PH-W218 8-in-1 (pH, EC, ORP, TDS, CF, SALT, S.G, Temp) — Tuya Cloud API.
- **Doser**: Jebao MD-4.5 (5 peristaltic pump channels, 50 ml/min) — Gizwits Cloud API.
- **Physical setup**: Wall-mounted NFT pipes, outdoor in Tel Aviv, 60L reservoir with float valve.

## Architecture (4 layers + Human Task Queue)
1. **Devices** (`devices/`) — Abstract interfaces. `SensorDevice` and `DoserDevice` are the contracts. Tuya and Jebao are implementations. Mock versions exist for dev.
2. **Safety** (`agent/safety.py`) — Hard limits the AI cannot override. pH bounds, EC bounds, water temp, single-dose, hourly rate, min interval, sensor freshness.
3. **AI Brain** (`agent/brain.py` + `agent/prompt_engine.py`) — Async Claude integration.
   - `AsyncAnthropic` client; non-blocking API calls.
   - Large stable `SYSTEM_PROMPT` (crop knowledge, sensor science, dosing math, safety rationale, decision philosophy, response schema) cached at the API level via `cache_control: ephemeral` with 1-hour TTL (beta header `extended-cache-ttl-2025-04-11`).
   - Lean per-cycle user prompt with current reading, trends, recent actions, pending tasks, time context.
   - Returns a structured JSON: `actions`, `human_tasks_to_create`, `status`, `next_check_minutes`, `concerns`, `message_to_grower` (Hebrew).
4. **Data** (`data/store.py`) — SQLite for the POC. Tables include `system_id` from the start to support multi-system without migration. Schema:
   - `sensor_readings`, `dosing_actions`, `ai_decisions` (with cache token tracking), `human_tasks`.

**Human Task Queue** (`data/store.py: human_tasks` + `agent/brain.py` + `agent/prompt_engine.py`):
The agent operates autonomously, but can create tasks for the human grower when something exceeds its capability:
- `water_change` — physical action.
- `dose_approval` — approval for an out-of-envelope dose.
- `system_reset` — clear rate limits / calibration.
- `question` — clarifying question (crop, stage, recent additions).
- `manual_action` — anything physical the agent cannot perform.

Pending tasks are passed back into Claude's user prompt every cycle to prevent duplicates. The brain dedupes by type before persisting.

## Key Design Principles
- **Device agnostic**: All hardware behind abstract interfaces. Never reference Tuya/Jebao/Gizwits in agent logic.
- **Safety isolated from intelligence**: Every AI command goes through SafetyController before execution. The AI may propose blocked actions; the safety layer is final.
- **Autonomy with full transparency**: The agent acts on routine actions without approval; every action is persisted with reasoning. Human approval is reserved for tasks queued via Human Task Queue.
- **Graceful degradation**: If Claude API is down, system holds current state and surfaces a Hebrew message to the grower.
- **Hebrew UI**: `message_to_grower`, task `title`/`reason` in Hebrew. `analysis`, `concerns`, action `reason` in English (operator-facing).

## Tech Stack
- Python 3.9+ (PEP 585 generics in use)
- `anthropic>=0.40.0` (AsyncAnthropic)
- `tuya-connector-python` for sensor
- `httpx` for Gizwits/Jebao API
- SQLite (POC) → Neon Postgres (cloud, planned phase 5)
- asyncio throughout
- Cloud target (planned): Python agent on Railway/Fly.io, Next.js UI on Vercel.

## Running
```bash
cp .env.example .env   # then fill in the keys
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python main.py --mock --once   # Test with fake data, one cycle
.venv/bin/python main.py --mock          # Continuous with fake data
.venv/bin/python main.py                 # Real hardware
```

## Configuration
All via environment variables in `.env` (see `.env.example`). Key vars:
- `ANTHROPIC_API_KEY` — required for AI cycles.
- `CLAUDE_MODEL` — defaults to `claude-sonnet-4-6`. Override to `claude-opus-4-7` for max reasoning or `claude-haiku-4-5` for cost.
- `TUYA_ACCESS_ID` / `TUYA_ACCESS_SECRET` / `TUYA_SENSOR_DEVICE_ID` / `TUYA_API_ENDPOINT` — Tuya Cloud.
- `JEBAO_USERNAME` / `JEBAO_PASSWORD` / `GIZWITS_APP_ID` — Jebao via Gizwits.
- `SYSTEM_TYPE` / `RESERVOIR_LITERS` / `CROP_TYPE` — crop profile (will be dynamic in v2).
- `SENSOR_POLL_INTERVAL` (sec) / `AI_CYCLE_INTERVAL` (sec) — cadence ceiling. The AI's `next_check_minutes` overrides downward (clamped to 1–60 min).

## What needs work next
1. Calibrate Tuya data point `code` strings against the real PH-W218 (current mappings in `tuya_sensor.py` are educated guesses).
2. Reverse-engineer Jebao Gizwits data points for dose control (current payload in `jebao_doser.py` is best-guess from generic Gizwits patterns).
3. Web dashboard (Next.js on Vercel, planned phase 6).
4. Migration: SQLite → Neon Postgres (phase 5).
5. Environment context: weather API integration (OpenWeatherMap) before adding physical air sensors.
6. Hybrid model strategy: Sonnet for routine, escalate to Opus on `warning|critical` (v2).
7. Push notifications for human tasks (Telegram or web push, phase 6).

## Conventions
- All device communication is async.
- Type hints everywhere (PEP 585 generics — `list[X]`, `dict[X, Y]`).
- Logging via Python `logging` module, namespace `growk.*`.
- Config from environment variables via `.env` (loaded with `override=True`).
- Code/comments in English; UI-facing strings in Hebrew.
- Secrets never in git; `.env` gitignored.
