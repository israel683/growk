/**
 * Per-system dosing configuration.
 *
 * Each system row owns a `dosing_config` JSONB column whose shape is below.
 * The config maps PHYSICAL channels (1..N on the Jebao doser) to a "role" the
 * system uses them for.  Three role kinds today:
 *
 *   - fertilizer:  ties to a `component_key` from the chosen FertilizerProfile.
 *   - ph_up:       potassium hydroxide / pH+ solution.
 *   - ph_down:     phosphoric acid / pH- solution.
 *
 * Roles can be absent: a system may have pH up but not pH down, or vice versa,
 * or only nutrient channels, etc.  Safety logic branches on what's present.
 *
 * The CHANNEL KEY exposed to the rest of the app (safety, brain, agent tools,
 * dosing logs) is the role identifier — either a fertilizer component_key
 * ("micro", "grow", "bloom", "ad_solution") or the pH role ("ph_up",
 * "ph_down").  This way `dosing_actions.channel` and historical reads still
 * make sense after a system rewires its bottles.
 */
import { DEFAULT_PROFILE_ID, getProfile, type FertilizerProfile } from "./fertilizer-profiles";
import { getSystem } from "./db";

export type ChannelRole = "fertilizer" | "ph_up" | "ph_down";

export type ChannelAssignment =
  | { role: "fertilizer"; component_key: string; physical: number }
  | { role: "ph_up"; physical: number }
  | { role: "ph_down"; physical: number };

export type DosingConfig = {
  /** ID into FERTILIZER_PROFILES — what nutrient line is installed. */
  profile_id: string;
  /**
   * Channel assignments keyed by the role identifier used everywhere else
   * (component_key for nutrients, "ph_up"/"ph_down" for pH).  Each entry
   * carries its physical channel number (1..8 on Jebao MD-4.5 = 1..5).
   */
  assignments: Record<string, ChannelAssignment>;
};

/**
 * Default config for the original POC rig: Terra Aquatica Tri Part on
 * channels 1/2/3 + pH Up on 4. Channel 5 unused.  This mirrors the
 * hardcoded CHANNEL_MAP from before the multi-fertilizer refactor and is
 * applied to the existing 'default' system row on read if it has no
 * persisted dosing_config yet.
 */
export const LEGACY_DEFAULT_CONFIG: DosingConfig = {
  profile_id: DEFAULT_PROFILE_ID,
  assignments: {
    micro: { role: "fertilizer", component_key: "micro", physical: 1 },
    grow:  { role: "fertilizer", component_key: "grow",  physical: 2 },
    bloom: { role: "fertilizer", component_key: "bloom", physical: 3 },
    ph_up: { role: "ph_up", physical: 4 },
  },
};

/**
 * Permissive parser: accepts the JSONB blob from the DB and coerces it to a
 * DosingConfig.  Returns null if the structure is unusable so callers can
 * fall back to LEGACY_DEFAULT_CONFIG.
 */
export function parseDosingConfig(raw: unknown): DosingConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const profileId = typeof obj.profile_id === "string" ? obj.profile_id : null;
  const assignmentsRaw = obj.assignments;
  if (!profileId || !assignmentsRaw || typeof assignmentsRaw !== "object") return null;

  const out: Record<string, ChannelAssignment> = {};
  for (const [key, val] of Object.entries(assignmentsRaw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const physical = Number(v.physical);
    if (!Number.isFinite(physical) || physical < 1 || physical > 8) continue;
    const role = String(v.role || "");
    if (role === "fertilizer") {
      const componentKey = typeof v.component_key === "string" ? v.component_key : key;
      out[key] = { role: "fertilizer", component_key: componentKey, physical };
    } else if (role === "ph_up" || role === "ph_down") {
      out[key] = { role, physical };
    }
  }
  if (Object.keys(out).length === 0) return null;
  return { profile_id: profileId, assignments: out };
}

/**
 * Resolve the active DosingConfig for a system.  Strategy:
 *  1. If `systems.dosing_config` parses cleanly → use it.
 *  2. Else, fall back to LEGACY_DEFAULT_CONFIG (Terra Aquatica Tri Part + pH Up).
 *     This keeps the existing single-system POC working without a migration.
 *
 * The function reads from the `systems` table on every call; callers that
 * dose in a hot loop should cache.
 */
export async function getDosingConfig(systemId: string): Promise<DosingConfig> {
  const sys = await getSystem(systemId);
  if (!sys) return LEGACY_DEFAULT_CONFIG;
  // dosing_config is added by the schema bootstrap as JSONB; getSystem doesn't
  // currently surface it, so we re-query.  Cheap (one row by PK).
  const { sql, ensureSchema } = await import("./db");
  await ensureSchema();
  const rows = (await sql()`
    SELECT dosing_config FROM systems WHERE id = ${systemId}
  `) as unknown as Array<{ dosing_config: unknown }>;
  const parsed = rows[0] ? parseDosingConfig(rows[0].dosing_config) : null;
  return parsed ?? LEGACY_DEFAULT_CONFIG;
}

/** Convenience: just the FertilizerProfile referenced by this system. */
export async function getSystemProfile(systemId: string): Promise<FertilizerProfile> {
  const cfg = await getDosingConfig(systemId);
  return getProfile(cfg.profile_id) ?? getProfile(DEFAULT_PROFILE_ID)!;
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

export function getPhysicalChannel(
  cfg: DosingConfig,
  channelKey: string
): number | null {
  return cfg.assignments[channelKey]?.physical ?? null;
}

export function hasPhUp(cfg: DosingConfig): boolean {
  return Object.values(cfg.assignments).some((a) => a.role === "ph_up");
}

export function hasPhDown(cfg: DosingConfig): boolean {
  return Object.values(cfg.assignments).some((a) => a.role === "ph_down");
}

export function phUpKey(cfg: DosingConfig): string | null {
  for (const [k, a] of Object.entries(cfg.assignments)) {
    if (a.role === "ph_up") return k;
  }
  return null;
}

export function phDownKey(cfg: DosingConfig): string | null {
  for (const [k, a] of Object.entries(cfg.assignments)) {
    if (a.role === "ph_down") return k;
  }
  return null;
}

/** All channel keys that represent a fertilizer component on this rig. */
export function nutrientKeys(cfg: DosingConfig): string[] {
  return Object.entries(cfg.assignments)
    .filter(([, a]) => a.role === "fertilizer")
    .map(([k]) => k);
}

/** All valid channel keys for this rig — what the agent may target. */
export function allChannelKeys(cfg: DosingConfig): string[] {
  return Object.keys(cfg.assignments);
}
