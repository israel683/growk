/**
 * Manual calibration test endpoint — fire a small dose on a specific channel
 * outside the normal autonomous cycle. Used during physical setup / pump
 * verification (e.g. "does channe1 actually rotate?").
 *
 * Protected by CRON_SECRET to prevent abuse. Hard-capped at 2ml so even if
 * someone accidentally hits it in production, the worst case is a tiny
 * over-dose. Logged to dosing_actions with reason "manual calibration test"
 * so it shows up in /decisions for traceability.
 */
import { NextResponse } from "next/server";
import { doseChannel, CHANNEL_MAP } from "@/lib/devices/jebao";
import { saveAction } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 30;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

// Raised to 20ml so priming/calibration runs (typical tube prime is ~8ml +
// a few ml to see drip at the end of the tube) can complete in one shot.
// Hardware safety: still well under SafetyController's 50ml/single-dose limit.
const MAX_TEST_ML = 20;

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const systemId = systemIdFromRequest(req);

  let body: { channel?: string; amount_ml?: number };
  try {
    body = (await req.json()) as { channel?: string; amount_ml?: number };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const channel = String(body.channel || "").trim() as keyof typeof CHANNEL_MAP;
  const amountMl = Number(body.amount_ml);

  if (!(channel in CHANNEL_MAP)) {
    return NextResponse.json(
      {
        error: `unknown channel '${channel}'`,
        valid: Object.keys(CHANNEL_MAP),
      },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amountMl) || amountMl <= 0) {
    return NextResponse.json({ error: `invalid amount_ml: ${body.amount_ml}` }, { status: 400 });
  }
  if (amountMl > MAX_TEST_ML) {
    return NextResponse.json(
      { error: `amount_ml capped at ${MAX_TEST_ML}ml for test endpoint` },
      { status: 400 }
    );
  }

  const started = Date.now();
  let result;
  try {
    result = await doseChannel(channel, amountMl, "manual calibration test");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dose/test] doseChannel threw:", msg);
    return NextResponse.json(
      {
        ok: false,
        channel,
        physical_channel: CHANNEL_MAP[channel],
        amount_ml: amountMl,
        error: `doseChannel threw: ${msg}`,
        wall_ms: Date.now() - started,
      },
      { status: 200 }
    );
  }

  // Log to dosing_actions so /decisions shows the calibration run alongside
  // real AI-driven doses. system_id from the request (?system= or default).
  try {
    await saveAction(
      {
        channel,
        amount_ml: amountMl,
        reason: result.success ? "manual calibration test" : `FAILED: ${result.error}`,
        success: result.success,
        ai_status: "manual",
        ai_analysis: "Manual pump verification via /api/dose/test",
      },
      systemId
    );
  } catch (e) {
    console.error("[dose/test] failed to log action:", e);
  }

  return NextResponse.json({
    ok: result.success,
    channel: result.channel,
    physical_channel: CHANNEL_MAP[channel],
    amount_ml: result.amount_ml,
    runtime_seconds: result.runtime_seconds,
    error: result.error,
    wall_ms: Date.now() - started,
  });
}

export async function GET() {
  return NextResponse.json({
    channels: Object.entries(CHANNEL_MAP).map(([key, n]) => ({
      key,
      physical_channe: n,
    })),
    max_ml: MAX_TEST_ML,
    usage: "POST { channel: '<key>', amount_ml: <0..2> } with Bearer auth",
  });
}
