# Data model (Discogs Terms checked: Outcome B applies)

**Terms verified 2026-11-16 (see `discogs-compliance.md`): Outcome B applies.** Content may not be displayed when more than 6 h older
than on discogs.com and may not be stored longer than necessary, so no long-term `releases` table. Status after milestone 2: implemented are the auth tables, `rate_limit` (shared with our own limiter, whose keys are
prefixed `app:`), `discogs_cache` and `discogs_bucket` (shared token bucket), in `drizzle/0000_*.sql` and
`drizzle/0001_*.sql`; `user_items` (the Wishlist/Collection entries, UNIQUE per user and release, ON DELETE CASCADE) in `drizzle/0002_*.sql`. `releases` is NOT built and will not be. **Decided:** one list per pressing
(`UNIQUE (user_id, discogs_release_id)`), so "Move" is a single `UPDATE`.

The question was whether the Discogs API Terms of Use allow us to **keep Discogs content** (release metadata, images)
beyond a short window. The official text answers it: no (6-hour display limit, no storing longer than necessary). The
schema was shaped so that this answer changes only one table, and that table is simply not built.

## What stays identical in both outcomes

```
user_items                      -- the user's own data. Never contains Discogs content.
  id                  uuid PK
  user_id             text  NOT NULL  -> user.id  ON DELETE CASCADE
  discogs_release_id  bigint NOT NULL            -- just the Discogs ID, no FK to a releases table
  list                text  NOT NULL  CHECK (list IN ('wishlist','collection'))
  notes               text
  condition_media     text            -- collection only (Goldmine grades: M, NM, VG+, ...)
  condition_sleeve    text            -- collection only
  added_at            timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()
  UNIQUE (user_id, discogs_release_id)           -- see "One list at a time" below
  INDEX  (user_id, list, added_at DESC)

discogs_cache                   -- BUILT. Replaces `api_cache`; every Discogs response, TTL-bound
  key         text PK            -- 'v1|<api origin>|search|mode=..&page=..&q=..', '...|versions|master=..&page=..',
                                 -- '...|release|id=..' (origin-scoped: a test mock never shares rows with the real API)
  payload     jsonb NOT NULL     -- OUR normalised, whitelisted shape, never the raw Discogs response
  fetched_at  timestamptz NOT NULL
  expires_at  timestamptz NOT NULL      -- fetched_at + DISCOGS_CACHE_TTL_SECONDS (one constant, default 6h)
  INDEX (expires_at)

discogs_bucket                  -- BUILT. Shared token bucket: one row per API origin
  id text PK, tokens, capacity, refill_per_sec, updated_at, blocked_until,
  observed_limit, observed_remaining, observed_at     -- what Discogs reported in X-Discogs-Ratelimit headers
```

* **Moving between lists** is a single `UPDATE user_items SET list = $1 WHERE id = $2 AND user_id = $3`.
* **Account deletion** removes every `user_items` row through the foreign key; nothing else holds user data.
* **Display data** (title, artists, cover, tracklist...) is never read from `user_items`. It always comes from
  `getRelease(id)`, which reads `discogs_cache` and falls back to the (throttled) Discogs API.
* **Expired rows are deleted, not just ignored.** Reads never return a row past `expires_at`; a purge deletes them
  (on every cache write, plus `GET /api/cron/purge` called hourly by Vercel Cron as a backstop, see `vercel.json`). The Terms require this ("no longer than necessary").

## Outcome A: ToU allows keeping release metadata long term (RULED OUT by the Terms; kept for reference)

Add the `releases` table from your original brief (normalised columns + `raw` jsonb, `fetched_at`) and read lists
from it. `user_items.discogs_release_id` already equals `releases.discogs_id`, so **`user_items` does not change**;
a foreign key can be added later with a one-line migration. Lists then keep working when Discogs is slow or down,
and a background refresh keeps rows current. `discogs_cache` remains for search and versions responses.

## Outcome B: ToU limits how long Discogs content may be kept (6 hours): THIS IS THE ONE

No `releases` table. Lists are `user_items` joined, in application code, with `getRelease(id)` for each row on the
page. Consequences you should know about:

| Concern | Effect |
| --- | --- |
| Cold list views | One Discogs call per uncached item. At 60 requests/minute shared by ALL users, a 200-item list is ~3+ minutes of budget when cold. |
| Mitigations | Paginate lists (e.g. 24 per page); resolve missing items lazily with skeletons; the cache is shared across users, so popular pressings are fetched once per TTL window. |
| Degraded mode | When throttled or Discogs is down, a list row shows only what we are allowed to keep: the user's own notes/condition plus a "Details are loading" state and a link to the release on discogs.com. |
| Search within a list | By artist/title is **not possible** from `user_items` alone (we hold no titles). It would work only on cached items. Sorting by date added works; sorting by artist/year works only for resolved items. |
| Offline resilience | Lists do not "keep working even if Discogs is slow" beyond what is in cache. This is the main product trade-off of Outcome B. |

## Product decisions (milestone 4)

1. ~~One list at a time?~~ **Decided: yes.** `UNIQUE (user_id, discogs_release_id)`; "Move" is one `UPDATE`.
2. **Confirmed 2026-11-16 for the MVP:** list search/sort only on `added_at`, notes and condition. Lists are paginated (12-24 per
   page), fetch only the visible page, load progressively with skeletons, and handle a throttled state per item without
   breaking the page. `user_items` already exists (milestone 3 uses it for the Add buttons); the list screens are milestone 4.

## Why there is no `releases` table

The Terms forbid showing Content older than 6 h and storing it longer than necessary, so nothing beyond `discogs_cache`
(TTL-bound, purged) holds Discogs content, and no image is stored. `user_items` keeps Discogs release IDs and the user's
own data only.
