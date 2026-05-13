/**
 * Client-side helpers for managing the "active system" selection.
 *
 * Stored in localStorage (and reflected in URL query for shareability).
 * Default = "default" — backward compatible with single-system deployments.
 */

const STORAGE_KEY = "growk.activeSystem";
export const DEFAULT_SYSTEM = "default";

export function getActiveSystemFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const fromUrl = sp.get("system");
  return fromUrl && fromUrl.trim() ? fromUrl.trim() : null;
}

export function getActiveSystem(): string {
  if (typeof window === "undefined") return DEFAULT_SYSTEM;
  const fromUrl = getActiveSystemFromUrl();
  if (fromUrl) {
    try {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // ignore quota / storage errors
    }
    return fromUrl;
  }
  try {
    const fromStore = window.localStorage.getItem(STORAGE_KEY);
    if (fromStore && fromStore.trim()) return fromStore.trim();
  } catch {
    // ignore
  }
  return DEFAULT_SYSTEM;
}

export function setActiveSystem(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
  // Reflect in URL so refreshes preserve the selection.
  const url = new URL(window.location.href);
  if (id === DEFAULT_SYSTEM) {
    url.searchParams.delete("system");
  } else {
    url.searchParams.set("system", id);
  }
  window.history.replaceState(null, "", url.toString());
}
