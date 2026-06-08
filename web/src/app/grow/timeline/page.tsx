"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getTimeline, type TimelineView } from "@/lib/api";
import type { TimelineEvent, TimelineEventType } from "@/lib/grow-profile";
import type { JournalEvent, JournalTone } from "@/lib/journal";
import { useLang } from "@/lib/i18n";

// Tone → palette colour (existing vars only; no invented hex).
const TONE: Record<JournalTone, string> = {
  good: "var(--c-basil)",
  attention: "var(--amber)",
  bad: "var(--c-terra)",
  neutral: "var(--c-stone)",
};

// Forward event-type → label + tint (mirrors the /grow spine).
const TL_TYPE: Record<TimelineEventType, { label: [string, string]; tint: string }> = {
  milestone:    { label: ["Milestone", "אבן דרך"],     tint: "var(--c-mineral)" },
  harvest:      { label: ["Harvest", "קציר"],          tint: "var(--c-basil)" },
  prep:         { label: ["Prep", "הכנה"],             tint: "var(--amber)" },
  prune:        { label: ["Prune", "גיזום"],           tint: "var(--amber)" },
  water_change: { label: ["Water change", "החלפת מים"], tint: "var(--c-mineral)" },
  maintenance:  { label: ["Maintenance", "תחזוקה"],     tint: "var(--c-stone)" },
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export default function TimelinePage() {
  const { t, lang } = useLang();
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    try {
      const v = await getTimeline(d);
      setView(v);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // On-demand: fetch when the tab opens, and again when the grower returns to it
  // (visibility), but NO background polling — a journal doesn't need to tick.
  useEffect(() => {
    load(days);
    const onVis = () => {
      if (document.visibilityState === "visible") load(days);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, days]);

  const dir = lang === "he" ? "rtl" : "ltr";

  const dayLabel = useCallback(
    (iso: string): string => {
      const today = new Date().toISOString().slice(0, 10);
      const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      if (iso === today) return t("Today", "היום");
      if (iso === yest) return t("Yesterday", "אתמול");
      return new Date(`${iso}T12:00:00`).toLocaleDateString(lang === "he" ? "he-IL" : "en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    },
    [lang, t]
  );

  // Forward = the plan ahead (planned / due / trigger-only); done milestones live
  // in the journal below.
  const upcoming = (view?.forward ?? []).filter(
    (e) => e.status === "planned" || e.status === "due"
  );
  const past = view?.past ?? [];

  // Group the journal by day, preserving the newest-first order.
  const groups: { day: string; events: JournalEvent[] }[] = [];
  for (const ev of past) {
    const k = dayKey(ev.ts);
    const g = groups[groups.length - 1];
    if (g && g.day === k) g.events.push(ev);
    else groups.push({ day: k, events: [ev] });
  }

  return (
    <div
      dir={dir}
      style={{ maxWidth: 860, margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: "1.6rem", color: "var(--c-parchment)" }}>
            {t("Grow timeline", "ציר הגידול")}
          </h1>
          <p style={{ fontSize: ".85rem", color: "var(--c-ash)", marginTop: 2 }}>
            {t("What's ahead, and everything that's happened to this grow.", "מה לפנינו, וכל מה שקרה לגידול הזה.")}
          </p>
        </div>
        <Link href="/grow" className="tk-btn-ghost">{t("Back to the grow", "חזרה לגידול")}</Link>
      </header>

      {loading && !view ? (
        <p style={{ color: "var(--c-ash)", fontSize: ".9rem" }}>{t("Loading the timeline…", "טוען את ציר הגידול…")}</p>
      ) : error && !view ? (
        <section className="tk-card" style={{ padding: 22 }}>
          <p style={{ color: "var(--c-fog)", fontSize: ".92rem" }}>
            {t("Can't reach the timeline right now. It'll be back in a moment.", "לא מצליח להגיע לציר הגידול כרגע. זה יחזור עוד רגע.")}
          </p>
        </section>
      ) : (
        <>
          {/* UPCOMING — the plan ahead */}
          <section className="tk-card" style={{ padding: 22 }}>
            <div className="tk-card-h">
              <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
                <i className="ph-light ph-flag-pennant" style={{ color: "var(--amber)", fontSize: "1rem" }} />
                {t("Ahead", "לפנינו")}
              </span>
            </div>
            {upcoming.length === 0 ? (
              <p style={{ fontSize: ".88rem", color: "var(--c-ash)" }}>
                {t("Nothing scheduled yet — TELOS plans the next steps as it learns this grow.", "עדיין לא תוכנן כלום — TELOS מתכנן את הצעדים הבאים ככל שילמד את הגידול.")}
              </p>
            ) : (
              <div>
                {upcoming.map((ev: TimelineEvent) => {
                  const meta = TL_TYPE[ev.type];
                  let when = t("when ready", "כשמוכן");
                  if (ev.scheduled_date) {
                    const d = Math.ceil((new Date(`${ev.scheduled_date}T12:00:00`).getTime() - Date.now()) / 86_400_000);
                    when = d <= 0 ? t("now", "עכשיו") : d === 1 ? t("tomorrow", "מחר") : t(`in ${d} days`, `בעוד ${d} ימים`);
                  }
                  return (
                    <div key={ev.id} className="tk-le">
                      <div className="lt" dir="ltr">{ev.scheduled_date ?? "—"}</div>
                      <div className="lx">
                        <span className="tk-tag" style={{ color: meta.tint, background: `color-mix(in srgb, ${meta.tint} 16%, transparent)`, marginInlineEnd: 6 }}>
                          {t(...meta.label)}
                        </span>
                        <b><bdi>{ev.title || t(...meta.label)}</bdi></b>
                        <span className="by"> · {when}</span>
                        {ev.note ? <div style={{ marginTop: 2, color: "var(--c-fog)" }}><bdi>{ev.note}</bdi></div> : null}
                        {ev.instructions ? <div style={{ marginTop: 4, color: "var(--c-ash)" }}><bdi>{ev.instructions}</bdi></div> : null}
                        {ev.trigger && !ev.scheduled_date ? <div style={{ marginTop: 2, color: "var(--c-stone)", fontStyle: "italic" }}><bdi>{ev.trigger}</bdi></div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* NOW divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: "none", fontSize: ".62rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--c-basil)" }}>
              {t("now", "עכשיו")}
            </span>
            <span style={{ flex: 1, height: 1, background: "color-mix(in srgb, var(--c-basil) 35%, transparent)" }} />
          </div>

          {/* JOURNAL — what already happened, newest first, grouped by day */}
          {past.length === 0 ? (
            <section className="tk-card" style={{ padding: 22 }}>
              <p style={{ fontSize: ".88rem", color: "var(--c-ash)" }}>
                {t("No history yet for this grow.", "עדיין אין היסטוריה לגידול הזה.")}
              </p>
            </section>
          ) : (
            groups.map((group) => (
              <section key={group.day} className="tk-card" style={{ padding: "16px 22px" }}>
                <div style={{ fontSize: ".7rem", letterSpacing: ".06em", color: "var(--c-stone)", marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>
                  {dayLabel(group.day)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {group.events.map((ev) => (
                    <div key={ev.id} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                      {/* tone rail + lane icon */}
                      <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 1 }}>
                        <i className={"ph-light " + ev.icon} style={{ color: TONE[ev.tone], fontSize: "1.05rem" }} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span
                            className="tk-tag"
                            style={{ color: ev.by === "grower" ? "var(--c-parchment)" : "var(--c-stone)", background: "var(--surface-warm)", fontSize: ".58rem" }}
                          >
                            {ev.by === "grower" ? t("You", "אתה") : "TELOS"}
                          </span>
                          <span dir="ltr" style={{ fontSize: ".62rem", color: "var(--c-stone)", fontVariantNumeric: "tabular-nums" }}>
                            {ev.ts.slice(11, 16)}
                          </span>
                        </div>
                        <div style={{ fontSize: ".88rem", color: "var(--c-ash)", lineHeight: 1.5, marginTop: 2 }}>
                          <bdi>{ev.title}</bdi>
                        </div>
                        {ev.detail ? (
                          <div style={{ fontSize: ".8rem", color: "var(--c-stone)", marginTop: 2 }}>
                            <bdi>{ev.detail}</bdi>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

          {/* Honest window note + load-older */}
          <div style={{ textAlign: "center", color: "var(--c-stone)", fontSize: ".78rem", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <span>
              {t(`Showing the last ${view?.windowDays ?? days} days.`, `מציג את ${view?.windowDays ?? days} הימים האחרונים.`)}
            </span>
            {(view?.truncated || (view?.windowDays ?? days) < 365) && days < 365 ? (
              <button
                className="tk-btn-ghost"
                onClick={() => setDays((d) => (d < 90 ? 90 : 365))}
              >
                {t("Load older", "טען ישנים יותר")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
