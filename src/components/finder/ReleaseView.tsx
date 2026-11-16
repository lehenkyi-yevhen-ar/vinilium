"use client";

import { useTranslations } from "next-intl";
import type { ReleaseDetail } from "@/lib/discogs/types";
import { Link } from "@/i18n/navigation";
import { ChevronLeftIcon } from "@/ds/icons";
import { DiscogsAttribution } from "../DiscogsAttribution";
import { ListActions } from "./ListActions";
import { Cover, PanelSkeleton, Problem, Stepper } from "./parts";
import { useDiscogs } from "./use-discogs";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** Step 4 result: the release card. Every block of Discogs data has its own "Data provided by Discogs." link. */
export function ReleaseView({ releaseId }: { releaseId: number }) {
  const t = useTranslations("release");
  const f = useTranslations("finder");
  const { state, retry } = useDiscogs<ReleaseDetail>(`/api/discogs/releases/${releaseId}`);
  const r = state.kind === "ok" ? state.data : null;
  const stepLabels = (["track", "artist", "album", "pressing"] as const).map((k) => f(`steps.${k}`));

  return (
    <div className="container x-page x-finder">
      <Stepper current={4} label={f("stepsLabel")} steps={stepLabels} />
      {r?.masterId ? (
        <Link className="link x-link-block" href={{ pathname: `/master/${r.masterId}`, query: { t: r.title, ...(r.artist ? { a: r.artist } : {}) } }}>
          <ChevronLeftIcon /> {t("backToPressings")}
        </Link>
      ) : (
        <Link className="link x-link-block" href="/search">
          <ChevronLeftIcon /> {t("backToSearch")}
        </Link>
      )}

      {state.kind === "loading" ? <PanelSkeleton label={f("steps.pressing")} /> : null}
      {state.kind !== "loading" && state.kind !== "ok" && state.kind !== "idle" ? <Problem state={state} onRetry={retry} /> : null}

      {r ? (
        <article className="x-card x-release">
          <div className="x-release__head">
            <Cover src={r.cover ?? r.thumb} className="x-release__cover" />
            <div>
              <h1 className="x-finder__title">{r.title}</h1>
              {r.artist ? <p className="x-lead">{t("by", { artist: r.artist })}</p> : null}
              <dl className="x-facts" aria-label={t("details")}>
                {r.released || r.year ? <Detail label={t("released")}>{r.released ?? r.year}</Detail> : null}
                {r.country ? <Detail label={t("country")}>{r.country}</Detail> : null}
                {r.labels.length ? (
                  <Detail label={t("label")}>{r.labels.map((l) => (l.catno ? `${l.name} (${l.catno})` : l.name)).join(", ")}</Detail>
                ) : null}
                {r.formats.length ? (
                  <Detail label={t("format")}>
                    {r.formats.map((x) => [x.qty > 1 ? `${x.qty}×` : "", x.name, x.descriptions.length ? `(${x.descriptions.join(", ")})` : ""].filter(Boolean).join(" ")).join(", ")}
                  </Detail>
                ) : null}
                {r.genres.length ? <Detail label={t("genres")}>{r.genres.join(", ")}</Detail> : null}
                {r.styles.length ? <Detail label={t("styles")}>{r.styles.join(", ")}</Detail> : null}
              </dl>
              <DiscogsAttribution href={r.discogsUrl} />
            </div>
          </div>

          <ListActions releaseId={r.id} />

          <section className="x-section" aria-labelledby="tracks-h">
            <h2 id="tracks-h">{t("tracklist")}</h2>
            {r.tracklist.length ? (
              <ol className="x-tracks x-plain-list">
                {r.tracklist.map((tr, i) => (
                  <li key={i} className={tr.type === "heading" ? "x-tracks__heading" : undefined}>
                    <span className="x-tracks__pos">{tr.position}</span>
                    <span className="x-tracks__title">{tr.title}</span>
                    {tr.duration ? <span className="x-tracks__time">{tr.duration}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="x-note">{t("noTracks")}</p>
            )}
            <DiscogsAttribution href={r.discogsUrl} />
          </section>

          {r.identifiers.length ? (
            <section className="x-section" aria-labelledby="ids-h">
              <h2 id="ids-h">{t("identifiers")}</h2>
              <dl className="x-facts">
                {r.identifiers.map((x, i) => (
                  <Detail key={i} label={x.type}>
                    {x.value}
                  </Detail>
                ))}
              </dl>
              <DiscogsAttribution href={r.discogsUrl} />
            </section>
          ) : null}

          <p>
            <a className="link" href={r.discogsUrl} target="_blank" rel="noopener noreferrer">
              {t("viewOnDiscogs")}
            </a>
          </p>
        </article>
      ) : null}
    </div>
  );
}
