"use client";

/**
 * Change query parameters of the CURRENT address without a navigation (no server round trip, no new history entry). Next.js
 * integrates window.history.replaceState with useSearchParams, so components re-render with the new values. `null` removes one.
 * Read at event time from window.location, so two quick changes cannot overwrite each other.
 */
export function replaceParams(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
