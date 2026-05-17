/**
 * Fertilizer profile registry.
 *
 * A "fertilizer profile" describes a brand/product line and its components.
 * Each component is one bottle of liquid concentrate that gets wired to a
 * physical doser channel.  The SAME profile can be installed in different
 * systems — what differs per-system is the physical channel→component
 * mapping (see ./dosing-config.ts).
 *
 * Profiles intentionally describe ONLY nutrient components.  pH up / pH down
 * are universal "roles" (not part of any nutrient brand), and are handled in
 * the per-system dosing config as channel roles independent of the profile.
 *
 * To add a new product line: add a new entry to FERTILIZER_PROFILES.  No
 * code changes elsewhere needed — safety, brain and prompt will pick it up
 * via the registry.
 */

export type StageRatio = {
  /** Component key → relative weight in the dose mix at this stage. */
  [componentKey: string]: number;
};

export type FertilizerComponent = {
  /** Stable identifier; used in DB rows + tool args. e.g. "micro", "grow". */
  key: string;
  /** Hebrew label for the UI. */
  label_he: string;
  /** English label (logs / Anthropic prompt). */
  label_en: string;
  /** Optional NPK string like "5-0-1". */
  npk?: string;
  /** Free-form note shown to the agronomist (Hebrew). */
  note_he?: string;
};

export type FertilizerProfile = {
  /** Stable identifier — referenced from systems.dosing_config.profile_id. */
  id: string;
  /** Hebrew display name. */
  name_he: string;
  /** English display name. */
  name_en: string;
  /** Vendor / brand string for context. */
  vendor: string;
  /** Ordered list of components.  Order matters for default channel layout. */
  components: FertilizerComponent[];
  /**
   * Stage-specific dose ratios.  Keys are growth stages
   * (seedling/vegetative/flowering/fruiting); values are component-key → ratio.
   * Used by the prompt engine to give Claude a starting point for the mix.
   * Profiles that don't expose stage-specific ratios can return a single
   * `default` ratio applied to all stages.
   */
  stage_ratios: Record<string, StageRatio>;
  /**
   * ml/L of mixed-nutrient delivered per 50 μS/cm of EC bump on a 60L
   * reservoir.  Approximate — the agent calibrates against real readings.
   */
  ml_per_50us_per_60L?: number;
  /** Optional grower-facing notes about the line as a whole. */
  notes_he?: string;
};

/**
 * Terra Aquatica TriPart — the original POC fertilizer.  Three-bottle line
 * mixed in stage-specific ratios.  No pH solutions included; those are
 * separate per-system channel roles.
 */
export const TERRA_AQUATICA_TRIPART: FertilizerProfile = {
  id: "terra_aquatica_tripart",
  name_he: "Terra Aquatica Tri Part",
  name_en: "Terra Aquatica Tri Part",
  vendor: "Terra Aquatica (GHE)",
  components: [
    { key: "micro", label_he: "מיקרו",  label_en: "Micro", npk: "5-0-1",
      note_he: "מיקרו-אלמנטים + חנקן בסיסי, מוכרח להיות ראשון בערבוב." },
    { key: "grow",  label_he: "גרו",    label_en: "Grow",  npk: "3-1-6",
      note_he: "דחיפת עלווה — דומיננטי בשלבי וגטטיב." },
    { key: "bloom", label_he: "בלום",   label_en: "Bloom", npk: "0-5-4",
      note_he: "תמיכת פריחה ופרי — דומיננטי בשלבי פריחה/פרי." },
  ],
  stage_ratios: {
    seedling:   { micro: 1, grow: 1, bloom: 0.5 },
    vegetative: { micro: 2, grow: 3, bloom: 1   },
    flowering:  { micro: 3, grow: 2, bloom: 2   },
    fruiting:   { micro: 3, grow: 1, bloom: 3   },
  },
  ml_per_50us_per_60L: 2.5,
  notes_he:
    "ערבב תמיד בסדר Micro→Grow→Bloom, אף פעם לא במקביל באותה בקבוקיית ערבוב. " +
    "ה-Micro חייב להתערבב במים לפני שמוסיפים אותו לתמיסה.",
};

/**
 * LivinGreen "ככה מגדלים היום" — single-bottle complete liquid fertilizer
 * (the one the grower calls "AD HaMushlam").  Composition straight off the
 * label:
 *
 *   N total 4%  (N-NO3 3.6% + N-NH4 0.4%)
 *   P2O5    2.5%
 *   K2O     6%
 *   Ca      2%
 *   Mg      0.46%
 *   + chelated iron + micro nutrients
 *   Derived from: potassium nitrate, calcium nitrate, ammonium nitrate,
 *     nitric acid, chelated iron, micro nutrients.
 *
 * Concentrate pH is 2.5–3.5 — every dose nudges reservoir pH slightly
 * downward, so it doubles as a mild pH-down on top of feeding.  Ca + Mg are
 * already in the bottle, so no separate Cal-Mag supplement is needed.
 *
 * Single-component profile → one physical channel carries everything.
 */
export const LIVINGREEN_COMPLETE: FertilizerProfile = {
  id: "livingreen_complete",
  name_he: "LivinGreen — דשן מלא (\"המושלם\")",
  name_en: "LivinGreen Complete Liquid Fertilizer",
  vendor: "LivinGreen",
  components: [
    {
      key: "livingreen",
      label_he: "LivinGreen מושלם",
      label_en: "LivinGreen Complete",
      npk: "4-2.5-6",
      note_he:
        "דשן יחיד-בקבוק שלם: NPK 4-2.5-6 + Ca 2% + Mg 0.46% + מיקרו (ברזל קלאטי). " +
        "תרכיז חומצי (pH 2.5–3.5) — כל מנה מורידה גם pH במאגר. " +
        "מכוון לירקות, צמחי מאכל ופריחה בכל שלבי הגידול. " +
        "אסור לערבב עם דשנים אחרים באותו מיכל.",
    },
  ],
  // Single-component profile → trivial 1.0 ratio across stages. The stage
  // info still matters for DOSE MAGNITUDE (more nutrient at peak demand),
  // not for component proportions — that's handled by the brain via the
  // stage-aware crop context.
  stage_ratios: {
    seedling:   { livingreen: 1 },
    vegetative: { livingreen: 1 },
    flowering:  { livingreen: 1 },
    fruiting:   { livingreen: 1 },
  },
  // Calibration starts conservative.  Empirical bump on 60L hydroponic
  // reservoirs of comparable complete liquid lines: ~2.5–3 ml per +50 μS/cm.
  // The brain refines this from the dose-vs-EC delta log over a few cycles.
  ml_per_50us_per_60L: 2.5,
  notes_he:
    "דשן 'מושלם' של LivinGreen — בקבוק יחיד שמכסה את כל הצרכים (NPK + Ca + Mg + מיקרו). " +
    "מתאים גם ל-NFT וגם למצע מנותק. תרכיז חומצי, אז התכוון לירידה קלה ב-pH בכל מנה.",
};

/**
 * Backward-compat alias: earlier code drafts referred to the LivinGreen line
 * by the grower's informal name "AD HaMushlam".  Keep the alias so any DB
 * row that already persisted `profile_id = "ad_hamushlam"` still resolves.
 */
export const AD_HAMUSHLAM = LIVINGREEN_COMPLETE;

export const FERTILIZER_PROFILES: Record<string, FertilizerProfile> = {
  [TERRA_AQUATICA_TRIPART.id]: TERRA_AQUATICA_TRIPART,
  [LIVINGREEN_COMPLETE.id]: LIVINGREEN_COMPLETE,
};

/** Aliases that resolve to the same profile (informal names, legacy ids). */
const PROFILE_ALIASES: Record<string, string> = {
  ad_hamushlam: LIVINGREEN_COMPLETE.id,
};

export function getProfile(id: string): FertilizerProfile | null {
  const direct = FERTILIZER_PROFILES[id];
  if (direct) return direct;
  const aliased = PROFILE_ALIASES[id];
  return aliased ? FERTILIZER_PROFILES[aliased] ?? null : null;
}

export function listProfiles(): FertilizerProfile[] {
  return Object.values(FERTILIZER_PROFILES);
}

export const DEFAULT_PROFILE_ID = TERRA_AQUATICA_TRIPART.id;
