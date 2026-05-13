"use client";

import { useEffect, useState } from "react";
import { getActiveSystem } from "@/lib/system";

type StatusInfo = {
  systemStatus: "active" | "paused" | "archived" | null;
  decisionStatus: "healthy" | "attention" | "warning" | "critical" | "unknown" | null;
  systemName: string | null;
  hasReadings: boolean;
};

const DECISION_STYLE: Record<string, { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "תקין" },
  attention: { dot: "bg-amber-500", label: "לב" },
  warning: { dot: "bg-orange-500", label: "אזהרה" },
  critical: { dot: "bg-red-600", label: "קריטי" },
  unknown: { dot: "bg-zinc-400", label: "—" },
};

export function StatusChip({ onRequestStatus }: { onRequestStatus?: () => void }) {
  const [info, setInfo] = useState<StatusInfo | null>(null);

  async function load() {
    try {
      const sys = getActiveSystem();
      const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
      const r = await fetch(`/api/state${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      setInfo({
        systemStatus: j.system?.status ?? "active",
        decisionStatus: j.last_decision?.status ?? "unknown",
        systemName: j.system?.name ?? null,
        hasReadings: !!j.current_reading,
      });
    } catch {
      setInfo(null);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!info) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-400">
        <span className="inline-block w-2 h-2 rounded-full bg-zinc-300 animate-pulse" />
        טוען
      </span>
    );
  }

  // Maintenance overrides decision status
  if (info.systemStatus === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-medium">
        🛠 בתחזוקה
      </span>
    );
  }

  if (info.systemStatus === "archived") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-500">
        ⚪ ארוכב
      </span>
    );
  }

  // First-visit nudge: no readings yet → invite the grower to kick off a poll
  if (!info.hasReadings && onRequestStatus) {
    return (
      <button
        onClick={onRequestStatus}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors"
      >
        💬 תן לי סטטוס
      </button>
    );
  }

  const ds = info.decisionStatus || "unknown";
  const style = DECISION_STYLE[ds] || DECISION_STYLE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900">
      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      <span className="text-zinc-700 dark:text-zinc-300 font-medium">{style.label}</span>
    </span>
  );
}
