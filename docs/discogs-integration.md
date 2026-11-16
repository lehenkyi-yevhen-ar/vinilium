# Discogs integration

How the app talks to Discogs, and the contract the UI builds on. Licensing questions that are still open live in
[discogs-compliance.md](discogs-compliance.md); data retention options in [data-model.md](data-model.md).

## Request path

```
browser -> /api/discogs/*  -> guard() (refuses cross-site browser requests; our per-IP + per-user limit, rate_limit table)
                           -> service  (cache lookup in discogs_cache; hit = no Discogs call)
                           -> client   (shared token bucket -> fetch -> read X-Discogs-Ratelimit* -> 429 backoff)
                           -> normalize (field WHITELIST) -> cache (TTL) -> JSON
browser -> /api/discogs/image?u=  -> guard() -> allow-list check -> bucket (25% reserve) -> stream, nothing stored
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
| 403 | `forbidden` | | The browser says the request came from another site. Our endpoints serve our own pages only. |
| 400 | `bad_request` | | Invalid input (UI bug or tampering). |
| 404 | `not_found` | | No such release / master. |
| 502 | `upstream` | | Discogs failed or sent something unexpected. |
| 503 | `unconfigured` | | No Discogs credentials in this environment. |

### Search specifics

* `mode=track` -> `track=<q>&type=release`; `mode=artist` -> `artist=<q>&type=master`; `mode=master` -> `q=<q>&type=master`.
* Results are grouped by artist (first-appearance order = Discogs' relevance order). Releases that share a master collapse
  into ONE `kind: "master"` entry (`mergedHits` says how many raw hits); `master_id = 0` stays a standalone
  `kind: "release"` entry. Open a master with `/masters/:id/versions`.
* Pages are bounded (search 5, versions 10, 50 per page). `hasMore` = the next page may be requested; `incomplete` =
  not everything Discogs matched is on screen (more pages exist, even beyond our cap). **When `incomplete` is true the UI must
  say that results may be incomplete.**
* Append a "load more" page with `mergeGroups(previous.groups, next.groups)`.
* `thumb` / `cover` are same-origin proxy URLs (or `null`), never discogs.com URLs. **The Terms require** the
  `DiscogsAttribution` link (`discogsUrl`) directly next to every block of Discogs data, and that no block older than 6 h
  (`fetchedAt`) is shown. See the checklist in `discogs-compliance.md`.

## What is deliberately not here

* No `releases` table, no stored images, no price or marketplace data (stripped by the whitelist, asserted by tests).
* No sign-in requirement on search/images (see compliance doc, owner decision c).
* No thundering-herd protection: two simultaneous cold requests for the same key both call Discogs (the bucket still caps
  the total). Add a Postgres advisory lock per key if this shows up in practice.
* Token acquisition costs a short Postgres transaction per Discogs call (about five round trips). Negligible next to the
  Discogs call itself when the app and database share a region; it could be collapsed into one SQL statement if needed.
