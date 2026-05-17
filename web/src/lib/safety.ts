/**
 * GrowK Safety Controller — the LAST LINE OF DEFENSE before any dose reaches
 * hardware. These limits are NOT negotiable by the AI.
 *
 * The controller is now per-system: it consults the system's DosingConfig
 * (see lib/dosing-config.ts) to know which channels exist, and which roles
 * (ph_up / ph_down / fertilizer) they fill.  pH-out-of-bounds responses
 * branch on what's available:
 *
 *   - pH < min and ph_up exists      → allow only the ph_up channel
 *   - pH < min and no ph_up          → block all dosing (manual fix required)
 *   - pH > max and ph_down exists    → allow only the ph_down channel
 *   - pH > max and no ph_down        → block all dosing (manual fix required)
 *
 * EC overruns block "fertilizer" role channels regardless of brand.
 */
import { getRecentActions, DEFAULT_SYSTEM_ID } from "./db";
import type { WaterReading } from "./db";
import {
  getDosingConfig,
  type DosingConfig,
  hasPhUp,
  hasPhDown,
  phUpKey,
  phDownKey,
} from "./dosing-config";

export const SAFETY_LIMITS = {
  // pH absolute bounds — outside this range, only the corrective channel allowed
  ph_min: 4.5,
  ph_max: 8.0,
  // pH target range — normal operating range (informational; not enforced)
  ph_target_min: 5.5,
  ph_target_max: 6.5,
  // EC bounds (μS/cm)
  ec_min: 100,
  ec_max: 3500,
  // Water temperature bounds (°C)
  water_temp_min: 5.0,
  water_temp_max: 35.0,
  // Per-dose limits
  max_single_dose_ml: 50.0,
  max_hourly_dose_ml_per_channel: 150.0,
  min_dose_interval_seconds: 120,
  // If no sensor reading for this long, block all dosing (seconds)
  max_sensor_age_seconds: 300,
} as const;

/**
 * `DoserChannel` is now a free string — the universe of valid keys depends
 * on the active system's DosingConfig.  Validation happens in
 * `validateCommand` against the resolved config.
 */
export type DoserChannel = string;

export type DosingCommand = {
  channel: DoserChannel;
  amount_ml: number;
  reason: string;
  confidence?: number;
};

export type SafetyValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a single dose command against current reading + recent dosing
 * history. Returns ok:true to allow, or ok:false with a reason to block.
 *
 * If `dosingConfig` is not provided, it's looked up for `systemId`.  Callers
 * that already hold a config (the brain) should pass it to avoid an extra
 * DB round-trip per validation.
 */
export async function validateCommand(
  command: DosingCommand,
  currentReading: WaterReading | null,
  opts: {
    systemId?: string;
    dosingConfig?: DosingConfig;
  } = {}
): Promise<SafetyValidation> {
  const systemId = opts.systemId ?? DEFAULT_SYSTEM_ID;
  const cfg = opts.dosingConfig ?? (await getDosingConfig(systemId));

  // 0. Channel must exist on this rig.
  if (!cfg.assignments[command.channel]) {
    return {
      ok: false,
      reason:
        `Unknown channel '${command.channel}' on this system. ` +
        `Configured: ${Object.keys(cfg.assignments).join(", ") || "(none)"}.`,
    };
  }
  const assignment = cfg.assignments[command.channel];
  const isFertilizer = assignment.role === "fertilizer";
  const isPhUp = assignment.role === "ph_up";
  const isPhDown = assignment.role === "ph_down";

  // 1. Sensor freshness
  if (currentReading === null) {
    return { ok: false, reason: "No sensor reading available — refusing to dose blind" };
  }
  const age = (Date.now() - currentReading.ts.getTime()) / 1000;
  if (age > SAFETY_LIMITS.max_sensor_age_seconds) {
    return {
      ok: false,
      reason: `Sensor reading is ${age.toFixed(0)}s old (max ${SAFETY_LIMITS.max_sensor_age_seconds}s)`,
    };
  }

  // 2. pH absolute bounds — branch on which corrective channels exist.
  if (currentReading.ph !== null) {
    if (currentReading.ph < SAFETY_LIMITS.ph_min) {
      if (!hasPhUp(cfg)) {
        return {
          ok: false,
          reason:
            `pH=${currentReading.ph.toFixed(2)} is critically low — no pH Up channel on this rig; ` +
            `manual intervention required`,
        };
      }
      if (!isPhUp) {
        const k = phUpKey(cfg);
        return {
          ok: false,
          reason: `pH=${currentReading.ph.toFixed(2)} is critically low — only ${k ?? "pH Up"} channel allowed`,
        };
      }
    }
    if (currentReading.ph > SAFETY_LIMITS.ph_max) {
      if (!hasPhDown(cfg)) {
        return {
          ok: false,
          reason:
            `pH=${currentReading.ph.toFixed(2)} is critically high — no pH Down channel on this rig; ` +
            `manual intervention required`,
        };
      }
      if (!isPhDown) {
        const k = phDownKey(cfg);
        return {
          ok: false,
          reason: `pH=${currentReading.ph.toFixed(2)} is critically high — only ${k ?? "pH Down"} channel allowed`,
        };
      }
    }
  }

  // 3. EC bounds — block fertilizer-role doses when EC exceeds max.
  // pH channels are allowed even at high EC (they correct pH, not feed).
  if (
    currentReading.ec !== null &&
    currentReading.ec > SAFETY_LIMITS.ec_max &&
    isFertilizer
  ) {
    return {
      ok: false,
      reason: `EC=${currentReading.ec.toFixed(0)} exceeds max — blocking nutrient dose`,
    };
  }

  // 4. Water temperature
  if (currentReading.water_temp !== null) {
    if (currentReading.water_temp > SAFETY_LIMITS.water_temp_max) {
      return {
        ok: false,
        reason: `Water temp=${currentReading.water_temp.toFixed(1)}°C too high — blocking all dosing`,
      };
    }
    if (currentReading.water_temp < SAFETY_LIMITS.water_temp_min) {
      return {
        ok: false,
        reason: `Water temp=${currentReading.water_temp.toFixed(1)}°C too low — blocking all dosing`,
      };
    }
  }

  // 5. Single-dose limit
  if (command.amount_ml > SAFETY_LIMITS.max_single_dose_ml) {
    return {
      ok: false,
      reason: `Dose ${command.amount_ml}ml exceeds max single dose (${SAFETY_LIMITS.max_single_dose_ml}ml)`,
    };
  }

  // 6. Zero/negative
  if (command.amount_ml <= 0) {
    return { ok: false, reason: `Invalid dose amount: ${command.amount_ml}ml` };
  }

  // 7+8. Rate limits — fetch recent successful doses from DB
  const recent = await getRecentActions(2, systemId); // last 2 hours covers hourly + interval
  const sameChannel = recent.filter(
    (a) => a.channel === command.channel && a.success
  );

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const hourlyTotal = sameChannel
    .filter((a) => a.ts.getTime() > oneHourAgo)
    .reduce((sum, a) => sum + a.amount_ml, 0);

  if (hourlyTotal + command.amount_ml > SAFETY_LIMITS.max_hourly_dose_ml_per_channel) {
    return {
      ok: false,
      reason:
        `Hourly limit: already dosed ${hourlyTotal.toFixed(1)}ml on ${command.channel} ` +
        `(max ${SAFETY_LIMITS.max_hourly_dose_ml_per_channel}ml/hr)`,
    };
  }

  // Min interval
  if (sameChannel.length > 0) {
    const lastDose = sameChannel.reduce((latest, a) =>
      a.ts.getTime() > latest.ts.getTime() ? a : latest
    );
    const elapsed = (Date.now() - lastDose.ts.getTime()) / 1000;
    if (elapsed < SAFETY_LIMITS.min_dose_interval_seconds) {
      return {
        ok: false,
        reason:
          `Too soon: last dose on ${command.channel} was ${elapsed.toFixed(0)}s ago ` +
          `(min ${SAFETY_LIMITS.min_dose_interval_seconds}s)`,
      };
    }
  }

  return { ok: true };
}
