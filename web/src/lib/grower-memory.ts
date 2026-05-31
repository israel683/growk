/**
 * Grower Memory — the persistent knowledge the grower teaches the Brain over
 * time (the third knowledge layer, NEXTGEN-ARCHITECTURE.md §1). This is the
 * "memory that stores the grower's own knowledge, not just round-trip API
 * calls": free-form facts, corrections, and preferences that accumulate and
 * inform every future cycle.
 *
 * Stored in Neon (systems are there; this is per-grow dynamic state). Injected
 * into the cycle prompt. Per the precedence law (§2): grower-confirmed memory is
 * authoritative over the Brain's general knowledge for THIS grow — but never
 * overrides the safety hard-limits.
 */

export type GrowerMemoryKind = "fact" | "correction" | "preference";

export type GrowerMemoryEntry = {
  id: number;
  ts: Date;
  kind: GrowerMemoryKind;
  /** The thing the grower taught, in their words (Hebrew, grower-facing). */
  text: string;
  /** Where it came from — 'grower' (said it) or 'agent_confirmed' (agent inferred + grower confirmed). */
  source: string;
};

export const GROWER_MEMORY_KINDS: GrowerMemoryKind[] = ["fact", "correction", "preference"];

/**
 * Render the active memory as a prompt section. Returns "" when there's nothing
 * taught yet, so the section is simply omitted (keeps the prompt lean).
 */
export function renderGrowerMemory(entries: GrowerMemoryEntry[] | null | undefined): string {
  if (!entries || entries.length === 0) return "";
  const lines: string[] = [
    "## Grower Memory — what the grower has taught the Brain about this grow",
    "(Authoritative over your general knowledge for THIS grow. NEVER overrides the safety hard-limits. If a new reading contradicts a remembered fact, surface it to the grower rather than silently ignoring either.)",
  ];
  for (const e of entries) {
    lines.push(`  - [${e.kind}] ${e.text}`);
  }
  return lines.join("\n");
}
