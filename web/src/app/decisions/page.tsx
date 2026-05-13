"use client";

import { useEffect, useState } from "react";
import { getDecisions } from "@/lib/api";
import type { DecisionRow, AgentStatus } from "@/lib/types";

const STATUS_LABEL: Record<AgentStatus, string> = {
  healthy: "תקין",
  attention: "לב",
  warning: "אזהרה",
  critical: "קריטי",
  unknown: "לא ידוע",
};

const STATUS_BG: Record<AgentStatus, string> = {
  healthy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  warning: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    function load() {
      getDecisions(50)
        .then((r) => {
          if (!cancelled) {
            setDecisions(r.decisions);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const interval = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <main className="flex-1 grid place-items-center text-zinc-500">טוען...</main>;
  }
  if (error) {
    return (
      <main className="flex-1 grid place-items-center p-8">
        <p className="text-sm text-zinc-500 break-words">{error}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">היסטוריית החלטות</h1>
        <p className="text-sm text-zinc-500">
          {decisions.length} ניתוחים אחרונים. כל שורה ניתנת להרחבה לתצוגת פירוט מלאה.
        </p>
      </header>

      <div className="space-y-2">
        {decisions.map((d) => {
          const isOpen = expanded.has(d.id);
          const status = (d.status as AgentStatus) || "unknown";
          const cacheRatio =
            d.tokens_input + d.cache_creation_tokens + d.cache_read_tokens > 0
              ? d.cache_read_tokens /
                (d.tokens_input + d.cache_creation_tokens + d.cache_read_tokens)
              : 0;
          const concerns = (d.raw_response?.concerns || []) as string[];
          const actions = (d.raw_response?.actions || []) as Array<{
            channel: string;
            amount_ml: number;
            reason: string;
          }>;
          const tasks = (d.raw_response?.human_tasks_to_create || []) as Array<{
            type: string;
            priority: string;
            title: string;
          }>;

          return (
            <article
              key={d.id}
              className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <button
                onClick={() => toggle(d.id)}
                className="w-full text-right p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BG[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    <span className="text-sm text-zinc-500" dir="ltr">
                      #{d.id} · {new Date(d.timestamp).toLocaleString("he-IL")}
                    </span>
                    {actions.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        {actions.length} פעולות
                      </span>
                    )}
                    {tasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                        {tasks.length} משימות
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400" dir="ltr">
                    {d.tokens_input + d.cache_creation_tokens + d.cache_read_tokens} → {d.tokens_output}t
                    {cacheRatio > 0 && ` · cache ${(cacheRatio * 100).toFixed(0)}%`}
                  </span>
                </div>
                {d.message && (
                  <p className="mt-2 text-sm leading-relaxed font-medium">{d.message}</p>
                )}
              </button>

              {isOpen && (
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-4 bg-zinc-50/50 dark:bg-zinc-950/30">
                  {d.analysis && (
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                        Analysis
                      </h3>
                      <p className="text-sm leading-relaxed" dir="ltr">
                        {d.analysis}
                      </p>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                        Actions
                      </h3>
                      <ul className="space-y-1.5">
                        {actions.map((a, i) => (
                          <li key={i} className="text-sm" dir="ltr">
                            <span className="font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs">
                              {a.channel}
                            </span>{" "}
                            <span className="font-semibold">{a.amount_ml} ml</span>
                            <p className="text-xs text-zinc-500 mt-0.5">{a.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {tasks.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                        משימות שנוצרו
                      </h3>
                      <ul className="space-y-1.5">
                        {tasks.map((t, i) => (
                          <li key={i} className="text-sm">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 mr-2">
                              {t.priority}
                            </span>
                            {t.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {concerns.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                        Concerns
                      </h3>
                      <ul className="space-y-1 list-disc pr-4" dir="ltr">
                        {concerns.map((c, i) => (
                          <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-zinc-500" dir="ltr">
                    <div>
                      <span className="block text-[10px] uppercase">Input</span>
                      {d.tokens_input}
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase">Output</span>
                      {d.tokens_output}
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase">Cache write</span>
                      {d.cache_creation_tokens}
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase">Cache read</span>
                      {d.cache_read_tokens}
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}

        {decisions.length === 0 && (
          <p className="text-center py-8 text-sm text-zinc-500">
            עדיין אין החלטות שנשמרו. הרץ את האייג'נט וחזור בעוד דקה.
          </p>
        )}
      </div>
    </main>
  );
}
