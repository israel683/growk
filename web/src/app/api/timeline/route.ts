import { NextResponse } from "next/server";
import { ensureSchema, getSystem, getRecentEpisodes, getTasksByStatus } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { deriveTimeline } from "@/lib/grow-profile";
import { buildJournal, episodeToJournalEvent } from "@/lib/journal";

export const maxDuration = 15;

/**
 * The Grow Timeline as the dedicated /grow/timeline tab sees it:
 *   - `forward`  — the Brain-owned plan (grow_profile.timeline) or, until it
 *                  exists, the same derived view /grow shows. Identical source,
 *                  never re-derived elsewhere.
 *   - `past`     — the grower-safe JOURNAL (episodes + grower/manual tasks),
 *                  built through the journal allowlist mapper (NO confidential
 *                  decision/token/payload fields ever reach the client).
 * Bounded to a `days` window (default 30); `truncated` is honest when capped.
 */
export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : 30;
  const windowStart = new Date(Date.now() - days * 86_400_000);

  try {
    // Once up-front so the parallel reads below don't each race the DDL bootstrap.
    await ensureSchema();
    const sys = await getSystem(systemId);
    if (!sys) {
      return NextResponse.json({ error: `system "${systemId}" not found` }, { status: 404 });
    }

    // Lean snapshot for the dashboard: just the next planned event + the last
    // thing that happened. Avoids the full journal fetch (one tiny episode read).
    if (url.searchParams.get("snapshot")) {
      const profile = sys.grow_profile ?? null;
      const forward =
        profile?.timeline && profile.timeline.length ? profile.timeline : deriveTimeline(profile);
      const next =
        forward.find((e) => e.status === "planned" || e.status === "due") ?? null;
      const recent = await getRecentEpisodes(systemId, 1);
      const last = recent[0] ? episodeToJournalEvent(recent[0]) : null;
      return NextResponse.json({ next, last });
    }

    const [episodes, doneTasks, dismissedTasks, expiredTasks] = await Promise.all([
      getRecentEpisodes(systemId, 80),
      getTasksByStatus("done", systemId, { since: windowStart, limit: 80 }),
      getTasksByStatus("dismissed", systemId, { since: windowStart, limit: 40 }),
      getTasksByStatus("expired", systemId, { since: windowStart, limit: 40 }),
    ]);

    const profile = sys.grow_profile ?? null;
    const forward =
      profile?.timeline && profile.timeline.length ? profile.timeline : deriveTimeline(profile);
    const { events: past, truncated } = buildJournal(
      episodes,
      [...doneTasks, ...dismissedTasks, ...expiredTasks],
      windowStart,
      60
    );

    return NextResponse.json({ forward, past, windowDays: days, truncated });
  } catch (e) {
    console.error("[/api/timeline] failed:", e);
    return NextResponse.json({ error: "timeline unavailable" }, { status: 500 });
  }
}
