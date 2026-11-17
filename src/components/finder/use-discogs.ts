"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * What the UI can be looking at when it asks our /api/discogs/* endpoints for something.
 * `throttled` carries who is limiting us (`scope`) and when to retry, so screens can show a countdown
 * instead of breaking.
 */
export type Fetched<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: T; cached: boolean; fetchedAt: string }
  | { kind: "throttled"; retryAfter: number; scope: "discogs" | "app" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "unconfigured" }
  | { kind: "error" };

/** API Terms of Use: never show Content more than 6 h older than discogs.com. We re-fetch well before that. */
export const REFRESH_AFTER_MS = 5.5 * 60 * 60 * 1000;

export async function fetchDiscogs<T>(url: string, signal?: AbortSignal): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { signal, credentials: "same-origin" });
    if (res.ok) {
      const body = (await res.json()) as { data: T; cached: boolean; fetchedAt: string };
      return { kind: "ok", data: body.data, cached: body.cached, fetchedAt: body.fetchedAt };
    }
    const body = (await res.json().catch(() => ({}))) as { retryAfter?: number; scope?: "discogs" | "app" };
    switch (res.status) {
      case 401:
        return { kind: "unauthorized" };
      case 404:
        return { kind: "not_found" };
      case 429: {
        const header = Number(res.headers.get("retry-after"));
        return { kind: "throttled", retryAfter: Math.max(1, Math.ceil(body.retryAfter ?? (header || 5))), scope: body.scope === "app" ? "app" : "discogs" };
      }
      case 503:
        return { kind: "unconfigured" };
      default:
        return { kind: "error" };
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { kind: "error" };
  }
}

interface Settled<T> {
  key: string;
  value: Fetched<T>;
}

/**
 * Fetch one URL (null = nothing to fetch). `loading` is derived (a result for a different key is not a result), so
 * there is no synchronous setState inside an effect. `retry` re-runs the request. Fresh data is re-fetched before it
 * could become older than the 6-hour display limit.
 */
export function useDiscogs<T>(url: string | null) {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = url === null ? null : `${url}#${nonce}`;

  useEffect(() => {
    if (key === null || url === null) return;
    const ac = new AbortController();
    fetchDiscogs<T>(url, ac.signal)
      .then((value) => setSettled({ key, value }))
      .catch(() => {});
    return () => ac.abort();
  }, [key, url]);

  const fetchedAt = settled?.value.kind === "ok" ? settled.value.fetchedAt : null;
  useEffect(() => {
    if (!fetchedAt) return;
    const wait = Math.max(1_000, REFRESH_AFTER_MS - (Date.now() - Date.parse(fetchedAt)));
    const t = setTimeout(() => setNonce((n) => n + 1), wait);
    return () => clearTimeout(t);
  }, [fetchedAt]);

  const state: Fetched<T> = key === null ? { kind: "idle" } : settled?.key === key ? settled.value : { kind: "loading" };
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state, retry };
}

/** A page of results that can grow ("load more"). `PageLike` is what our search / versions pages have in common. */
export interface PageLike {
  page: number;
  hasMore: boolean;
}

export interface PagedOptions {
  /** Pages that were loaded when this address was left (from the URL). They are fetched again, one after the other. */
  wantPages?: number;
  /** Called after the person asked for more and it arrived, with the page now loaded (to put it in the URL). */
  onMore?: (page: number) => void;
}

export function usePaged<T extends PageLike>(
  urlForPage: (page: number) => string | null,
  merge: (previous: T, next: T) => T,
  { wantPages = 1, onMore }: PagedOptions = {},
) {
  const first = urlForPage(1);
  const { state, retry } = useDiscogs<T>(first);
  const [extra, setExtra] = useState<{ forUrl: string; data: T } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreProblem, setMoreProblem] = useState<Fetched<T> | null>(null);
  const [lastOk, setLastOk] = useState<{ data: T } | null>(null);

  const base = state.kind === "ok" ? state.data : null;
  const data = base ? (extra && extra.forUrl === first ? extra.data : base) : null;

  const loadMore = useCallback(async () => {
    if (!data || !first) return;
    setLoadingMore(true);
    setMoreProblem(null);
    const next = await fetchDiscogs<T>(urlForPage(data.page + 1) ?? first).catch(() => ({ kind: "error" }) as Fetched<T>);
    setLoadingMore(false);
    if (next.kind === "ok") {
      setExtra({ forUrl: first, data: merge(data, next.data) });
      onMore?.(next.data.page);
    } else setMoreProblem(next);
  }, [data, first, urlForPage, merge, onMore]);

  // Coming back to a step where "show more" had been pressed: load the missing pages again (each is cached on the server).
  // One page per effect run; the result changes `data`, which runs the effect for the next page.
  const missing = Boolean(data && data.hasMore && data.page < wantPages && !moreProblem);
  // A string, not the function: a new function identity on every render would restart the request every time.
  const nextUrl = missing && data ? urlForPage(data.page + 1) : null;
  useEffect(() => {
    if (!nextUrl || !data || !first) return;
    let cancelled = false;
    fetchDiscogs<T>(nextUrl)
      .then((next) => {
        if (cancelled) return;
        if (next.kind === "ok") setExtra({ forUrl: first, data: merge(data, next.data) });
        else setMoreProblem(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [nextUrl, data, first, merge]);

  // Remember the last good result so filter controls can stay on screen while a new filter set loads.
  // (React's documented pattern for derived state: adjust during render, guarded so it cannot loop.)
  if (base && lastOk?.data !== base) setLastOk({ data: base });

  return { state, data, lastData: lastOk?.data ?? null, loadMore, loadingMore, moreProblem, retry, restoring: missing };
}
