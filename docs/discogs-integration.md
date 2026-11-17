# Discogs integration

How the app talks to Discogs, and the contract the UI builds on. Licensing questions that are still open live in
[discogs-compliance.md](discogs-compliance.md); data retention options in [data-model.md](data-model.md).

## Request path

```
browser -> /api/discogs/*  -> guard() (refuses cross-site requests; requires sign-in; our per-IP + per-user limit, rate_limit table)
                           -> service  (cache lookup in discogs_cache; hit = no Discogs call)
                           -> client   (shared token bucket -> fetch -> read X-Discogs-Ratelimit* -> 429 backoff)
                           -> normalize (field WHITELIST) -> cache (TTL) -> JSON
browser -> /api/discogs/image?u=  -> guard() -> allow-list check -> IMAGE bucket (own budget) -> stream, nothing stored
```

| File | Role |
| --- | --- |
| `src/lib/discogs/normalize.ts`, `group.ts`, `types.ts` | Pure and client-safe: whitelist mapping, dedupe, group by artist, `mergeGroups` for "load more". |
| `src/server/discogs/credentials.ts` | key + secret preferred over token. |
| `src/server/discogs/token-bucket.ts` | Pure bucket maths + Postgres persistence (row lock, one row per API origin). |
| `src/server/discogs/client.ts` | HTTP, auth + `User-Agent`, retry/backoff/jitter, `throttled` outcome. |
| `src/server/discogs/cache.ts` | `discogs_cache` read/write, TTL (max 6 h), purge on every write + cron. |
| `src/server/discogs/service.ts` | `searchDiscogs`, `getMasterVersions`, `getRelease` (cache-through). |
| `src/server/discogs/image.ts` | Allow-list, redirect handling, streaming proxy. |
| `src/server/rate-limit.ts` | Our own fixed-window limiter (`rate_limit` table, keys `app:...`). |

## Response contract

Success: `{ "data": <SearchPage | VersionsPage | ReleaseDetail>, "cached": boolean, "fetchedAt": ISO-8601 }`
(types in `src/lib/discogs/types.ts`). Errors: `{ "error", "scope"?, "retryAfter"?, "message"? }`.

| Status | `error` | `scope` | Meaning for the UI |
| --- | --- | --- | --- |
| 429 | `throttled` | `discogs` | Discogs' budget is used up. Show "busy, retrying in `retryAfter` s" and retry; the `Retry-After` header repeats it. |
| 429 | `rate_limited` | `app` | This visitor sent too many requests. Same countdown, different wording. |
| 401 | `unauthorized` | | Not signed in (or the session ended). Show "Sign in to search". |
| 403 | `forbidden` | | The browser says the request came from another site. Our endpoints serve our own pages only. |
| 400 | `bad_request` | | Invalid input (UI bug or tampering). |
| 404 | `not_found` | | No such release / master. |
| 502 | `upstream` | | Discogs failed or sent something unexpected. |
| 503 | `unconfigured` | | No Discogs credentials in this environment. |

### Search specifics

* Every mode searches **vinyl releases**: `type=release&format=Vinyl` plus `track=<q>` (mode `track`), `artist=<q>` (`artist`) or
  `release_title=<q>` (`album`). `by=<artist>` adds `artist=<by>` to a track or album search. See "Why vinyl releases" below.
* Results are grouped by artist (first-appearance order = Discogs' relevance order). Releases that share a master collapse
  into ONE `kind: "master"` entry (`mergedHits` says how many vinyl releases matched); `master_id = 0` stays a standalone
  vinyl `kind: "release"` entry. Open a master with `/masters/:id/versions` (also vinyl-only).
* An entry's title/year/cover are those of ONE release until the master record is resolved (`GET /api/discogs/masters?ids=`, at
  most 12 per call, cached per master); the albums step resolves only the albums it shows.
* Pages are bounded (search 5, versions 10, 50 per page). `hasMore` = the next page may be requested; `incomplete` =
  not everything Discogs matched is on screen (more pages exist, even beyond our cap). **When `incomplete` is true the UI must
  say that results may be incomplete.**
* Append a "load more" page with `mergeGroups(previous.groups, next.groups)`.
* `thumb` / `cover` are same-origin proxy URLs (or `null`), never discogs.com URLs. **The Terms require** the
  `DiscogsAttribution` link (`discogsUrl`) directly next to every block of Discogs data, and that no block older than 6 h
  (`fetchedAt`) is shown. See the checklist in `discogs-compliance.md`.

## What is deliberately not here

* No `releases` table, no stored images, no price or marketplace data (stripped by the whitelist, asserted by tests).
* No anonymous access: search, versions, release and images require sign-in (owner decision, 2026-11-16).
* No thundering-herd protection: two simultaneous cold requests for the same key both call Discogs (the bucket still caps
  the total). Add a Postgres advisory lock per key if this shows up in practice.
* Token acquisition costs a short Postgres transaction per Discogs call (about five round trips). Negligible next to the
  Discogs call itself when the app and database share a region; it could be collapsed into one SQL statement if needed.

## Versions filters and facets

`GET /api/discogs/masters/:id/versions?country=&released=&label=` passes Discogs' own filters (`released` is a four-digit
year). The response carries `facets` (options for the three dropdowns, from Discogs' `filter_facets`, for the current
filtered result set) and `filters` (what was applied). Each filter set is cached separately.

## Images have their own budget

Thumbnails are fetched through `/api/discogs/image` from a separate token bucket (300 per minute shared by all users, plus
the per-IP and per-user limits), so a page of 50 thumbnails never uses up the 60-per-minute API allowance. A 429 from the
image host blocks images only. The image host sends no `X-Discogs-Ratelimit*` headers (observed 2026-11-16).

## Why vinyl releases, grouped by master (evidence from the real API, 2026-11-16)

Bug report: a popular track exists both as a SINGLE and on an ALBUM by the same artist. Searching it and choosing the artist
showed ONE card, a CDr promo single, and not the album. What the real API returned (counts are real; names are left out):

| Query | Result | Finding |
| --- | --- | --- |
| `type=release&track=<track>` (the old query) | 804 hits, 17 pages. Page 1: 50 releases, 40 not vinyl. 9 by the artist, **all in the single's master**. | No vinyl filter, and the album's master is not on page 1. The card's data came from the first release (a CDr promo). |
| `type=release&track=<track>&artist=<artist>&format=Vinyl` | 21 hits, 21 vinyl, 4 masters including **the album's**. | The release-level format filter is reliable. |
| `type=release&track=<track>&format=Vinyl` | 173 hits over 4 pages, all vinyl (the album included). | Works without the artist too. |
| `type=master&q=<title>&format=Vinyl` | 33 masters, **none by that artist**. | A master's `format` is its main release's (the album's was a digital release), so masters cannot be filtered by medium. |
| `type=master&track=<track>` | works, but its `format` is the same unreliable field. | Not used. |
| `/masters/{id}` | title, year, artists, images, and also `lowest_price` / `num_for_sale`. | Authoritative album data; the price fields are stripped by the whitelist. |
| `/masters/{id}/versions?format=Vinyl` | 14 pressings (one is a Box Set, which can contain LPs). | The versions filter is reliable. |
| artist search, vinyl releases | 394 hits over 8 pages; page 1 holds 26 distinct masters and 5 standalone releases. | Enough to list albums; "load more" and the incomplete note cover the rest. |

So: all three modes use vinyl RELEASE searches grouped by master, the response is also checked client-side (a hit without
Vinyl in its format list is dropped), album titles come from the master record, and versions are always `format=Vinyl`.
Facet values arrive form-encoded (`Port+Esme%2C+Calder%2C+%26+Vane` style) and are decoded for display and for the filter.

Typical cost of the corrected flow with the artist chosen from the list: 1 search + 2 masters (the artist's two albums) +
1 versions + 1 release = **5 Discogs calls** (6 with a filter change). With an artist typed and 3 masters among the first 12
albums: 1 search + 3 masters + 1 versions = 5. Cached results cost nothing for 4 hours.

Honest limits: a search page holds 50 releases, so a very common title can match more artists than the first pages show
(`incomplete`, "load more", the artist field and the artist filter exist for that). Vinyl releases without a master (often
unofficial) are listed apart, in a collapsed section after the albums.

## Test fixtures

Everything in `tests/fixtures` is **synthetic**: invented artists, titles, ids, years, formats and countries, with the SHAPE
of the real responses (`vinyl.ts` models the bug above with an invented artist, a single and an album). No Discogs response
is stored in git. If you record real responses for your own investigation, keep them in `tests/fixtures/_local-recordings/`,
which is git-ignored.
