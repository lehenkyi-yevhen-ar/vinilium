# Performance and the Discogs budget

Measured 2026-11-18 on the development machine (Windows, 16 threads), with `tests/unit/performance-budget.test.ts` (a fake Discogs with 25 ms
of latency per call, an embedded Postgres) and a production build. **What is measured and what is not:** call counts are exact and are what
matters (the shared Discogs budget is about 60 requests a minute for everyone); times are against a fake server with one fixed latency on a
fast local database, so they show the shape (serial versus concurrent, cold versus warm), not what a visitor will feel. Real latency to
Discogs, Neon and a phone network was **not measured**.

## Discogs calls and time per screen (cold = nothing cached, warm = cached)

| Screen | Discogs calls cold | Calls warm | Upstream JSON | Time cold | Time warm |
| --- | --- | --- | --- | --- | --- |
| Search, one page of results | 1 | 0 | 2.3 KB (20 hits) | ~75-100 ms | ~2 ms |
| Albums step: 12 masters | 12 (concurrency 4) | 0 | 0.9 KB | ~130 ms | ~2 ms |
| Pressings list (one page of 40) | 1 | 0 | 4.4 KB | ~45 ms | ~1 ms |
| Release card | 1 | 0 | 1.1 KB (12 tracks) | ~45 ms | ~1 ms |
| List page, 24 releases (large page size) | 24 | 0 | 25 KB | ~220 ms | ~3 ms |
| List page, next page of 12 | 12 (only its own records) | 0 | 12.6 KB | ~120 ms | |
| A whole finder journey (search, albums, pressings, card) | **15** | **0** | 8.6 KB | ~270 ms | ~9 ms |

Reading it: a person who searches, opens an album, a pressing and a card spends 15 calls from the shared budget of about 60 a minute, and a Back
or a reload within the cache lifetime (4 h) spends none. A cold list page of 24 costs 24, which is why a person is limited to 24 cold fetches a
minute and an IP to 30 cold requests (`docs/operations.md`, section 17). A list page of 12 (the default) costs 12.

The budgets in the test fail the build if a screen starts costing more calls (exact), or if a time ceiling is passed (a serial loop or a lost
cache).

## Client JavaScript

Production build, all routes together: 24 script chunks, **977 KB raw, about 303 KB gzipped** in total; no route loads all of it. The
largest chunks: 71 KB gz (React and the Next.js runtime), 48 KB gz, 39 KB gz, 30 KB gz, 29 KB gz. The design system adds 10 KB gz of script and
14 KB gz of CSS (static files, cached for a day). Not measured: per-route "first load" sizes (Next.js 16's build does not print them) and real
loading time on a phone.

Avoidable weight that was **not** removed (it would change behaviour and was out of scope for a hardening run):

* The four auth forms import Zod for two or three fields each. Plain validation functions would very likely save a noticeable part of those
  pages' JavaScript (Zod 4 is a large library for this use); **how much was not measured**.
* Nothing else stood out: the dependency list has no chart or editor libraries, no date libraries and no icon packs (icons are inline SVG
  components); the Resend SDK is a server dependency only.

## Images and layout shift

Thumbnails come through the image proxy (`/api/discogs/image`) with `Cache-Control` bounded by the cache lifetime. Every cover image is
`loading="lazy" decoding="async"` (`src/components/finder/parts.tsx`) and falls back to a placeholder when it fails; the release card's cover has
`aspect-ratio: 1` (`src/app/ds-extensions.css`). Whether the small thumbnails in result lists reserve their space before they load was **not
checked**, and **Cumulative Layout Shift was not measured** in a real browser in this run: the e2e suites assert that nothing overflows sideways
but do not read the CLS metric. `sizes` attributes are not used (the images are small fixed-size thumbnails, not responsive sources).

## Counters in production

One `[metrics]` line a minute per busy instance: Discogs calls, cache hits and misses, throttles, cap hits and upstream errors
(`docs/operations.md`, section 19). That is the way to see the real cost of the screens above once people use the site.
