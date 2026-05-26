/**
 * TELOS Design Tokens — single source of truth, cross-referenceable from
 * code (CSS via globals.css mirrors these values).  Derived from the
 * TELOS Brand Kit v1.0 (May 2026).
 *
 * "A visual language that lives between earth and precision.  Not
 * generic-earthy, not cold-tech.  Warm Neutral as the foundation,
 * Basil as the soul."
 */

/**
 * FOUNDATION — Warm-Neutral dark system.
 * Logic: R=G > B by 2-3 points.  Not warm, not blue, not green —
 * an undertone the eye feels but cannot name.
 */
export const FOUNDATION = {
  void:       "#0c0c0a", // primary background
  soil:       "#181815", // surface 1 — cards
  earth:      "#232320", // surface 2 — raised cards
  bark:       "#333330", // surface 3 — strong dividers, strokes
  stone:      "#606058", // muted text (eyebrows, captions)
  ash:        "#9a9a92", // secondary text
  fog:        "#c6c5be", // tertiary text
  parchment:  "#eeede8", // primary text
} as const;

/**
 * ACCENTS — used sparingly.  Basil is the brand soul (success +
 * primary action).  Terra warns.  Mineral marks data.
 */
export const ACCENT = {
  basil:    "#89a83e", // primary / success
  moss:     "#3e5230", // supporting deep-green
  terra:    "#a8593a", // warning
  mineral:  "#3a4d4a", // data / technical
} as const;

/** Semantic aliases — what the brand kit explicitly maps. */
export const SEMANTIC = {
  primary:  ACCENT.basil,
  success:  ACCENT.basil,
  warning:  ACCENT.terra,
  data:     ACCENT.mineral,
  surface:  FOUNDATION.soil,
  surface2: FOUNDATION.earth,
  bg:       FOUNDATION.void,
  text:     FOUNDATION.parchment,
  textMuted:FOUNDATION.ash,
  textDim:  FOUNDATION.stone,
} as const;

/**
 * Type scale.  Two stacks: English (Cormorant Garamond + Plus Jakarta Sans)
 * and Hebrew (Noto Serif Hebrew + Rubik).  Numbers ALWAYS Cormorant
 * Italic — that's the data look.
 */
export const TYPE = {
  display_en: "'Cormorant Garamond', Georgia, serif",
  body_en:    "'Plus Jakarta Sans', system-ui, sans-serif",
  display_he: "'Noto Serif Hebrew', 'Cormorant Garamond', serif",
  body_he:    "'Rubik', 'Plus Jakarta Sans', system-ui, sans-serif",
  numbers:    "'Cormorant Garamond', Georgia, serif",
  sizes: {
    xs:   "0.58rem", //  9px — labels, eyebrows (UPPERCASE)
    sm:   "0.75rem", // 12px — captions, hints
    base: "0.95rem", // 15px — body
    md:   "1.25rem", // 20px — h3, card titles
    lg:   "1.8rem",  // 29px — h2, data numbers
    xl:   "2.5rem",  // 40px — h1
    "2xl":"4rem",    // 64px — display
  },
  tracking: {
    tight:  "0.02em",
    normal: "0.05em",
    wide:   "0.15em",
    label:  "0.28em",
    logo:   "0.18em",
  },
} as const;

/** 4px grid.  Avoid arbitrary spacing in components. */
export const SPACE = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
} as const;

/**
 * Radii.  Data/metrics get NO radius (they're facts, not pills).
 * Only primary CTAs get the pill.  Everything else lives in sm/md/lg.
 */
export const RADIUS = {
  none: "0px",
  sm:   "4px",
  md:   "8px",
  lg:   "14px",
  pill: "999px",
} as const;

/** Border weights — all 1px, varying alpha against the dark system. */
export const BORDER = {
  subtle: "1px solid rgba(238,237,232,0.07)",
  dim:    "1px solid rgba(238,237,232,0.12)",
  basil:  "1px solid rgba(137,168,62,0.25)",
} as const;

/** Motion.  TELOS animates restrained — fast for utility, slow for meaning. */
export const MOTION = {
  easing: {
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    in:  "cubic-bezier(0.64, 0, 0.78, 0)",
  },
  duration: {
    fast:   150,
    base:   280,
    slow:   600,
    scene:  1400,
  },
} as const;

/**
 * The two tag-lines we use across the product + marketing.  Don't
 * substitute "amazing" / "easy" / "fast" for these — they're load-bearing.
 */
export const TAGLINES = {
  primary:   "Every plant, its fullest self.",
  secondary: "Not optimized. Fulfilled.",
} as const;
