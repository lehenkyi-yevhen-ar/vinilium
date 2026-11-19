# 0003. No stored Discogs content: a TTL cache, a proxy, lists of ids

**Status:** accepted (Discogs API Terms of Use read in full on 2026-11-16).

## Context

The Terms forbid showing Content that is more than 6 hours older than on discogs.com, forbid storing it longer than necessary, restrict
images, and forbid giving third parties access to it. The service is free and non-commercial.

## Decision

* **No `releases` table.** A user's lists (`user_items`) store only the Discogs release id and the user's own fields (list, notes, condition,
  dates). Everything else is fetched for the visible page only.
* **A TTL cache**, `discogs_cache`: our own normalised, whitelisted shape (never the raw response, never price or marketplace fields),
  `expires_at = fetched_at + DISCOGS_CACHE_TTL_SECONDS` (default 4 h, hard cap 6 h in code). Expired rows are never served and are deleted on
  every cache write and by the daily purge. The client re-fetches a list page's Discogs data at 5.5 h.
* **No stored images.** Images go through an authenticated, SSRF-hardened proxy (exact host allow-list, https only, no credentials, no IP
  literals, redirects re-validated, 8 MB cap, no SVG), streamed, with `Cache-Control` bounded by the same TTL.
* **Sign-in is required** for search and images; there are no public pages that show Discogs data and no sharing pages.
* The attribution "Data provided by Discogs." with a link sits next to every block of Discogs data; the exact non-affiliation notice is in
  the footer of every page.

## Consequences

* A cold list page costs one Discogs call per uncached record (12 or 24); a warm one costs none. Lists cannot be searched by title or artist,
  because those are Discogs content.
* If Discogs is down or throttled, lists still show the user's own notes and condition with a "waiting" or "no longer on Discogs" state.
* Every rule maps to code and a test in `docs/discogs-compliance.md`; a change that weakens one is not accepted.
