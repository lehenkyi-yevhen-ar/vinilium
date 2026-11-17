"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_PAGE_SIZE,
  isListName,
  isPageSize,
  isSortKey,
  otherList,
  PAGE_SIZES,
  sortAllowed,
  type Condition,
  type ListName,
  type ListPageJson,
  type SortDir,
  type SortKey,
  type StoredItemJson,
} from "@/lib/lists/rules";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/ds/Button";
import { ButtonLink } from "@/ds/ButtonLink";
import { DiscIcon, FilterIcon, SearchIcon, XIcon } from "@/ds/icons";
import { useDS } from "@/ds/use-ds";
import { StatusMessage } from "@/ds/StatusMessage";
import { Countdown } from "../finder/parts";
import { SignInRequired } from "../finder/SignInRequired";
import { LibraryItem } from "./LibraryItem";
import { moveItem, removeStoredItem, saveItem, useReleaseCards, useStoredPage, type ItemEdit } from "./use-library";

const REMOVE_MODAL = "library-remove-modal";
/** A throttled batch is retried by itself this many times; after that only the button remains. */
const MAX_AUTO_RETRIES = 2;

interface View {
  list: ListName;
  q: string;
  sort: SortKey;
  dir: SortDir;
  page: number;
  size: number;
}

function readView(params: URLSearchParams): View {
  const listParam = params.get("list");
  const list: ListName = isListName(listParam) ? listParam : "wishlist";
  const sortParam = params.get("sort");
  const sort: SortKey = isSortKey(sortParam) && sortAllowed(list, sortParam) ? sortParam : "added";
  const size = Number(params.get("size"));
  const page = Math.trunc(Number(params.get("page")));
  return {
    list,
    q: (params.get("q") ?? "").trim().slice(0, 100),
    sort,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** Defaults are left out of the URL, so a plain /lists is the Wishlist, newest first, 12 per page. */
function queryFor(v: View): Record<string, string> {
  return {
    ...(v.list !== "wishlist" ? { list: v.list } : {}),
    ...(v.q ? { q: v.q } : {}),
    ...(v.sort !== "added" || v.dir !== "desc" ? { sort: v.sort, dir: v.dir } : {}),
    ...(v.size !== DEFAULT_PAGE_SIZE ? { size: String(v.size) } : {}),
    ...(v.page > 1 ? { page: String(v.page) } : {}),
  };
}

const apiUrl = (v: View) =>
  `/api/lists/items?${new URLSearchParams({ list: v.list, ...(v.q ? { q: v.q } : {}), sort: v.sort, dir: v.dir, page: String(v.page), pageSize: String(v.size) })}`;

/** 1 … 4 5 [6] 7 8 … 20: the first and last page, and a window around the current one. */
function pageWindow(page: number, pages: number): Array<number | "gap"> {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  const t = useTranslations("library");
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("paginationLabel")} className="x-pager-wrap">
      <div className="pager">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("prev")}>
          ‹
        </Button>
        {pageWindow(page, pages).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="pager__gap" aria-hidden="true">
              …
            </span>
          ) : (
            <Button key={n} variant="ghost" size="sm" aria-current={n === page ? "page" : undefined} aria-label={t("goToPage", { n })} onClick={() => onPage(n)}>
              {n}
            </Button>
          ),
        )}
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("next")}>
          ›
        </Button>
      </div>
      <p className="x-note">{t("pageStatus", { page, pages })}</p>
    </nav>
  );
}

function ListSkeleton({ label, rows }: { label: string; rows: number }) {
  return (
    <div className="x-library-grid" aria-busy="true" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card x-item" aria-hidden="true">
          <div className="x-item__discogs">
            <div className="skel x-cover" />
            <div className="x-result__body">
              <div className="skel x-skel-line x-skel-line--wide" />
              <div className="skel x-skel-line" />
              <div className="skel x-skel-line x-skel-line--short" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Wishlist and Collection. The server pages and sorts only what is ours (added date, notes, condition); the record details for
 * the VISIBLE page come from one batched Discogs request through the TTL cache. Edits, moves and removals update the screen
 * at once and roll back, with a message, when the server says no.
 */
export function LibraryView() {
  const t = useTranslations("library");
  const router = useRouter();
  const params = useSearchParams();
  const view = readView(new URLSearchParams(params.toString()));
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useDS(root);

  const { state, ids, mutate, refresh } = useStoredPage(apiUrl(view));
  const { state: detailState, retry, cardFor, missingCount, retryAfter } = useReleaseCards(ids);

  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: number; title: string } | null>(null);
  const [retries, setRetries] = useState({ ids: "", n: 0 });
  // Phones: search, sort and page size sit behind a "Filters" toggle so the first card is on screen. Desktop shows them always (CSS).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQ, setDraftQ] = useState<{ from: string; value: string }>({ from: view.q, value: view.q });
  const [counts, setCounts] = useState<Record<ListName, number> | null>(null);

  const data = state.kind === "ok" ? state.data : null;
  // The tab counts keep the last known numbers while a new page loads (adjust-during-render, guarded).
  if (data && counts !== data.counts && (counts?.wishlist !== data.counts.wishlist || counts?.collection !== data.counts.collection)) setCounts(data.counts);
  if (draftQ.from !== view.q) setDraftQ({ from: view.q, value: view.q }); // the URL changed (back button, clear): the box follows

  const go = useCallback(
    (patch: Partial<View>, opts: { reset?: boolean } = { reset: true }) => {
      const next: View = { ...view, ...patch, ...(opts.reset === false ? {} : { page: patch.page ?? 1 }) };
      if (!sortAllowed(next.list, next.sort)) next.sort = "added";
      router.push({ pathname: "/lists", query: queryFor(next) });
    },
    [router, view],
  );

  // A page past the end (after removing the last item of it) is clamped by the server: follow it.
  useEffect(() => {
    if (data && data.page !== view.page) router.replace({ pathname: "/lists", query: queryFor({ ...view, page: data.page }) });
  }, [data, view, router]);

  const lock = (id: number, on: boolean) =>
    setBusy((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setProblem = (id: number, text: string | null) =>
    setProblems((p) => {
      const { [id]: _drop, ...rest } = p;
      return text ? { ...rest, [id]: text } : rest;
    });
  const fail = (id: number, reason: "signin" | "failed", text: string) => {
    if (reason === "signin") setSignedOut(true);
    else setProblem(id, text);
  };
  const replaceItem = (id: number, fn: (i: StoredItemJson) => StoredItemJson) =>
    mutate((p) => ({ ...p, items: p.items.map((i) => (i.releaseId === id ? fn(i) : i)) }));

  async function edit(item: StoredItemJson, patch: ItemEdit, doneText: string) {
    const id = item.releaseId;
    const before: ItemEdit = {
      ...(patch.notes !== undefined ? { notes: item.notes } : {}),
      ...(patch.conditionMedia !== undefined ? { conditionMedia: item.conditionMedia } : {}),
      ...(patch.conditionSleeve !== undefined ? { conditionSleeve: item.conditionSleeve } : {}),
    };
    setProblem(id, null);
    setNotice(null);
    replaceItem(id, (i) => ({ ...i, ...patch })); // optimistic
    lock(id, true);
    const r = await saveItem(id, patch);
    lock(id, false);
    if (r.ok) {
      replaceItem(id, () => r.data.item); // what the server actually stored (trimmed, cleaned)
      setNotice(doneText);
    } else {
      replaceItem(id, (i) => ({ ...i, ...before })); // rollback
      fail(id, r.reason, t("saveFailed"));
    }
  }

  /** Moves and removals take the item out of this view at once; the rollback puts it back where it was. */
  async function leave(item: StoredItemJson, run: () => Promise<{ ok: boolean; reason?: "signin" | "failed" }>, kind: "move" | "remove") {
    const id = item.releaseId;
    const from = item.list;
    const to = otherList(from);
    const index = data ? data.items.findIndex((i) => i.releaseId === id) : -1;
    setProblem(id, null);
    setNotice(null);
    const delta = (p: ListPageJson, sign: 1 | -1): ListPageJson => ({
      ...p,
      total: p.total + sign,
      counts: { ...p.counts, [from]: p.counts[from] + sign, ...(kind === "move" ? { [to]: p.counts[to] - sign } : {}) },
    });
    mutate((p) => delta({ ...p, items: p.items.filter((i) => i.releaseId !== id) }, -1));
    lock(id, true);
    const r = await run();
    lock(id, false);
    if (r.ok) {
      setNotice(kind === "move" ? t("movedTo", { list: t(to) }) : t("removedMsg"));
      refresh(); // refill the page from the server; the Discogs batch only asks for what is new
      heading.current?.focus();
    } else {
      mutate((p) => {
        const items = [...p.items];
        items.splice(index < 0 ? items.length : Math.min(index, items.length), 0, item);
        return delta({ ...p, items }, 1);
      });
      fail(id, r.reason ?? "failed", kind === "move" ? t("moveFailed") : t("removeFailed"));
    }
  }

  const openRemove = (item: StoredItemJson, title: string | null, opener: HTMLElement) => {
    setRemoveTarget({ id: item.releaseId, title: title ?? t("unknownTitle") });
    window.DS?.modal(REMOVE_MODAL).open(opener);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    go({ q: draftQ.value.trim() });
    setFiltersOpen(false); // on a phone, show the results; the toggle says how many filters are on
  };
  const activeFilters = (view.q ? 1 : 0) + (view.sort !== "added" || view.dir !== "desc" ? 1 : 0) + (view.size !== DEFAULT_PAGE_SIZE ? 1 : 0);

  const autoRetries = retries.ids === ids ? retries.n : 0;
  const titleFor = (id: number) => {
    const c = cardFor(id);
    return c.kind === "ok" ? c.card.title : null;
  };

  const list = view.list;
  const total = data?.total ?? 0;
  const empty = data && data.total === 0;
  const searching = Boolean(data?.q);

  return (
    <div className="container x-page x-finder" ref={root}>
      <div>
        <h1 className="x-finder__title" ref={heading} tabIndex={-1}>
          {t("title")}
        </h1>
        <p className="x-lead">{t("lead")}</p>
      </div>

      <nav aria-label={t("tabsLabel")}>
        <div className="tabs__list x-tabs">
          {(["wishlist", "collection"] as const).map((l) => (
            <Link
              key={l}
              href={{ pathname: "/lists", query: queryFor({ ...view, list: l, page: 1, sort: "added", dir: "desc", q: "" }) }}
              className="tabs__tab"
              aria-current={l === list ? "page" : undefined}
              data-testid={`tab-${l}`}
            >
              {counts ? t("tabCount", { name: t(l), count: counts[l] }) : t(l)}
            </Link>
          ))}
        </div>
      </nav>

      {signedOut ? <SignInRequired expired compact next="/lists" /> : null}

      <div className="x-library-filters" data-open={filtersOpen || undefined}>
        <Button
          variant="outline"
          className="x-library-filters__toggle"
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <FilterIcon /> {activeFilters ? t("filtersActive", { count: activeFilters }) : t("filters")}
        </Button>
        <form id="library-filters" className="x-library-bar" onSubmit={onSearch} role="search">
          <div className="field x-library-bar__search">
            <label className="field__label" htmlFor="library-q">
              {t("searchLabel")}
            </label>
            <input
              id="library-q"
              className="input"
              type="search"
              name="q"
              value={draftQ.value}
              maxLength={100}
              placeholder={t("searchPlaceholder")}
              aria-describedby="library-q-help"
              onChange={(e) => setDraftQ({ from: view.q, value: e.target.value })}
            />
            <div className="field__help" id="library-q-help">
              {t("searchHelp")}
            </div>
          </div>
          <div className="x-actions x-library-bar__go">
            <Button type="submit">
              <SearchIcon /> {t("searchButton")}
            </Button>
            {view.q ? (
              <Button variant="ghost" onClick={() => go({ q: "" })}>
                <XIcon /> {t("clearSearch")}
              </Button>
            ) : null}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="library-sort">
              {t("sortLabel")}
            </label>
            <div className="select-wrap">
              <select
                id="library-sort"
                className="select"
                value={`${data?.sort ?? view.sort}:${data?.dir ?? view.dir}`}
                onChange={(e) => {
                  const [sort, dir] = e.target.value.split(":") as [SortKey, SortDir];
                  go({ sort, dir });
                }}
              >
                <option value="added:desc">{t("sort.addedDesc")}</option>
                <option value="added:asc">{t("sort.addedAsc")}</option>
                <option value="notes:asc">{t("sort.notesAsc")}</option>
                <option value="notes:desc">{t("sort.notesDesc")}</option>
                {list === "collection" ? (
                  <>
                    <option value="condition:asc">{t("sort.conditionBest")}</option>
                    <option value="condition:desc">{t("sort.conditionWorst")}</option>
                  </>
                ) : null}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="library-size">
              {t("pageSizeLabel")}
            </label>
            <div className="select-wrap">
              <select id="library-size" className="select" value={view.size} onChange={(e) => go({ size: Number(e.target.value) })}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {t("perPage", { n })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </form>
      </div>

      <p className="x-note" role="status" aria-live="polite" data-testid="library-notice">
        {notice}
      </p>

      {state.kind === "loading" ? <ListSkeleton label={t("loadingList")} rows={view.size} /> : null}

      {state.kind === "unauthorized" ? <SignInRequired expired compact next="/lists" /> : null}
      {state.kind === "error" || state.kind === "throttled" || state.kind === "not_found" || state.kind === "unconfigured" ? (
        <StatusMessage
          tone="error"
          title={t("loadFailedTitle")}
          actions={
            <Button variant="outline" size="sm" onClick={refresh}>
              {t("retry")}
            </Button>
          }
        >
          {t("loadFailedText")}
        </StatusMessage>
      ) : null}

      {data ? (
        <>
          <p className="x-note" data-testid="library-summary">
            {searching ? t("summaryFiltered", { count: total, q: data.q }) : t("summary", { count: total })}
          </p>

          {missingCount > 0 && detailState.kind !== "loading" ? (
            <StatusMessage
              tone="throttled"
              title={t("waitingTitle")}
              actions={
                <Button variant="outline" size="sm" onClick={retry}>
                  {t("retryNow")}
                </Button>
              }
            >
              {retryAfter !== undefined && autoRetries < MAX_AUTO_RETRIES ? (
                <Countdown
                  key={`${ids}-${autoRetries}`}
                  seconds={retryAfter}
                  onDone={() => {
                    setRetries({ ids, n: autoRetries + 1 });
                    retry();
                  }}
                >
                  {(left) => (
                    <>
                      <p>{t("busyBanner", { count: missingCount })}</p>
                      <p>{t("busyRetryIn", { seconds: left })}</p>
                    </>
                  )}
                </Countdown>
              ) : (
                <p>{t("busyGaveUp")}</p>
              )}
            </StatusMessage>
          ) : null}

          {empty ? (
            <div className="x-empty" data-testid="library-empty">
              <DiscIcon className="x-empty__icon" />
              <h2>{searching ? t("noMatchTitle") : list === "wishlist" ? t("emptyWishlistTitle") : t("emptyCollectionTitle")}</h2>
              <p>{searching ? t("noMatchText", { q: data.q }) : list === "wishlist" ? t("emptyWishlistText") : t("emptyCollectionText")}</p>
              {searching ? (
                <Button variant="outline" onClick={() => go({ q: "" })}>
                  {t("clearSearch")}
                </Button>
              ) : (
                <ButtonLink href="/search">
                  <SearchIcon /> {t("findRecord")}
                </ButtonLink>
              )}
            </div>
          ) : (
            <ul className="x-library-grid x-plain-list" aria-label={t(list)}>
              {data.items.map((item) => (
                <li key={item.releaseId}>
                  <LibraryItem
                    item={item}
                    card={cardFor(item.releaseId)}
                    busy={busy.has(item.releaseId)}
                    problem={problems[item.releaseId] ?? null}
                    onSaveNotes={(notes) => edit(item, { notes }, t("notesSaved"))}
                    onCondition={(field: "conditionMedia" | "conditionSleeve", value: Condition | null) => edit(item, { [field]: value }, t("conditionSaved"))}
                    onMove={() => leave(item, () => moveItem(item.releaseId, otherList(item.list)), "move")}
                    onRemove={(opener) => openRemove(item, titleFor(item.releaseId), opener)}
                    onRetryDetails={retry}
                  />
                </li>
              ))}
            </ul>
          )}

          <Pager page={data.page} pages={data.pages} onPage={(n) => go({ page: n }, { reset: false })} />

          <section className="x-section x-export" aria-labelledby="export-h">
            <h2 id="export-h">{t("exportHeading")}</h2>
            <p className="x-note">{t("exportNote")}</p>
            <div className="x-actions">
              <a className="btn btn--outline btn--sm" href="/api/lists/export?format=csv" download>
                {t("exportCsv")}
              </a>
              <a className="btn btn--outline btn--sm" href="/api/lists/export?format=json" download>
                {t("exportJson")}
              </a>
            </div>
          </section>
        </>
      ) : null}

      <div className="modal" id={REMOVE_MODAL} data-role="alertdialog">
        <div className="modal__overlay" />
        <div className="modal__dialog">
          <div className="modal__head">
            <h3 className="modal__title">{t("removeTitle")}</h3>
            <button type="button" className="modal__close btn btn--ghost btn--icon btn--sm" data-close aria-label={t("cancel")}>
              <XIcon />
            </button>
          </div>
          <div className="modal__body">
            <p>{t("removeText", { title: removeTarget?.title ?? t("unknownTitle") })}</p>
          </div>
          <div className="modal__foot">
            <button type="button" className="btn btn--secondary" data-close autoFocus>
              {t("removeKeep")}
            </button>
            <Button
              variant="danger"
              data-testid="confirm-remove"
              onClick={() => {
                window.DS?.modal(REMOVE_MODAL).close();
                const target = removeTarget;
                const item = data?.items.find((i) => i.releaseId === target?.id);
                if (item) void leave(item, () => removeStoredItem(item.releaseId), "remove");
              }}
            >
              {t("removeConfirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
