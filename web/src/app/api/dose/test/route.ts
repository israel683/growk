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
import { doseChannelByPhysical } from "@/lib/devices/jebao";
import { saveAction } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { getDosingConfig, allChannelKeys } from "@/lib/dosing-config";

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

  const channel = String(body.channel || "").trim();
  const amountMl = Number(body.amount_ml);

  // Resolve channel against the active system's DosingConfig.  Supports both
  // logical keys ("micro" / "ph_up" / "ad_solution") and a raw physical
  // override via `physical_channel` in the body for hardware-level testing.
  const cfg = await getDosingConfig(systemId);
  const bodyPhysical = Number((body as { physical_channel?: unknown }).physical_channel);
  let physical: number | null = null;
  let resolvedKey: string = channel;

  if (Number.isInteger(bodyPhysical) && bodyPhysical >= 1 && bodyPhysical <= 8) {
    physical = bodyPhysical;
    resolvedKey = channel || `channe${bodyPhysical}`;
  } else if (channel && cfg.assignments[channel]) {
    physical = cfg.assignments[channel].physical;
  } else {
    return NextResponse.json(
      {
        error: `unknown channel '${channel}' for system '${systemId}'`,
        valid_channels: allChannelKeys(cfg),
        hint: "Pass a logical channel key from the system's dosing_config, or use `physical_channel: 1..5` for raw hardware testing.",
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
    result = await doseChannelByPhysical(physical, amountMl, "manual calibration test", resolvedKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dose/test] doseChannelByPhysical threw:", msg);
    return NextResponse.json(
      {
        ok: false,
        channel: resolvedKey,
        physical_channel: physical,
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
        channel: resolvedKey,
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
    physical_channel: result.physical_channel,
    amount_ml: result.amount_ml,
    runtime_seconds: result.runtime_seconds,
    error: result.error,
    wall_ms: Date.now() - started,
  });
}

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const cfg = await getDosingConfig(systemId);
  return NextResponse.json({
    system_id: systemId,
    profile_id: cfg.profile_id,
    channels: Object.entries(cfg.assignments).map(([key, a]) => ({
      key,
      role: a.role,
      physical_channe: a.physical,
      ...(a.role === "fertilizer" ? { component_key: a.component_key } : {}),
    })),
    max_ml: MAX_TEST_ML,
    usage:
      "POST { channel: '<key>', amount_ml: <0..20> } with Bearer auth. " +
      "For raw hardware testing on an unconfigured rig: POST { physical_channel: 1..5, amount_ml: <n> }.",
  });
}
