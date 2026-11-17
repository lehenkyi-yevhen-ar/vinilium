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

/**
 * Card data for the ids of the visible page, from ONE `/api/discogs/releases?ids=` request (served from the TTL cache, so a
 * warm page costs Discogs nothing). Anything not resolved yet is reported per item. The old batch stays on screen while a new
 * one loads (a refill after a move, the 5.5-hour refresh), so cards never flash back to skeletons.
 */
export function useReleaseCards(ids: string) {
  const { state, retry } = useDiscogs<ReleasesBatch>(ids ? `/api/discogs/releases?ids=${ids}` : null);
  const [last, setLast] = useState<ReleasesBatch | null>(null);
  if (state.kind === "ok" && last !== state.data) setLast(state.data); // adjust-during-render (React's derived-state pattern)

  const batch = state.kind === "ok" ? state.data : state.kind === "loading" ? last : null;

  const cardFor = useCallback(
    (id: number): CardState => {
      if (batch) {
        const card = batch.releases.find((r) => r.id === id);
        if (card) return { kind: "ok", card };
        if (state.kind === "ok") {
          if (batch.gone.includes(id)) return { kind: "gone" };
          // Not resolved: either Discogs asked us to slow down (retry after a while) or it failed for this one.
          return batch.retryAfter !== undefined ? { kind: "pending", retryAfter: batch.retryAfter } : { kind: "error" };
        }
        if (batch.gone.includes(id)) return { kind: "gone" };
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
    },
    [batch, state],
  );

  const missingCount = state.kind === "ok" ? state.data.missing.length : state.kind === "throttled" ? ids.split(",").filter(Boolean).length : 0;
  const retryAfter = state.kind === "ok" ? state.data.retryAfter : state.kind === "throttled" ? state.retryAfter : undefined;
  return { state, retry, cardFor, missingCount, retryAfter };
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
