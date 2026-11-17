"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { mergeGroups } from "@/lib/discogs/group";
import { artistKey, primaryType } from "@/lib/discogs/normalize";
import type { ArtistGroup, MasterSummary, MastersBatch, SearchEntry, SearchPage } from "@/lib/discogs/types";
import { artistsBackQuery, finderQuery, MODES, parseFinder, UNKNOWN_KEY, type FinderState, type Mode } from "@/lib/finder-state";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/ds/Button";
import { SearchIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";
import { DiscogsAttribution } from "../DiscogsAttribution";
import { Cover, Problem, ResultSkeleton, Stepper } from "./parts";
import { useDiscogs, usePaged } from "./use-discogs";
import { openSearchHelp, SearchHelp } from "./SearchHelp";
import { replaceParams } from "./url-state";

/** Albums shown (and master records resolved) at a time. Each unresolved master costs one Discogs request. */
const ALBUMS_PER_VIEW = 12;
/** A throttled batch is retried this many times, then the cards simply keep the data we already have. */
const MAX_MASTER_RETRIES = 2;

const groupParam = (g: ArtistGroup) => g.key || UNKNOWN_KEY;
const mergeSearch = (prev: SearchPage, next: SearchPage): SearchPage => ({ ...next, groups: mergeGroups(prev.groups, next.groups) });
/** "Show more" results: the page count goes into the URL, and is loaded again when the person comes back to this address. */
const rememberSearchPages = (page: number) => replaceParams({ sp: page > 1 ? String(page) : null });
const discogsSearchUrl = (q: string) => `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=all`;

/** What "Fill in this example" puts in the form (names that are on the placeholders already; no claim about any record). */
const EXAMPLE = { mode: "track" as Mode, q: "One More Time", by: "Daft Punk" };

/** Step 1: the query form. Remounted when the URL's query changes or an example is filled in, so it never shows stale text. */
function SearchForm({ mode: initialMode, q, by: initialBy }: { mode: Mode; q: string; by: string }) {
  const t = useTranslations("finder");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState(q);
  const [by, setBy] = useState(initialBy);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return setError(t("queryRequired"));
    setError(null);
    const artist = by.trim();
    router.push({ pathname: "/search", query: { mode, q: trimmed, ...(artist && mode !== "artist" ? { by: artist } : {}) } });
  }

  const inputId = "finder-q";
  return (
    <form className="x-searchbar" onSubmit={onSubmit} role="search" noValidate>
      <div className="x-modes" role="group" aria-label={t("modeLabel")}>
        {MODES.map((m) => (
          <button key={m} type="button" className="tag" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {t(`modes.${m}`)}
          </button>
        ))}
      </div>
      <div className={error ? "field is-error" : "field"}>
        <label className="field__label" htmlFor={inputId}>
          {t(`queryLabel.${mode}`)}
        </label>
        <input
          id={inputId}
          className="input"
          type="search"
          name="q"
          value={value}
          maxLength={100}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t(`placeholder.${mode}`)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-help ${inputId}-err` : `${inputId}-help`}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="field__help" id={`${inputId}-help`}>
          {t(`modeHint.${mode}`)}
        </div>
        {error ? (
          <div className="field__help" id={`${inputId}-err`} role="alert">
            {error}
          </div>
        ) : null}
      </div>
      {mode !== "artist" ? (
        <div className="field">
          <label className="field__label" htmlFor="finder-by">
            {t("byLabel")}
          </label>
          <input
            id="finder-by"
            className="input"
            type="search"
            name="by"
            value={by}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={t("byPlaceholder")}
            aria-describedby="finder-by-help"
            onChange={(e) => setBy(e.target.value)}
          />
          <div className="field__help" id="finder-by-help">
            {t("byHelp")}
          </div>
        </div>
      ) : null}
      <div>
        <Button type="submit">
          <SearchIcon />
          <span>{t("submit")}</span>
        </Button>
      </div>
    </form>
  );
}

/** One album: from the master record when we have it (title, year, cover), otherwise from the vinyl release we found. */
function AlbumCard({ entry, master, resolving, query }: { entry: SearchEntry; master?: MasterSummary; resolving: boolean; query: Record<string, string> }) {
  const t = useTranslations("finder");
  const isMaster = entry.kind === "master";
  const title = master?.title ?? entry.title;
  const year = master?.year ?? entry.year;
  const thumb = master?.thumb ?? entry.thumb;
  // `query` is where we are now (search, artist, "show more" state): the next screens carry it, so Back can rebuild this one exactly.
  const artist = master?.artist ?? entry.artist;
  const href = isMaster
    ? { pathname: `/master/${entry.id}`, query: { ...query, ...(artist ? { a: artist } : {}), t: title } }
    : { pathname: `/release/${entry.id}`, query: { ...query, ...(artist ? { a: artist } : {}) } };
  const waiting = isMaster && resolving && !master;
  const kind = primaryType(entry.types); // Album / EP / Single / Compilation, only when the format descriptors say so

  return (
    <article className="card x-result" aria-busy={waiting || undefined}>
      <Link href={href} className="x-result__media" tabIndex={-1} aria-hidden="true">
        {waiting ? <div className="skel x-cover" /> : <Cover src={thumb} />}
      </Link>
      <div className="x-result__body">
        {waiting ? (
          <>
            <div className="skel x-skel-line x-skel-line--wide" />
            <div className="skel x-skel-line x-skel-line--short" />
          </>
        ) : (
          <>
            <h3 className="x-result__title">
              <Link href={href}>{title}</Link>
            </h3>
            <p className="x-result__meta">
              {year ?? t("yearUnknown")}
              {/* Medium and physical format only ("Vinyl, LP"): the rest (Test Pressing, Promo, ...) describes one release, not the album. */}
              {entry.formats.length ? ` · ${entry.formats.slice(0, 2).join(", ")}` : ""}
            </p>
            {kind ? <span className="badge">{t(`types.${kind}`)}</span> : null}
            <Link href={href} className="x-result__cta link">
              {isMaster ? t("seePressings") : t("openRelease")}
            </Link>
          </>
        )}
        {/* API Terms of Use: "Data provided by Discogs." directly next to the data, linking to the page that holds it. */}
        <DiscogsAttribution href={master?.discogsUrl ?? entry.discogsUrl} />
      </div>
    </article>
  );
}

/** A view of up to ALBUMS_PER_VIEW albums. Resolves their master records in ONE call (cached per master). */
function AlbumPage({ entries, query }: { entries: SearchEntry[]; query: Record<string, string> }) {
  const ids = useMemo(() => entries.filter((e) => e.kind === "master").map((e) => e.id), [entries]);
  const { state, retry } = useDiscogs<MastersBatch>(ids.length ? `/api/discogs/masters?ids=${ids.join(",")}` : null);
  const batch = state.kind === "ok" ? state.data : null;
  const byId = useMemo(() => new Map((batch?.masters ?? []).map((m) => [m.id, m])), [batch]);

  // Discogs asked us to slow down: try again a couple of times, then keep the data we already have.
  const attempts = useRef(0);
  const retryAfter = batch?.missing.length ? batch.retryAfter : undefined;
  useEffect(() => {
    if (retryAfter === undefined || attempts.current >= MAX_MASTER_RETRIES) return;
    const timer = setTimeout(() => {
      attempts.current += 1;
      retry();
    }, retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [retryAfter, retry]);

  return (
    <>
      {entries.map((e) => (
        <AlbumCard key={e.key} entry={e} master={byId.get(e.id)} resolving={state.kind === "loading"} query={query} />
      ))}
    </>
  );
}

/**
 * Step 3. Albums (masters) of one artist, ALBUMS_PER_VIEW at a time; "show more" reveals (and resolves) the next view.
 * Vinyl releases Discogs has not grouped under a master come AFTER, in a section that is collapsed by default (open only
 * when there is nothing else to show).
 */
function AlbumList({ group, query, views, othersOpen }: { group: ArtistGroup; query: Record<string, string>; views: number; othersOpen: boolean }) {
  const t = useTranslations("finder");
  const masters = group.entries.filter((e) => e.kind === "master");
  const others = group.entries.filter((e) => e.kind === "release");
  // "Show more" and the open/closed section live in the URL (see lib/finder-state.ts), so Back, reload and a copied link keep them.
  const openOthers = othersOpen || masters.length === 0;

  const shown = masters.slice(0, views * ALBUMS_PER_VIEW);
  const pages = Array.from({ length: views }, (_, i) => shown.slice(i * ALBUMS_PER_VIEW, (i + 1) * ALBUMS_PER_VIEW)).filter((p) => p.length);
  return (
    <>
      {masters.length ? (
        <div className="x-result-grid">
          {pages.map((entries) => (
            <AlbumPage key={entries[0].key} entries={entries} query={query} />
          ))}
        </div>
      ) : null}
      {shown.length < masters.length ? (
        <Button variant="outline" onClick={() => replaceParams({ n: String(views + 1) })}>
          {t("showMoreAlbums")}
        </Button>
      ) : null}

      {others.length ? (
        <details
          className="x-disclosure"
          open={openOthers}
          onToggle={(e) => {
            // Only a real change by the person (not React setting `open` from the URL) is written back.
            const open = e.currentTarget.open;
            if (open !== openOthers) replaceParams({ o: open ? "1" : null });
          }}
        >
          <summary className="x-disclosure__summary">
            <span>{t("otherPressingsTitle")}</span>
            <span className="badge">{t("otherPressingsCount", { count: others.length })}</span>
          </summary>
          <p className="x-note">{t("otherPressingsHint")}</p>
          <div className="x-result-grid">
            {others.map((e) => (
              <AlbumCard key={e.key} entry={e} resolving={false} query={query} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Step 2. A common title can match dozens of artists, so a long list can be narrowed by typing part of a name. */
function ArtistList({ groups, fs }: { groups: ArtistGroup[]; fs: FinderState }) {
  const t = useTranslations("finder");
  /** "6 albums · 10 without a master": albums are masters; the rest are vinyl releases without one. */
  const counts = (g: ArtistGroup) => {
    const albums = g.entries.filter((e) => e.kind === "master").length;
    const rest = g.entries.length - albums;
    return [albums ? t("albumCount", { count: albums }) : null, rest ? t("withoutMasterCount", { count: rest }) : null].filter(Boolean).join(" · ");
  };
  const [filter, setFilter] = useState("");
  const needle = artistKey(filter);
  const visible = needle ? groups.filter((g) => artistKey(g.artist).includes(needle)) : groups;
  return (
    <>
      {groups.length > 6 ? (
        <div className="field x-filter-artists">
          <label className="field__label" htmlFor="artist-filter">
            {t("filterArtists")}
          </label>
          <input id="artist-filter" className="input" type="search" value={filter} maxLength={60} autoComplete="off" placeholder={t("filterPlaceholder")} onChange={(e) => setFilter(e.target.value)} />
        </div>
      ) : null}
      {visible.length ? (
        <ul className="x-result-grid x-plain-list">
          {visible.map((g) => (
            <li key={g.key || UNKNOWN_KEY}>
              <Link
                href={{ pathname: "/search", query: finderQuery({ ...fs, g: groupParam(g), views: 1, othersOpen: false }) }}
                className="card card--interactive x-result x-result--artist"
              >
                <Cover src={g.entries.find((e) => e.thumb)?.thumb ?? null} />
                <span className="x-result__body">
                  <span className="x-result__title">{g.artist ?? t("unknownArtist")}</span>
                  <span className="x-result__meta">{counts(g)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <StatusMessage tone="info">{t("noArtistMatch")}</StatusMessage>
      )}
    </>
  );
}

export function SearchFlow() {
  const t = useTranslations("finder");
  const params = useSearchParams();
  // Everything below comes from the address (see lib/finder-state.ts): invalid or tampered values have already fallen back to defaults.
  const fs = parseFinder(params);
  const { mode, q, by } = fs;

  const urlForPage = (page: number) => (q ? `/api/discogs/search?q=${encodeURIComponent(q)}&mode=${mode}${by ? `&by=${encodeURIComponent(by)}` : ""}&page=${page}` : null);
  const paged = usePaged<SearchPage>(urlForPage, mergeSearch, { wantPages: fs.searchPages, onMore: rememberSearchPages });
  const { state, data } = paged;

  const groups = data?.groups ?? [];
  const selected = groups.length === 1 ? groups[0] : (groups.find((g) => groupParam(g) === fs.g) ?? null);
  // 0 Track, 1 Artist, 2 Album. Pressing and the release card are on the next screens.
  const current = !q ? 0 : selected ? 2 : 1;
  const stepLabels = (["track", "artist", "album", "pressing"] as const).map((k) => t(`steps.${k}`));
  const page = data?.page ?? 1;
  // Where we are right now, carried by every link that leaves this screen (album cards) so that Back returns here exactly.
  const albumContext = finderQuery({ ...fs, g: selected ? groupParam(selected) : fs.g, searchPages: page });
  const empty = Boolean(q && data && groups.length === 0);
  const restoring = paged.restoring;
  // "Fill in this example" (in the help): the form is remounted with the example's values. It only applies to the address it was
  // pressed on: a real search (a new address) shows that search again. The counter makes each press a fresh form.
  const addressKey = `${mode}|${q}|${by}`;
  const [example, setExample] = useState<{ n: number; addressKey: string } | null>(null);
  const exampleShown = example !== null && example.addressKey === addressKey;
  const seed = exampleShown ? EXAMPLE : { mode, q, by };

  return (
    <div className="container x-page x-finder">
      <h1 className="x-finder__title">{t("title")}</h1>
      <p className="x-lead">{t("lead")}</p>
      <p className="x-note">{t("vinylOnly")}</p>
      <Stepper current={current} label={t("stepsLabel")} steps={stepLabels} />

      <SearchHelp onExample={() => setExample((e) => ({ n: (e?.n ?? 0) + 1, addressKey }))} />

      <SearchForm key={`${addressKey}|${exampleShown ? example.n : 0}`} mode={seed.mode} q={seed.q} by={seed.by} />

      {!q ? <p className="x-note">{t("hint")}</p> : null}

      {q && (state.kind === "loading" || restoring) ? <ResultSkeleton label={t("resultsFor", { q })} /> : null}
      {q && state.kind !== "loading" && state.kind !== "ok" && state.kind !== "idle" ? <Problem state={state} onRetry={paged.retry} /> : null}

      {empty ? (
        <section className="x-section" aria-labelledby="empty-h">
          <StatusMessage tone="info" title={t("emptyTitle")}>
            <span id="empty-h">{t("emptyText")}</span>
          </StatusMessage>
          <p className="x-note">
            {t("emptyTips")}{" "}
            <Button variant="ghost" size="sm" onClick={openSearchHelp}>
              {t("emptyTipsButton")}
            </Button>
          </p>
          {/* Ways out of a dead end. Shown ONLY when the main search found nothing. The optional artist travels with the
              track <-> album switch (both use it); the artist mode has no such field. */}
          <nav className="x-fallback" aria-label={t("fallbackTitle")}>
            <span className="x-note">{t("fallbackText", { q })}</span>
            {MODES.filter((m) => m !== mode).map((m) => (
              <Link key={m} className="tag" href={{ pathname: "/search", query: finderQuery({ ...fs, mode: m, g: null, views: 1, searchPages: 1, othersOpen: false, by: m === "artist" ? "" : by }) }}>
                {t(`tryAs.${m}`)}
              </Link>
            ))}
            {by ? (
              <Link className="tag" href={{ pathname: "/search", query: finderQuery({ ...fs, by: "", g: null, views: 1, searchPages: 1, othersOpen: false }) }}>
                {t("withoutArtist")}
              </Link>
            ) : null}
          </nav>
        </section>
      ) : null}

      {data && !restoring && groups.length > 0 && !selected ? (
        <section className="x-section" aria-labelledby="artists-h">
          <h2 id="artists-h">{t("artistsTitle")}</h2>
          <p className="x-note">{t("artistsLead")}</p>
          <ArtistList key={`${mode}|${q}|${by}`} groups={groups} fs={{ ...fs, searchPages: page }} />
          <DiscogsAttribution href={discogsSearchUrl(q)} />
        </section>
      ) : null}

      {data && !restoring && selected ? (
        <section className="x-section" aria-labelledby="albums-h">
          {groups.length > 1 ? (
            <Link className="link x-link-block" href={{ pathname: "/search", query: artistsBackQuery({ ...fs, searchPages: page }) }}>
              {t("otherArtists")}
            </Link>
          ) : null}
          <h2 id="albums-h">{selected.artist ? t("albumsBy", { artist: selected.artist }) : t("albumsTitle")}</h2>
          <AlbumList key={selected.key || UNKNOWN_KEY} group={selected} query={albumContext} views={fs.views} othersOpen={fs.othersOpen} />
        </section>
      ) : null}

      {data && !restoring && groups.length > 0 ? (
        <div className="x-more">
          {data.incomplete ? (
            <p className="x-note" role="note">
              {t("incomplete")}
            </p>
          ) : null}
          {paged.moreProblem ? <Problem state={paged.moreProblem} onRetry={paged.loadMore} compact /> : null}
          {data.hasMore ? (
            <Button variant="outline" loading={paged.loadingMore} onClick={paged.loadMore}>
              {t("loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
