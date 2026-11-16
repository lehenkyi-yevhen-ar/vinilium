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
| 3 | Content must not be shown if **more than 6 hours** older than on discogs.com. | Paraphrase of an archived copy, reported by two issues. | Cache TTL for API data AND images. | One constant `DISCOGS_CACHE_TTL_SECONDS` (default 6 h) for everything. Not built yet (milestone 2). |
| 4 | Do not **store content longer than needed**. | Paraphrase, same sources. | Whether `releases` / `cover_path` may exist. | No `releases` table and no `cover_path`. Images are streamed through a proxy only. See `docs/data-model.md`. |
| 5 | Two data classes: **CC0 data** and **Restricted Data** (marketplace data: pricing, sales history, inventory, and release images posted with offers). Restricted Data may not be transferred to third parties or used commercially. | Search excerpt of the official page (partial). | We must not request or show marketplace/price data; image handling needs care. | We use only `/database/search`, `/masters/{id}/versions`, `/releases/{id}`. Strip any marketplace/price fields from stored or displayed payloads (to implement in milestone 2). |
| 6 | **Commercial use** is allowed generally but can be barred at Discogs' discretion; using the API to drive traffic to **other non-Discogs sites** is reported as prohibited commercial use. | Search excerpt + one issue quoting. | No ads, paid plans, affiliate or "buy elsewhere" links (you confirmed none in v1). | None planned. |
| 7 | Descriptive **User-Agent** on every request; authenticated rate limit is 60 requests/minute per token (shared by all our users). Image requests require authentication and are rate limited. | Discogs developer docs (public). | Throttling, queue, image proxy. | Milestone 2. |
| 8 | A user's **collection** data is Restricted user data. | One issue's interpretation. | Not applicable: our lists live in our database and are the user's own entries, not Discogs collection data. | Re-check wording once the full text is available. |

## Questions the full text must answer

1. Exact attribution wording and whether the link must go to the specific release/master/artist page.
2. Is 6 hours a cap on **storing** content, on **displaying** it, or both? Does it apply to images and to IDs?
3. May we keep the normalised release metadata of items a user has explicitly added to their own list?
4. Are release images "Restricted Data", and may our proxy cache them (CDN `Cache-Control`) for up to the TTL?
5. Is a public, free, ad-free service in scope without special permission?
