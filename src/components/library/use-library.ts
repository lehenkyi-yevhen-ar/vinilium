"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReleaseCard, ReleasesBatch } from "@/lib/discogs/types";
import type { Condition, ListName, ListPageJson, StoredItemJson } from "@/lib/lists/rules";
import { fetchDiscogs, useDiscogs, type Fetched } from "../finder/use-discogs";

// ---------------------------------------------------------------------------------------------------------------------------
// The user's own stored items (no Discogs content): one page at a time

interface Settled {
  url: string;
  value: Fetched<ListPageJson>;
  /** The ids that came from the SERVER for this page. The Discogs batch is keyed by these, so optimistic edits never refetch it. */
  ids: string;
}

/**
 * One page of the stored list. `refresh` re-reads it without showing a skeleton (after a move / remove, to refill the page);
 * `mutate` changes the page locally for optimistic updates. A different URL (page, sort, search...) shows the loading state.
 */
export function useStoredPage(url: string) {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchDiscogs<ListPageJson>(url, ac.signal)
      .then((value) => setSettled({ url, value, ids: value.kind === "ok" ? value.data.items.map((i) => i.releaseId).join(",") : "" }))
      .catch(() => {});
    return () => ac.abort();
  }, [url, nonce]);

  const state: Fetched<ListPageJson> = settled?.url === url ? settled.value : { kind: "loading" };
  const ids = settled?.url === url ? settled.ids : "";

  const mutate = useCallback((fn: (page: ListPageJson) => ListPageJson) => {
    setSettled((s) => (s && s.value.kind === "ok" ? { ...s, value: { ...s.value, data: fn(s.value.data) } } : s));
  }, []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { state, ids, mutate, refresh };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The Discogs data of the VISIBLE page: one batch call

export type CardState =
  | { kind: "loading" }
  | { kind: "ok"; card: ReleaseCard }
  | { kind: "gone" }
  | { kind: "pending"; retryAfter?: number }
  | { kind: "error"; unconfigured?: boolean };

/** The first records of a page are asked for on their own, so a cold page shows its top cards early; the rest follow. */
export const HEAD_SIZE = 4;

interface Part {
  ids: string[];
  state: Fetched<ReleasesBatch>;
  last: ReleasesBatch | null;
  retry: () => void;
}

/** One request of up to 24 ids. `enabled` = false keeps it idle (the tail waits for the head to settle). */
function useBatchPart(ids: string[], enabled: boolean): Part {
  const key = ids.join(",");
  const { state, retry } = useDiscogs<ReleasesBatch>(key && enabled ? `/api/discogs/releases?ids=${key}` : null);
  const [last, setLast] = useState<ReleasesBatch | null>(null);
  if (state.kind === "ok" && last !== state.data) setLast(state.data); // adjust-during-render (React's derived-state pattern)
  return { ids, state, last, retry };
}

function resolve(part: Part, id: number): CardState {
  const { state } = part;
  // While a new batch loads (a refill after a move, the 5.5-hour refresh) the previous one stays on screen.
  const batch = state.kind === "ok" ? state.data : state.kind === "loading" ? part.last : null;
  if (batch) {
    const card = batch.releases.find((r) => r.id === id);
    if (card) return { kind: "ok", card };
    if (batch.gone.includes(id)) return { kind: "gone" };
    if (state.kind === "ok") {
      // Not resolved: either Discogs (or our own per-person allowance) asked us to slow down, or it failed for this one.
      return batch.retryAfter !== undefined ? { kind: "pending", retryAfter: batch.retryAfter } : { kind: "error" };
    }
  }
  switch (state.kind) {
    case "idle":
    case "loading":
      return { kind: "loading" };
    case "throttled":
      return { kind: "pending", retryAfter: state.retryAfter };
    case "unconfigured":
      return { kind: "error", unconfigured: true };
    default:
      return { kind: "error" };
  }
}

/**
 * Card data for the ids of the visible page, from the TTL cache through /api/discogs/releases. Two requests, never more: the first
 * HEAD_SIZE ids, then (once that has settled) the rest, so the top of a COLD page appears after a couple of seconds instead of
 * after all 12 lookups. The Discogs calls are the same either way; a warm page costs none. Anything not resolved yet is
 * reported per item, and the old batch stays on screen while a new one loads, so cards never flash back to skeletons.
 */
export function useReleaseCards(ids: string) {
  const all = ids ? ids.split(",") : [];
  const head = useBatchPart(all.slice(0, HEAD_SIZE), true);
  const headSettled = head.ids.length === 0 || (head.state.kind !== "loading" && head.state.kind !== "idle");
  const tail = useBatchPart(all.slice(HEAD_SIZE), headSettled);

  const partOf = useCallback(
    (id: number) => (head.ids.includes(String(id)) ? head : tail),
    [head, tail],
  );
  const cardFor = useCallback((id: number): CardState => resolve(partOf(id), id), [partOf]);

  const loading = [head, tail].some((p) => p.ids.length > 0 && (p.state.kind === "loading" || p.state.kind === "idle"));
  const missingCount = [head, tail].reduce(
    (n, p) => n + (p.state.kind === "ok" ? p.state.data.missing.length : p.state.kind === "throttled" ? p.ids.length : 0),
    0,
  );
  const retryAfters = [head, tail].map((p) => (p.state.kind === "ok" ? p.state.data.retryAfter : p.state.kind === "throttled" ? p.state.retryAfter : undefined)).filter((n): n is number => n !== undefined);
  const retryAfter = retryAfters.length ? Math.max(...retryAfters) : undefined;
  const retry = useCallback(() => {
    head.retry();
    tail.retry();
  }, [head, tail]);
  return { loading, retry, cardFor, missingCount, retryAfter };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Writes. Every call returns a small result the screen turns into optimistic UI or a rollback.

export type WriteResult<T = undefined> = { ok: true; data: T } | { ok: false; reason: "signin" | "failed" };

async function write<T>(releaseId: number, method: "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<WriteResult<T>> {
  try {
    const res = await fetch(`/api/lists/items/${releaseId}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) return { ok: false, reason: "signin" };
    if (!res.ok) return { ok: false, reason: "failed" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export interface ItemEdit {
  notes?: string | null;
  conditionMedia?: Condition | null;
  conditionSleeve?: Condition | null;
}

export const saveItem = (releaseId: number, edit: ItemEdit) => write<{ item: StoredItemJson }>(releaseId, "PATCH", edit);
export const moveItem = (releaseId: number, list: ListName) => write<{ item: { list: ListName } }>(releaseId, "PUT", { list });
export const removeStoredItem = (releaseId: number) => write<{ removed: boolean }>(releaseId, "DELETE");
