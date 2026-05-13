/**
 * Helper to extract the active system ID from an incoming request.
 * Defaults to "default" if not specified — preserves backward compat with
 * single-system deployments.
 */
import { DEFAULT_SYSTEM_ID } from "./db";

export function systemIdFromRequest(req: Request): string {
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("system");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  } catch {
    // ignore
  }
  const fromHeader = req.headers.get("x-growk-system");
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();
  return DEFAULT_SYSTEM_ID;
}

export { DEFAULT_SYSTEM_ID };
