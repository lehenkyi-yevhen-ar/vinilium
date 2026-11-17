# Discogs API Terms of Use: compliance tracker

**Source: the full text of the Terms, pasted by the project owner on 2026-11-16** ("Last Updated: May 27th, 2025"; the
support article is dated July 23, 2025). Every rule below is therefore **verified from source text** unless a row says
otherwise. Short quotes are verbatim. This is an engineering reading of the Terms, not legal advice.

What the pasted text does **not** contain, and what is therefore still unverified: the documents it refers to
(*API Specifications*, *Database Guidelines* section 13 on images, *Application Name and Description Policy*, the Help
Center), and anything Discogs changes later ("We may at any time revise the TOU", with notice "via account email or
otherwise": keep the Discogs account email monitored and re-read the Terms periodically).

Status legend: **Done** = implemented and tested. **Done, residual risk** = implemented, a gap is described.
**UI obligation** = cannot be met until the screens exist (milestone 3+). **Owner** = a decision or action for the owner.

## Rules and where the code meets them

| # | Rule (verbatim) | Section | Status | How we meet it |
| --- | --- | --- | --- | --- |
| 1 | Display *"This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC."* "prominently on Your application and any other public-facing use". | Discogs Intellectual Property | **Done** (fixed 2026-11-16: the earlier text was a paraphrase and did not match) | Footer on every page and on the Contact page, verbatim and in English in all three languages (`footer.discogsNotice`, `lang="en"`). Unit test compares the string; e2e checks it on `/uk`. |
| 2 | *"Data provided by Discogs."* "directly next to any data You use from the Discogs API", with "a hyperlink to the discogs.com page that includes the data", not using "any mechanism that prevents passing along search engine ranking credit ... such as 'nofollow'". | Discogs Intellectual Property | **Done** (component) / **UI obligation** (placement) | `DiscogsAttribution` renders the phrase with its period; `rel="noopener noreferrer"` only (no nofollow/sponsored/ugc; e2e asserts it). Every result carries `discogsUrl` for its own page. **Every block of Discogs data in the UI must render the component next to it** (checklist below). |
| 3 | "You may not display in any format or to any audience the Content if it is more than six (6) hours older than the information on Our online properties". | API Use and Restrictions | **Done** | Default TTL 14 400 s (4 h, owner decision 2026-11-16) and a hard cap of 21 600 s (`MAX_CONTENT_AGE_SECONDS`): the env var cannot raise it past 6 h. The image proxy's `Cache-Control` uses the same TTL. API responses carry `fetchedAt`, and the UI re-fetches anything that reaches 5.5 h on screen. That leaves a margin of about 2 h for data served at the end of its TTL. |
| 4 | "You may not cache or store the Content longer than is necessary to provide a service to Your application’s users." | API Use and Restrictions | **Done, residual risk** | Only a TTL cache (`discogs_cache`); expired rows are deleted on **every cache write** and by an hourly cron backstop (`/api/cron/purge`); no `releases` table; images are streamed, never stored; our lists hold Discogs **IDs** plus the user's own data. Residual: on a quiet site expired rows wait for the cron (hourly; daily on Vercel Hobby). They are never served. |
| 5 | Restricted Data = "Discogs User Data" (username, user images, collection, wantlist, ...), "Marketplace Data" ("pricing, release images posted in connection with offers for sale, and sales history") and "Images" (release, artist, label and user images). Licence: "limited, personal, non-sublicensable, non-transferable, non-exclusive, revocable ... to create and run websites and applications". Not allowed: "Transfer Restricted Data to any third party", "Use Restricted Data for any commercial purposes". | API Use and Restrictions | **Done** (conditional) | We call only `/database/search`, `/masters/{id}/versions`, `/releases/{id}` and never read user, collection, wantlist or marketplace data. The normaliser is a field **whitelist**, so price/marketplace fields never reach cache or UI (unit + e2e assert it). **Images are Restricted Data**: showing them inside our own free, non-commercial app falls under the licence as we read it; we proxy and never store them, and the proxy refuses browser requests that come from other sites (no hotlinking). **Condition: the app must stay non-commercial.** The licence is revocable. |
| 6 | CC0 Data: "Release titles, notes, dates, format, track listings, barcodes and other identifiers, credits, versions, URL links ...", artist names, label names. | Description of Content | **Done** | We show titles, artists, labels, formats, track listings, barcodes/matrix identifiers, dates and versions. Country, genres and styles are not in the CC0 list but are not in a Restricted category either. The 6-hour and no-storage rules are written about "the Content" generally, so we apply them to CC0 data too (the conservative reading). |
| 7 | Prohibited commercial uses include: "Selling or giving to any third party Our API, the Content, or access to Our API or the Content"; "Charging a fee to use or access any part of Your application that integrates with Our API or the Content if we provide that access to users free of charge"; "Using Our API or the Content with the intent to drive traffic to other non-Discogs websites or services". Also: no Restricted Data "with a third-party advertising or marketing platform". | API Use and Restrictions | **Done by design** / **Owner** | The app is free with no ads, paid plans, donations or affiliate links (owner decision, now also a hard requirement because images are Restricted Data). Never add "buy elsewhere", streaming or marketplace links derived from Discogs data. The Contact page links only to our own email/Telegram (not Content). On "giving ... access": every `/api/discogs/*` endpoint now requires sign-in (owner decision 2026-11-16), refuses cross-site browser requests and is rate limited per IP and per user. |
| 8 | "You will not ... Attempt to or actually circumvent Our rate limits, such as by creating additional API keys to overcome these limits." Discogs "may apply rate limits". | API Use and Restrictions | **Done** | One credential set is used at a time (key + secret preferred over token); the shared token bucket follows the limit Discogs reports (60/min observed). Never create extra keys or rotate between them to gain throughput. |
| 9 | No "automated systems designed to access, analyze, or scrape" outside the Terms; no replicating or duplicating Content. | API Use and Restrictions | **Done** | Requests happen only on user demand; page sizes and page counts are capped (search 5 pages, versions 10 pages of 50); results are cached only for the TTL; there is no crawler, bulk export or background sync. |
| 10 | Access can be revoked, charged for or discontinued "at any time and for any reason ... without prior notice"; the API and Content may be modified or discontinued. | API Access and Termination; Modifications | **Owner** (risk) | The app degrades with explicit states (`throttled`, `upstream`, `unconfigured`) instead of failing. Lists store IDs only, so nothing of ours is lost if access ends. Keep the Discogs account email monitored. |
| 11 | "You must be at least 18 years of age" in the United States to access the API and Content; the developer must "provide accurate identification data". | Preamble; User Account | **Owner** | Applies to the person who owns the Discogs developer account and keys. |
| 12 | "Combine Your application or website code with Our API in a way (such as using a software license) that is incompatible with the TOU". | API Use and Restrictions | **Owner** | No conflict today. Re-check when a licence for our code is chosen (the design system's own code licence is also still undecided). |
| 13 | Application name and description must follow Discogs' "Application Name and Description Policy". | Discogs Intellectual Property | **Not verified** | The policy was not provided. "Vinilium" does not contain the Discogs mark; confirm against the policy before launch. |

Not in the Terms (earlier assumptions, now known to come from elsewhere or to be unverified): the 60 requests/min figure and
the requirement to authenticate image requests (the Terms only say Discogs "may apply rate limits"; see "Observed
behaviour" for what the real API did) and the descriptive `User-Agent` (kept as good practice).

## Answers to the open questions

1. **Attribution wording and link.** Exact wording above. The link goes to "the discogs.com page that includes the data",
   so each item links to its own release/master page, not the homepage.
2. **Is 6 h a cap on storing or displaying?** Displaying is explicit (6 h). Storing is limited to "longer than is
   necessary to provide a service" (no number). It reads as covering "the Content" in general, including images. It says
   nothing about IDs; we keep only IDs, because a list cannot work without them.
3. **May we keep normalised metadata of listed items?** **No, not as a long-term copy.** What we show must be at most 6 h old and
   stored no longer than necessary, so a `releases` table would have to be refreshed before display, which is just the TTL
   cache. **Outcome B in `data-model.md` applies**; Outcome A is ruled out.
4. **Are images Restricted Data, may the proxy cache them?** Yes, "Images" are Restricted Data. Short `Cache-Control` up to the
   TTL is consistent with "no longer than necessary" and the 6 h rule; we store nothing. The Terms say nothing about
   authenticating image requests.
5. **Is a free, ad-free public service in scope?** Yes: "Commercial use ... is generally permitted", and a free non-commercial
   app is the clearest case. No special permission is mentioned; Discogs keeps "sole discretion" and may revoke.

## Per-block attribution checklist (UI obligation for milestone 3+)

Render `<DiscogsAttribution href={discogsUrl} />` directly next to: each search result group or card, each master/version
list, each release page, each list row that shows Discogs data. The footer link alone does not satisfy rule 2.
Never put `nofollow`, `sponsored` or `ugc` on it. Do not show a block whose `fetchedAt` is more than 6 h old (re-fetch).

## Changes made after reading the Terms (2026-11-16)

* Footer notice replaced by the prescribed sentence (verbatim, English, all locales); also shown on the Contact page.
* Attribution text now ends with the period given in the Terms.
* `DISCOGS_CACHE_TTL_SECONDS` is capped at 21 600 in code; it can no longer be set above 6 h.
* Expired cache rows are deleted on every cache write (was: about 2% of writes).
* Browser requests marked `Sec-Fetch-Site: cross-site` are refused (403) by all `/api/discogs/*` endpoints, so other sites cannot
  embed our proxy or call it from their pages.

* Search, versions, release and image endpoints require sign-in (401 otherwise); the landing page and Contact page stay public.
* Default TTL lowered to 4 h (cap stays 6 h).
* Images now have their **own** budget (300 per minute across all users, plus the per-IP and per-user limits). Observed: the
  image host sends no `X-Discogs-Ratelimit*` headers, and a page of thumbnails drawing from the API bucket would have starved
  API calls. A 429 from the image host blocks images only.
* Milestone 3 screens render a "Data provided by Discogs." link next to every block of Discogs data (checklist above).
* Milestone 4 (lists): every list card that shows Discogs data renders its own attribution link to that release's discogs.com
  page; the "no longer on Discogs" placeholder shows no Discogs data, so it carries none. The page's Discogs data is re-fetched
  at 5.5 h (`REFRESH_AFTER_MS`). The export contains the user's own fields only (ids, list, notes, condition, dates): no Discogs
  content is ever handed out as a file. A release Discogs reports as 404 is remembered for one hour (an absence, not Content).

## Owner decisions (2026-11-16)

a. **Lists under Outcome B: confirmed for the MVP.** List search/sort only on `added_at`, notes and condition; lists paginated
   at 12-24 per page; only the visible page is fetched; progressive loading with skeletons; throttled state per item without
   breaking the page. (Built in milestone 4.)
b. **TTL: 4 h default, 6 h cap.** Done.
c. **Sign-in required for search and images.** Done, with a clear "Sign in to search" state.
d. **Attribution** next to every block of Discogs data, enforced screen by screen. Done for milestone 3.

* Test fixtures are SYNTHETIC (invented names, ids and data of the same shape); no real Discogs response is stored in git. Local recordings go in the git-ignored `tests/fixtures/_local-recordings/`.

## Still open

* **Application name policy** (rule 13): not provided, so "Vinilium" is unchecked against it.
* **Account email monitoring** (rule 10) and the developer's age/ownership (rule 11).
* Server-side scripts that hold a valid session can still call the endpoints; the per-user rate limits are the control for that.
