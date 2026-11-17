"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { albumsBackQuery, contextQuery, parseFinder, parseMaster } from "@/lib/finder-state";
import type { FacetValue, VersionsPage, VersionSummary } from "@/lib/discogs/types";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/ds/Button";
import { ChevronLeftIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";
import { DiscogsAttribution } from "../DiscogsAttribution";
import { Cover, Problem, ResultSkeleton, Stepper } from "./parts";
import { usePaged } from "./use-discogs";
import { replaceParams } from "./url-state";

const FILTER_KEYS = ["country", "released", "label"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** "Load more" pressings: the page count goes into the URL, so Back from a release card shows the same list. */
const rememberVersionPages = (page: number) => replaceParams({ vp: page > 1 ? String(page) : null });

const mergeVersions = (prev: VersionsPage, next: VersionsPage): VersionsPage => {
  const seen = new Set(prev.versions.map((v) => v.id));
  return { ...next, versions: [...prev.versions, ...next.versions.filter((v) => !seen.has(v.id))] };
};

function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: FacetValue[];
  onChange: (value: string) => void;
}) {
  // Keep the active choice selectable even if the narrowed facet list no longer contains it.
  const list = value && !options.some((o) => o.value === value) ? [{ value, count: 0 }, ...options] : options;
  return (
    <div className="field x-filter">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="select-wrap">
        <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{allLabel}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.count ? `${o.value} (${o.count})` : o.value}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function PressingCard({ v, context }: { v: VersionSummary; context: Record<string, string> }) {
  const t = useTranslations("pressings");
  // The release card carries where we are (search, artist, filters, pages loaded), so its Back link can rebuild this page exactly.
  const href = { pathname: `/release/${v.id}`, query: context };
  return (
    <article className="card x-result">
      <Link href={href} className="x-result__media" tabIndex={-1} aria-hidden="true">
        <Cover src={v.thumb} />
      </Link>
      <div className="x-result__body">
        <h3 className="x-result__title">
          <Link href={href}>{[v.label, v.catno ? t("catno", { catno: v.catno }) : null].filter(Boolean).join(" · ") || v.title}</Link>
        </h3>
        <p className="x-result__meta">{[v.country, v.released, v.formats.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</p>
        <Link href={href} className="x-result__cta link">
          {t("open")}
        </Link>
        <DiscogsAttribution href={v.discogsUrl} />
      </div>
    </article>
  );
}

export function PressingsView({ masterId }: { masterId: number }) {
  const t = useTranslations("pressings");
  const f = useTranslations("finder");
  const params = useSearchParams();
  const router = useRouter();

  const fs = parseFinder(params);
  const master = parseMaster(params);
  const { a: artist, t: title, country, released, label } = master;

  const urlForPage = (page: number) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (country) qs.set("country", country);
    if (released) qs.set("released", released);
    if (label) qs.set("label", label);
    return `/api/discogs/masters/${masterId}/versions?${qs}`;
  };
  const paged = usePaged<VersionsPage>(urlForPage, mergeVersions, { wantPages: master.versionPages, onMore: rememberVersionPages });
  const { state, data } = paged;
  const facets = (data ?? paged.lastData)?.facets;

  // Change a filter and keep everything else we are carrying (search, artist, "show more" state). Read the CURRENT url at event
  // time, so two quick changes cannot overwrite each other with values captured at the previous render. A new filter set starts
  // again at the first page of pressings.
  const keep = (extra: Partial<Record<FilterKey, string | undefined>>) => {
    const now = new URLSearchParams(window.location.search);
    const m = parseMaster(now);
    for (const k of FILTER_KEYS) if (k in extra) m[k] = extra[k];
    return contextQuery(parseFinder(now), { ...m, versionPages: 1 });
  };
  const setFilter = (key: FilterKey, value: string) => router.replace({ pathname: `/master/${masterId}`, query: keep({ [key]: value || undefined }) }, { scroll: false });
  const hasFilter = Boolean(country || released || label);
  // Back to the albums of the SAME search: query, artist, the albums already shown, the loaded result pages. Without a search in the
  // address (a link from the lists, or a hand-typed one) there is nothing to rebuild, so it goes to the search start.
  const backQuery = fs.q ? albumsBackQuery(fs, master) : null;
  const releaseContext = contextQuery(fs, { ...master, versionPages: data?.page ?? master.versionPages });

  const stepLabels = (["track", "artist", "album", "pressing"] as const).map((k) => f(`steps.${k}`));

  return (
    <div className="container x-page x-finder">
      <Stepper current={3} label={f("stepsLabel")} steps={stepLabels} />
      <Link className="link x-link-block" href={backQuery ? { pathname: "/search", query: backQuery } : "/search"}>
        <ChevronLeftIcon /> {t("back")}
      </Link>
      <h1 className="x-finder__title">{title ? t("headingFor", { title }) : t("headingUnknown")}</h1>
      {artist ? <p className="x-lead">{t("by", { artist })}</p> : null}

      <fieldset className="x-filters" aria-label={t("filters")}>
        <FilterSelect id="f-country" label={t("country")} allLabel={t("all")} value={country ?? ""} options={facets?.country ?? []} onChange={(v) => setFilter("country", v)} />
        <FilterSelect id="f-year" label={t("year")} allLabel={t("all")} value={released ?? ""} options={facets?.released ?? []} onChange={(v) => setFilter("released", v)} />
        <FilterSelect id="f-label" label={t("label")} allLabel={t("all")} value={label ?? ""} options={facets?.label ?? []} onChange={(v) => setFilter("label", v)} />
        {hasFilter ? (
          <Button variant="ghost" size="sm" onClick={() => router.replace({ pathname: `/master/${masterId}`, query: keep({ country: undefined, released: undefined, label: undefined }) }, { scroll: false })}>
            {t("clear")}
          </Button>
        ) : null}
      </fieldset>

      {state.kind === "loading" ? <ResultSkeleton label={f("steps.pressing")} /> : null}
      {state.kind !== "loading" && state.kind !== "ok" && state.kind !== "idle" ? <Problem state={state} onRetry={paged.retry} /> : null}

      {data && data.versions.length === 0 ? (
        <StatusMessage tone="info" title={t("emptyTitle")}>
          {t("emptyText")}
        </StatusMessage>
      ) : null}

      {data && data.versions.length > 0 ? (
        <section aria-label={t("count", { count: data.totalItems })}>
          <p className="x-note" aria-live="polite">
            {t("count", { count: data.totalItems })}
          </p>
          <div className="x-result-grid">
            {data.versions.map((v) => (
              <PressingCard key={v.id} v={v} context={releaseContext} />
            ))}
          </div>
        </section>
      ) : null}

      {data && data.versions.length > 0 ? (
        <div className="x-more">
          {data.incomplete ? (
            <p className="x-note" role="note">
              {f("incomplete")}
            </p>
          ) : null}
          {paged.moreProblem ? <Problem state={paged.moreProblem} onRetry={paged.loadMore} compact /> : null}
          {data.hasMore ? (
            <Button variant="outline" loading={paged.loadingMore} onClick={paged.loadMore}>
              {f("loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
