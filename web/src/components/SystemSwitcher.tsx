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
    // Force a soft reload so all data-fetching hooks restart on the new system
    window.location.reload();
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") || "").trim();
    const crop = String(form.get("crop") || "lettuce").trim() || "lettuce";
    const reservoir = Number(form.get("reservoir") || 60);
    const stage = String(form.get("stage") || "vegetative").trim() || "vegetative";
    if (!name) return;
    try {
      const r = await createSystem({
        name,
        crop_type: crop,
        reservoir_liters: reservoir,
        growth_stage: stage,
      });
      pick(r.system.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

          {!creating ? (
            <>
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
                onClick={() => setCreating(true)}
                className="w-full text-right px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-emerald-600 dark:text-emerald-400"
              >
                + מערכת חדשה
              </button>
            </>
          ) : (
            <form onSubmit={handleCreate} className="p-3 space-y-2">
              <div>
                <label className="text-xs text-zinc-500 block mb-0.5">שם</label>
                <input
                  name="name"
                  autoFocus
                  required
                  placeholder='לדוגמה: "מגדל מרפסת"'
                  className="w-full text-sm px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-500 block mb-0.5">גידול</label>
                  <select
                    name="crop"
                    defaultValue="lettuce"
                    className="w-full text-sm px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                  >
                    <option value="lettuce">חסה</option>
                    <option value="basil">בזיליקום</option>
                    <option value="spinach">תרד</option>
                    <option value="strawberry">תות</option>
                    <option value="tomato">עגבנייה</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-0.5">מכל (L)</label>
                  <input
                    name="reservoir"
                    type="number"
                    defaultValue={60}
                    min={5}
                    max={2000}
                    className="w-full text-sm px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-0.5">שלב גידול</label>
                <select
                  name="stage"
                  defaultValue="vegetative"
                  className="w-full text-sm px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
                >
                  <option value="seedling">נבט</option>
                  <option value="vegetative">וגטטיבי</option>
                  <option value="flowering">פריחה</option>
                  <option value="fruiting">פירות</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 text-sm bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700"
                >
                  צור
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="text-sm px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  ביטול
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
