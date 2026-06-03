"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
} from "recharts";
import { getReadings } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang } from "@/lib/i18n";
import type { WaterReading } from "@/lib/types";

type MetricKey = "ph" | "ec" | "water_temp" | "orp";

const METRIC_DEFS: Record<
  MetricKey,
  { label: string; unit: string; color: string; band: [number, number] | null; digits: number }
> = {
  // Palette only (globals.css): basil for pH, fog (legible neutral on the dark
  // ground) for EC, amber for water temp. mineral is too dark to read as a line.
  ph: { label: "pH", unit: "", color: "#89a83e", band: [5.5, 6.5], digits: 2 },
  ec: { label: "EC", unit: "μS/cm", color: "#c6c5be", band: [800, 1200], digits: 0 },
  water_temp: { label: "טמפ' מים", unit: "°C", color: "#a8783c", band: [18, 24], digits: 1 },
  orp: { label: "ORP", unit: "mV", color: "#8b5cf6", band: [200, 400], digits: 0 },
};

const METRIC_LABEL: Record<MetricKey, [string, string]> = {
  ph: ["pH", "pH"],
  ec: ["EC", "EC"],
  water_temp: ["Water temp", "טמפ' מים"],
  orp: ["ORP", "ORP"],
};

const HOURS_OPTIONS: { hours: number; label: string }[] = [
  { hours: 1, label: "1ש'" },
  { hours: 6, label: "6ש'" },
  { hours: 24, label: "24ש'" },
  { hours: 24 * 7, label: "7י'" },
];

export function SensorChart() {
  const { t } = useLang();
  const [metric, setMetric] = useState<MetricKey>("ph");
  const [hours, setHours] = useState<number>(24);
  const [readings, setReadings] = useState<WaterReading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getReadings(hours, hours <= 6 ? 600 : 1500)
      .then((r) => {
        if (!cancelled) setReadings(r.readings);
      })
      .catch(() => {
        if (!cancelled) setReadings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const stop = startVisibilityAwarePolling(() => {
      getReadings(hours, hours <= 6 ? 600 : 1500)
        .then((r) => {
          if (!cancelled) setReadings(r.readings);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [hours]);

  const data = useMemo(() => {
    return readings
      .filter((r) => (r as any)[metric] !== null && (r as any)[metric] !== undefined)
      .map((r) => ({
        t: new Date(r.timestamp).getTime(),
        v: (r as any)[metric] as number,
      }));
  }, [readings, metric]);

  const def = METRIC_DEFS[metric];

  return (
    <section
      className="rounded-lg p-4"
      style={{ background: "var(--surface-warm)", border: "1px solid color-mix(in srgb, var(--c-parchment) 7%, transparent)" }}
    >
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold" style={{ color: "var(--c-fog)" }}>{t("Sensor history", "היסטוריית חיישן")}</h2>
        <div className="flex items-center gap-2 flex-wrap" dir="ltr">
          <div className="flex rounded p-0.5" style={{ background: "var(--ground-warm)" }}>
            {(Object.keys(METRIC_DEFS) as MetricKey[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={
                  metric === m
                    ? { background: "color-mix(in srgb, var(--c-basil) 16%, transparent)", color: "var(--c-parchment)" }
                    : { color: "var(--c-ash)" }
                }
              >
                {t(...METRIC_LABEL[m])}
              </button>
            ))}
          </div>
          <div className="flex rounded p-0.5" style={{ background: "var(--ground-warm)" }}>
            {HOURS_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                onClick={() => setHours(opt.hours)}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={
                  hours === opt.hours
                    ? { background: "color-mix(in srgb, var(--c-basil) 16%, transparent)", color: "var(--c-parchment)" }
                    : { color: "var(--c-ash)" }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ width: "100%", height: 280 }} dir="ltr">
        {loading && data.length === 0 ? (
          <div className="h-full grid place-items-center text-sm" style={{ color: "var(--c-stone)" }}>
            {t("Loading…", "טוען…")}
          </div>
        ) : data.length < 2 ? (
          <div className="h-full grid place-items-center text-sm" style={{ color: "var(--c-stone)" }}>
            {t("Not enough data in this time range", "אין מספיק נתונים בטווח הזמן הזה")}
          </div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
              {def.band && (
                <ReferenceArea
                  y1={def.band[0]}
                  y2={def.band[1]}
                  fill={def.color}
                  fillOpacity={0.07}
                  ifOverflow="visible"
                />
              )}
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => formatTimeTick(v, hours)}
                tick={{ fontSize: 11, fill: "#888" }}
                stroke="rgba(120,120,120,0.4)"
              />
              <YAxis
                tickFormatter={(v) => v.toFixed(def.digits)}
                tick={{ fontSize: 11, fill: "#888" }}
                stroke="rgba(120,120,120,0.4)"
                width={50}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} unit={def.unit} digits={def.digits} />}
              />
              <Line
                type="monotone"
                dataKey="v"
                stroke={def.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {def.band && (
        <p className="text-xs mt-2 text-center" style={{ color: "var(--c-stone)" }} dir="ltr">
          {t("Shaded band = target range", "הרצועה המודגשת = טווח היעד")} {def.band[0]}–{def.band[1]} {def.unit}
        </p>
      )}
    </section>
  );
}

function formatTimeTick(t: number, hours: number): string {
  const d = new Date(t);
  if (hours <= 6) {
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }
  if (hours <= 24) {
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("he-IL", { month: "short", day: "numeric" });
}

function ChartTooltip(props: { unit: string; digits: number } & Record<string, unknown>) {
  const { active, payload, unit, digits } = props as {
    active?: boolean;
    payload?: ReadonlyArray<{ payload: { t: number; v: number } }>;
    unit: string;
    digits: number;
  };
  if (!active || !payload || !payload.length) return null;
  const { t, v } = payload[0].payload;
  return (
    <div
      className="rounded px-2 py-1 text-xs"
      style={{ background: "var(--c-soil)", border: "1px solid var(--c-bark)", color: "var(--c-parchment)" }}
      dir="ltr"
    >
      <div style={{ color: "var(--c-stone)" }}>{new Date(t).toLocaleString("he-IL")}</div>
      <div className="font-semibold tabular-nums">
        {v.toFixed(digits)} {unit}
      </div>
    </div>
  );
}
