"use client";

import { useEffect, useState } from "react";
import { listSystems, createSystem, type SystemSummary } from "@/lib/api";
import { getActiveSystem, setActiveSystem, DEFAULT_SYSTEM } from "@/lib/system";

export function SystemSwitcher() {
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [active, setActive] = useState<string>(DEFAULT_SYSTEM);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await listSystems();
      setSystems(r.systems);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    setActive(getActiveSystem());
    load();
  }, []);

  function pick(id: string) {
    setActive(id);
    setActiveSystem(id);
    setOpen(false);
    window.location.reload();
  }

  async function handleCreateNew() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      // No modal — create a placeholder system and dive straight into chat.
      // The agronomist will conversationally ask the grower to name it and
      // fill in crop/stage/reservoir/etc. via the askGrower tool.
      const r = await createSystem({ name: "מערכת חדשה" });
      pick(r.system.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  const activeSys = systems.find((s) => s.id === active);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2 max-w-[200px]"
        aria-expanded={open}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
        <span className="truncate font-medium">
          {activeSys?.name || (active === DEFAULT_SYSTEM ? "מערכת ראשית" : active)}
        </span>
        <span className="text-zinc-400">▾</span>
      </button>

      {open && (
        <div
          className="absolute end-0 mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-20 overflow-hidden"
          onMouseLeave={() => !creating && setOpen(false)}
        >
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-950/40">
              {error}
            </div>
          )}

          <ul className="max-h-80 overflow-y-auto">
            {systems.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => pick(s.id)}
                  className={`w-full text-right px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors ${
                    s.id === active ? "bg-emerald-50 dark:bg-emerald-950/40" : ""
                  }`}
                >
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-zinc-500">
                    {s.crop_type} · {s.reservoir_liters}L · {s.growth_stage}
                  </div>
                </button>
              </li>
            ))}
            {systems.length === 0 && (
              <li className="text-sm text-zinc-500 p-3 text-center">אין מערכות עדיין</li>
            )}
          </ul>
          <button
            onClick={handleCreateNew}
            disabled={creating}
            className="w-full text-right px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-emerald-600 dark:text-emerald-400 disabled:opacity-50"
          >
            {creating ? "יוצר מערכת..." : "+ מערכת חדשה (החקלאי ינחה אותך)"}
          </button>
        </div>
      )}
    </div>
  );
}
