# Data model: designed to survive both Discogs ToU outcomes

Status: **proposal for review before milestone 2.** Nothing below is implemented yet except the auth tables
(`user`, `session`, `account`, `verification`, `rate_limit`) in `drizzle/0000_init_auth.sql`.

The open question is whether the Discogs API Terms of Use allow us to **keep Discogs content** (release
metadata, images) beyond a short window. Developer reports mention a 6-hour limit; this is **not yet verified
against the official text**. The schema below is shaped so that the answer changes only one table.

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

discogs_cache                   -- replaces `api_cache`; every Discogs response, TTL-bound
  key         text PK            -- 'search:track:<normalised q>:<page>', 'versions:<master>:<filters>:<page>',
                                 -- 'release:<id>', 'master:<id>'
  payload     jsonb NOT NULL
  fetched_at  timestamptz NOT NULL
  expires_at  timestamptz NOT NULL      -- fetched_at + DISCOGS_CACHE_TTL_SECONDS (one constant, default 6h)
  INDEX (expires_at)
```

* **Moving between lists** is a single `UPDATE user_items SET list = $1 WHERE id = $2 AND user_id = $3`.
* **Account deletion** removes every `user_items` row through the foreign key; nothing else holds user data.
* **Display data** (title, artists, cover, tracklist...) is never read from `user_items`. It always comes from
  `getRelease(id)`, which reads `discogs_cache` and falls back to the (throttled) Discogs API.
* **Expired rows are deleted, not just ignored.** A purge (opportunistic on write plus a Vercel Cron) removes rows
  past `expires_at`. This matters only if the ToU forbids keeping content, but it is cheap, so it runs in both outcomes.

## Outcome A: ToU allows keeping release metadata long term

Add the `releases` table from your original brief (normalised columns + `raw` jsonb, `fetched_at`) and read lists
from it. `user_items.discogs_release_id` already equals `releases.discogs_id`, so **`user_items` does not change**;
a foreign key can be added later with a one-line migration. Lists then keep working when Discogs is slow or down,
and a background refresh keeps rows current. `discogs_cache` remains for search and versions responses.

## Outcome B: ToU limits how long Discogs content may be kept (e.g. 6 hours)

No `releases` table. Lists are `user_items` joined, in application code, with `getRelease(id)` for each row on the
page. Consequences you should know about:

| Concern | Effect |
| --- | --- |
| Cold list views | One Discogs call per uncached item. At 60 requests/minute shared by ALL users, a 200-item list is ~3+ minutes of budget when cold. |
| Mitigations | Paginate lists (e.g. 24 per page); resolve missing items lazily with skeletons; the cache is shared across users, so popular pressings are fetched once per TTL window. |
| Degraded mode | When throttled or Discogs is down, a list row shows only what we are allowed to keep: the user's own notes/condition plus a "Details are loading" state and a link to the release on discogs.com. |
| Search within a list | By artist/title is **not possible** from `user_items` alone (we hold no titles). It would work only on cached items. Sorting by date added works; sorting by artist/year works only for resolved items. |
| Offline resilience | Lists do not "keep working even if Discogs is slow" beyond what is in cache. This is the main product trade-off of Outcome B. |

## Two product decisions I need from you (before milestone 4)

1. **One list at a time?** Your brief says unique on `(user_id, release_id, list)`, which lets the same pressing sit in
   both Wishlist and Collection. I recommend `UNIQUE (user_id, discogs_release_id)` instead: a pressing is either
   wanted or owned, and "Move to Collection" is then a plain `UPDATE`. Tell me if you want both lists to allow the same item.
2. **If Outcome B applies,** are you fine with the list search/sort limits above?

## Why not decide now

I will not build `releases`, image storage or any retention beyond `discogs_cache` until the full ToU text has been
checked. Milestone 2 builds only `discogs_cache`, the throttled client and the image proxy; the `releases` table is
added only if Outcome A is confirmed.
