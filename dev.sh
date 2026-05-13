#!/usr/bin/env bash
# GrowK dev launcher — runs the Python agent + the Next.js dashboard together.
#
# Usage:
#   ./dev.sh          # run with real hardware (Tuya + Jebao)
#   ./dev.sh --mock   # run with mock devices
#
# Press Ctrl+C to stop both. Logs in /tmp/growk_*.log.

set -e
cd "$(dirname "$0")"

MOCK_FLAG=""
if [[ "${1:-}" == "--mock" ]]; then
  MOCK_FLAG="--mock"
fi

echo "▶ Starting agent (mode: ${MOCK_FLAG:-LIVE})..."
(cd growk && .venv/bin/python main.py $MOCK_FLAG > /tmp/growk_agent.log 2>&1) &
AGENT_PID=$!
echo "  agent PID=$AGENT_PID  log: /tmp/growk_agent.log"

echo "▶ Starting dashboard..."
(cd web && npm run dev > /tmp/growk_web.log 2>&1) &
WEB_PID=$!
echo "  web PID=$WEB_PID  log: /tmp/growk_web.log"

cleanup() {
  echo ""
  echo "▶ Stopping..."
  kill $AGENT_PID $WEB_PID 2>/dev/null || true
  wait 2>/dev/null || true
  echo "  done."
}
trap cleanup EXIT INT TERM

sleep 3
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dashboard:   http://localhost:3000"
echo "  Agent API:   http://localhost:8765/api/health"
echo "  Logs:        tail -f /tmp/growk_agent.log /tmp/growk_web.log"
echo "  Stop:        Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

wait
