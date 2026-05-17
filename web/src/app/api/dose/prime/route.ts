/**
 * Prime a doser channel — fire a calibration-style dose intended to fill
 * the feed tube, NOT to dose the reservoir.  Logged with the priming
 * sentinel so the brain (and the per-system priming state) knows this
 * channel has been activated and the next "real" dose's EC/pH delta is
 * trustworthy.
 *
 * Defaults to PRIMING_ML_PER_CHANNEL (~8 ml).  Grower can pass `amount_ml`
 * to override if a particular tube is longer / shorter.
 *
 * Auth: CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { doseChannelByPhysical } from "@/lib/devices/jebao";
import { saveAction } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { getDosingConfig, allChannelKeys } from "@/lib/dosing-config";
import { PRIMING_ML_PER_CHANNEL, PRIMING_DONE_SENTINEL } from "@/lib/priming";

export const maxDuration = 30;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

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
  const cfg = await getDosingConfig(systemId);
  const assignment = cfg.assignments[channel];
  if (!assignment) {
    return NextResponse.json(
      {
        error: `channel '${channel}' is not configured on system '${systemId}'`,
        valid_channels: allChannelKeys(cfg),
      },
      { status: 400 }
    );
  }

  // Default to the rig's known dead-volume; allow override with a sane cap.
  const amountMl = Number.isFinite(Number(body.amount_ml))
    ? Number(body.amount_ml)
    : PRIMING_ML_PER_CHANNEL;
  if (amountMl <= 0 || amountMl > 20) {
    return NextResponse.json(
      { error: `amount_ml must be 1..20 (got ${amountMl})` },
      { status: 400 }
    );
  }

  const started = Date.now();
  const reason = `${PRIMING_DONE_SENTINEL} (${amountMl}ml feed-tube prime)`;
  let result;
  try {
    result = await doseChannelByPhysical(assignment.physical, amountMl, reason, channel);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        channel,
        physical_channel: assignment.physical,
        amount_ml: amountMl,
        error: `doseChannel threw: ${msg}`,
        wall_ms: Date.now() - started,
      },
      { status: 200 }
    );
  }

  // Log to dosing_actions so the priming-state helper picks it up.
  try {
    await saveAction(
      {
        channel,
        amount_ml: amountMl,
        reason: result.success ? reason : `FAILED priming: ${result.error}`,
        success: result.success,
        ai_status: "priming",
        ai_analysis: `Feed-tube prime for ${channel} (physical channe${assignment.physical}).`,
      },
      systemId
    );
  } catch (e) {
    console.error("[dose/prime] failed to log action:", e);
  }

  return NextResponse.json({
    ok: result.success,
    channel,
    physical_channel: assignment.physical,
    amount_ml: result.amount_ml,
    runtime_seconds: result.runtime_seconds,
    primed: result.success,
    error: result.error,
    wall_ms: Date.now() - started,
    note: result.success
      ? "Channel marked primed. The NEXT real dose is the first one that should change the reservoir."
      : "Priming run failed — channel still considered unprimed.",
  });
}

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const cfg = await getDosingConfig(systemId);
  return NextResponse.json({
    system_id: systemId,
    default_priming_ml: PRIMING_ML_PER_CHANNEL,
    valid_channels: allChannelKeys(cfg),
    usage: "POST { channel: '<key>', amount_ml?: <default 8> } with Bearer auth",
  });
}
