# Discogs API Terms of Use: compliance tracker

**Verification status: NOT VERIFIED against the official text.** The official page
(<https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use>) returned HTTP 403 to automated
fetches and archived copies were blocked. Everything below comes from search excerpts and from public GitHub issues
of other apps that quote or paraphrase the Terms. Treat each row as a claim to check, not as a rule.
Once the full text is pasted, this file is rewritten with verbatim clauses and each row is marked verified.

| # | Rule (as reported) | Source quality | Affects us how | What we do now |
| --- | --- | --- | --- | --- |
| 1 | Show **"Data provided by Discogs"** as a link to the matching discogs.com page, **directly next to** Discogs data (per data block, not only a footer). | Quoted in one third-party issue (asuteau/sillon #43); not verified. | Every search result list, release card, list view. | `DiscogsAttribution` component exists (footer now); it must be rendered next to every Discogs data block from milestone 3. Link target is passed per block. The phrase is kept in English in all locales until the exact wording is confirmed. |
| 2 | A **non-affiliation** notice ("not affiliated with, sponsored or endorsed by Discogs"). | Proposed wording in third-party issues, marked "to confirm". | Footer / about. | Footer notice present in all 3 languages. |
| 3 | Content must not be shown if **more than 6 hours** older than on discogs.com. | Paraphrase of an archived copy, reported by two issues. | Cache TTL for API data AND images. | **Built (M2):** one constant `DISCOGS_CACHE_TTL_SECONDS` (default 21600 s) drives cache rows (`discogs_cache.expires_at`) and the image proxy's `Cache-Control`. Expired rows are never served and are purged. Whether 6 h is right, and whether it also governs images, waits for the text. |
| 4 | Do not **store content longer than needed**. | Paraphrase, same sources. | Whether `releases` / `cover_path` may exist. | **Built (M2):** no `releases` table, no `cover_path`, nothing written to disk. Images are streamed through the proxy and never stored by us. See `docs/data-model.md`. |
| 5 | Two data classes: **CC0 data** and **Restricted Data** (marketplace data: pricing, sales history, inventory, and release images posted with offers). Restricted Data may not be transferred to third parties or used commercially. | Search excerpt of the official page (partial). | We must not request or show marketplace/price data; image handling needs care. | **Built (M2):** only `/database/search`, `/masters/{id}/versions`, `/releases/{id}` are called. Normalisation is a field WHITELIST (`src/lib/discogs/normalize.ts`), so price/marketplace fields (`lowest_price`, `num_for_sale`, `price`, `blocked_from_sale`, `estimated_weight`, community stats) never reach the cache or the UI; unit tests and the e2e flow assert this. |
| 6 | **Commercial use** is allowed generally but can be barred at Discogs' discretion; using the API to drive traffic to **other non-Discogs sites** is reported as prohibited commercial use. | Search excerpt + one issue quoting. | No ads, paid plans, affiliate or "buy elsewhere" links (you confirmed none in v1). | None planned. |
| 7 | Descriptive **User-Agent** on every request; authenticated rate limit is 60 requests/minute per token (shared by all our users). Image requests require authentication and are rate limited. | Discogs developer docs (public). | Throttling, queue, image proxy. | **Built (M2):** Postgres token bucket shared by all instances; limit read from `X-Discogs-Ratelimit*` headers (not hard-coded); 429 -> backoff + jitter, then a `throttled` state with `retryAfter`; descriptive `User-Agent`; image proxy with exact host allow-list. |
| 8 | A user's **collection** data is Restricted user data. | One issue's interpretation. | Not applicable: our lists live in our database and are the user's own entries, not Discogs collection data. | Re-check wording once the full text is available. |

## Questions the full text must answer

1. Exact attribution wording and whether the link must go to the specific release/master/artist page.
2. Is 6 hours a cap on **storing** content, on **displaying** it, or both? Does it apply to images and to IDs?
3. May we keep the normalised release metadata of items a user has explicitly added to their own list?
4. Are release images "Restricted Data", and may our proxy cache them (CDN `Cache-Control`) for up to the TTL?
5. Is a public, free, ad-free service in scope without special permission?


## Implementation status (end of milestone 2)

| Area | State |
| --- | --- |
| API client, throttling, retry/backoff, cache + TTL, purge | Built and tested (unit, mocked e2e, one real smoke test). |
| Search / versions / release endpoints, marketplace-field stripping | Built and tested. |
| Own rate limits (per IP and per user) | Built; per-user path unit-tested only (no signed-in e2e yet). |
| **Image proxy** | Built (allow-list, streaming, TTL-bound `Cache-Control`, no storage) but **NOT final**: see below. |
| Attribution next to every data block, non-affiliation notice | Component + footer notice exist; per-block placement happens when the UI is built (M3+). |

## Choices that still depend on the Terms text

Nothing below is finalised. Each is isolated behind one constant or one function so the answer is a small change.

1. **TTL value and scope.** `DISCOGS_CACHE_TTL_SECONDS` (default 6 h, no hard cap in code). If the Terms say 6 h is a cap on *displaying*, on *storing*, or both, and whether it covers IDs, images and our own derived grouping, this value (and possibly the purge cadence) changes.
2. **Images.** (a) May we proxy-cache them at all, and for how long (`Cache-Control` currently = the TTL, `public`)? (b) Are release images "Restricted Data"? (c) Must we authenticate image requests? (d) Do image requests count toward the 60/min limit? Today thumbnails draw from the same bucket as API calls but may only use 75% of it (`IMAGE_RESERVE_FRACTION`). See `src/server/discogs/image.ts`.
3. **The `releases` table / any retention beyond the TTL.** Not built, by instruction. `docs/data-model.md` shows both outcomes.
4. **Normalised metadata kept for items on a user's list.** Depends on question 3 of the list above.
5. **Which fields we show.** Tracklist, identifiers (barcode / matrix) and the `released` date are kept; if any is Restricted or not covered by the licence, it is dropped in `normalizeRelease`.
6. **Attribution wording and link target** (`DiscogsAttribution`, per data block).
7. **Anonymous access.** Search and images are public (rate limited by IP). If the Terms or the shared 60/min budget argue for sign-in only, that is a one-line change in `guard()`.

## Observed behaviour (from running against the real API, NOT from the Terms)

Recorded on 2026-11-16 with an app key + secret (`Authorization: Discogs key=..., secret=...`):

* Search, release fetch and image fetch all worked with key + secret authentication.
* `X-Discogs-Ratelimit: 60`, with `X-Discogs-Ratelimit-Remaining` counting down (59, 58, ...). The client adopts the reported limit; nothing is hard-coded.
* Responses from the image host `i.discogs.com` carry **no** `X-Discogs-Ratelimit*` headers, and a test request **without** credentials was also served (HTTP 200). This does not prove images are exempt from limits or free of an authentication requirement, only what one request showed; the Terms decide.
* The image host answered with `Cache-Control: public, max-age=31536000` (one year). Our proxy deliberately replaces it with the TTL.
