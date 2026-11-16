"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { mergeGroups } from "@/lib/discogs/group";
import { artistKey } from "@/lib/discogs/normalize";
import type { ArtistGroup, SearchEntry, SearchPage } from "@/lib/discogs/types";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/ds/Button";
import { SearchIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";
import { DiscogsAttribution } from "../DiscogsAttribution";
import { Cover, Problem, ResultSkeleton, Stepper } from "./parts";
import { usePaged } from "./use-discogs";

type UiMode = "track" | "artist" | "album";
const UI_MODES: UiMode[] = ["track", "artist", "album"];
/** The API calls the album search `master` (it searches Discogs master releases). */
const API_MODE: Record<UiMode, string> = { track: "track", artist: "artist", album: "master" };
const UNKNOWN_KEY = "-";

const parseMode = (v: string | null): UiMode => (UI_MODES.includes(v as UiMode) ? (v as UiMode) : "track");
const groupParam = (g: ArtistGroup) => g.key || UNKNOWN_KEY;
const mergeSearch = (prev: SearchPage, next: SearchPage): SearchPage => ({ ...next, groups: mergeGroups(prev.groups, next.groups) });

function discogsSearchUrl(q: string) {
  return `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=all`;
}

/** Step 1 of 4 (and the fallback modes): the query form. Remounted when the URL's query changes, so it is never stale. */
function SearchForm({ mode: initialMode, q }: { mode: UiMode; q: string }) {
  const t = useTranslations("finder");
  const router = useRouter();
  const [mode, setMode] = useState<UiMode>(initialMode);
  const [value, setValue] = useState(q);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return setError(t("queryRequired"));
    setError(null);
    router.push({ pathname: "/search", query: { mode, q: trimmed } });
  }

  const inputId = "finder-q";
  return (
    <form className="x-searchbar" onSubmit={onSubmit} role="search" noValidate>
      <div className="x-modes" role="group" aria-label={t("modeLabel")}>
        {UI_MODES.map((m) => (
          <button key={m} type="button" className="tag" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {t(`modes.${m}`)}
          </button>
        ))}
      </div>
      <div className={error ? "field is-error" : "field"}>
        <label className="field__label" htmlFor={inputId}>
          {t(`queryLabel.${mode}`)}
        </label>
        <div className="x-searchbar__row">
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
            aria-describedby={error ? `${inputId}-err` : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit">
            <SearchIcon />
            <span>{t("submit")}</span>
          </Button>
        </div>
        {error ? (
          <div className="field__help" id={`${inputId}-err`} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </form>
  );
}

function AlbumCard({ entry, query }: { entry: SearchEntry; query?: Record<string, string> }) {
  const t = useTranslations("finder");
  const isMaster = entry.kind === "master";
  const href = isMaster
    ? { pathname: `/master/${entry.id}`, query: { ...query, ...(entry.artist ? { a: entry.artist } : {}), t: entry.title } }
    : { pathname: `/release/${entry.id}` };

  return (
    <article className="card x-result">
      <Link href={href} className="x-result__media" tabIndex={-1} aria-hidden="true">
        <Cover src={entry.thumb} />
      </Link>
      <div className="x-result__body">
        <h3 className="x-result__title">
          <Link href={href}>{entry.title}</Link>
        </h3>
        <p className="x-result__meta">
          {entry.year ?? t("yearUnknown")}
          {entry.formats.length ? ` · ${entry.formats.slice(0, 3).join(", ")}` : ""}
        </p>
        {!isMaster ? <span className="badge">{t("standalone")}</span> : null}
        <Link href={href} className="x-result__cta link">
          {isMaster ? t("seePressings") : t("openRelease")}
        </Link>
        {/* API Terms of Use: "Data provided by Discogs." directly next to the data, linking to the page that holds it. */}
        <DiscogsAttribution href={entry.discogsUrl} />
      </div>
    </article>
  );
}

/** Step 2. A common title can match dozens of artists, so a long list can be narrowed by typing part of a name. */
function ArtistList({ groups, mode, q }: { groups: ArtistGroup[]; mode: UiMode; q: string }) {
  const t = useTranslations("finder");
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
            <ArtistCard key={g.key || UNKNOWN_KEY} group={g} mode={mode} q={q} />
          ))}
        </ul>
      ) : (
        <StatusMessage tone="info">{t("noArtistMatch")}</StatusMessage>
      )}
    </>
  );
}

function ArtistCard({ group, mode, q }: { group: ArtistGroup; mode: UiMode; q: string }) {
  const t = useTranslations("finder");
  const cover = group.entries.find((e) => e.thumb)?.thumb ?? null;
  return (
    <li>
      <Link
        href={{ pathname: "/search", query: { mode, q, artist: groupParam(group) } }}
        className="card card--interactive x-result x-result--artist"
      >
        <Cover src={cover} />
        <span className="x-result__body">
          <span className="x-result__title">{group.artist ?? t("unknownArtist")}</span>
          <span className="x-result__meta">{t("albumCount", { count: group.entries.length })}</span>
        </span>
      </Link>
    </li>
  );
}

export function SearchFlow() {
  const t = useTranslations("finder");
  const params = useSearchParams();
  const mode = parseMode(params.get("mode"));
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const artistParam = params.get("artist");

  const urlForPage = useCallback(
    (page: number) => (q ? `/api/discogs/search?q=${encodeURIComponent(q)}&mode=${API_MODE[mode]}&page=${page}` : null),
    [q, mode],
  );
  const paged = usePaged<SearchPage>(urlForPage, mergeSearch);
  const { state, data } = paged;

  const groups = data?.groups ?? [];
  const selected = groups.length === 1 ? groups[0] : (groups.find((g) => groupParam(g) === artistParam) ?? null);
  // 0 Track, 1 Artist, 2 Album. Pressing and the release card are on the next screens.
  const current = !q ? 0 : selected ? 2 : 1;
  const others = UI_MODES.filter((m) => m !== mode);
  const stepLabels = (["track", "artist", "album", "pressing"] as const).map((k) => t(`steps.${k}`));

  return (
    <div className="container x-page x-finder">
      <h1 className="x-finder__title">{t("title")}</h1>
      <p className="x-lead">{t("lead")}</p>
      <Stepper current={current} label={t("stepsLabel")} steps={stepLabels} />

      <SearchForm key={`${mode}|${q}`} mode={mode} q={q} />

      {!q ? <p className="x-note">{t("hint")}</p> : null}

      {q ? (
        <nav className="x-fallback" aria-label={t("fallbackTitle")}>
          <span className="x-note">{t("fallbackText", { q })}</span>
          {others.map((m) => (
            <Link key={m} className="tag" href={{ pathname: "/search", query: { mode: m, q } }}>
              {t(`tryAs.${m}`)}
            </Link>
          ))}
        </nav>
      ) : null}

      {q && state.kind === "loading" ? <ResultSkeleton label={t("resultsFor", { q })} /> : null}
      {q && state.kind !== "loading" && state.kind !== "ok" && state.kind !== "idle" ? <Problem state={state} onRetry={paged.retry} /> : null}

      {q && data && groups.length === 0 ? (
        <StatusMessage tone="info" title={t("emptyTitle")}>
          {t("emptyText")}
        </StatusMessage>
      ) : null}

      {data && groups.length > 0 && !selected ? (
        <section className="x-section" aria-labelledby="artists-h">
          <h2 id="artists-h">{t("artistsTitle")}</h2>
          <p className="x-note">{t("artistsLead")}</p>
          <ArtistList key={`${mode}|${q}`} groups={groups} mode={mode} q={q} />
          <DiscogsAttribution href={discogsSearchUrl(q)} />
        </section>
      ) : null}

      {data && selected ? (
        <section className="x-section" aria-labelledby="albums-h">
          {groups.length > 1 ? (
            <Link className="link x-link-block" href={{ pathname: "/search", query: { mode, q } }}>
              {t("otherArtists")}
            </Link>
          ) : null}
          <h2 id="albums-h">{selected.artist ? t("albumsBy", { artist: selected.artist }) : t("albumsTitle")}</h2>
          <div className="x-result-grid">
            {selected.entries.map((e) => (
              <AlbumCard key={e.key} entry={e} query={{ q, mode }} />
            ))}
          </div>
        </section>
      ) : null}

      {data && groups.length > 0 ? (
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
