# Vinilium

Find vinyl pressings, keep a wishlist and a collection. Next.js (App Router) + TypeScript, Neon Postgres + Drizzle,
Better Auth, `next-intl` (uk / en / nb), and the **Ліс** design system. Discogs is used read-only as a data source.

> Status: **Milestone 1 of 5** (scaffold, design system, i18n, Neon + migrations, auth). Search, lists and the
> Discogs client arrive in later milestones. See [docs/data-model.md](docs/data-model.md) and
> [docs/discogs-compliance.md](docs/discogs-compliance.md).

## Placeholders to replace before launch

Everything below is a **placeholder** and is flagged here on purpose:

| What | Where | Placeholder |
| --- | --- | --- |
| App name | `NEXT_PUBLIC_APP_NAME` | `Vinilium` |
| Public domain | `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL` | `http://localhost:3000` |
| Contact for Discogs (`User-Agent`) | `APP_CONTACT` | `https://example.com/contact` |
| Public contact email / Telegram (contact page, privacy policy) | `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_TELEGRAM` | `contact@example.com` / `https://t.me/your_handle` (set in `.env.local`, never in the repo) |
| Email sender | `EMAIL_FROM` | `Vinilium <onboarding@resend.dev>` (Resend sandbox: only delivers to your own Resend account email) |
| Translations | `src/messages/{uk,nb}.json` | Written by an AI model; have a native speaker review them |
| Legal pages (privacy, terms) | not written yet | Planned for milestone 5; footer carries Discogs attribution only |

## Requirements

Node.js 22+ (developed on 24) and npm.

## Setup

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run db:migrate              # applies drizzle/*.sql to DATABASE_URL
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon **pooled** connection string (`...-pooler...`, `sslmode=require`). |
| `BETTER_AUTH_SECRET` | yes | 32+ random chars: `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public origin, no trailing slash. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | When both are set, the Google button appears. Redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google`. |
| `RESEND_API_KEY` | prod | Empty in dev: verification and reset links are **printed to the server console**. In production, a missing key throws. |
| `EMAIL_FROM` | no | Needs a verified domain in Resend before launch. |
| `APP_CONTACT` | no | Sent to Discogs in the `User-Agent`. **Once the production domain exists, set it to the URL of the contact page: `https://<domain>/en/contact`** (the English page: Discogs staff read English, and every locale serves the same page). Until then it stays a placeholder. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | yes (before launch) | Public contact address shown on `/<locale>/contact` and used by the privacy policy as the contact for personal-data requests. Visible in the browser by design. If missing or invalid, the page says contact details are not set up. |
| `NEXT_PUBLIC_CONTACT_TELEGRAM` | no | `@handle` or a `t.me` link. Invalid values are dropped. **Unset = the Telegram line is hidden.** |
| `DISCOGS_TOKEN` | no | Personal access token (`Authorization: Discogs token=...`). Server-only. Used only if the key/secret pair below is not set. |
| `DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET` | one of the two styles | App credentials (`Authorization: Discogs key=..., secret=...`). Set both or neither. **Preferred over `DISCOGS_TOKEN` when both are set.** Server-only. |
| `DISCOGS_CACHE_TTL_SECONDS` | no | The ONE TTL for everything cached from Discogs (cache rows and the image proxy's `Cache-Control`). Default `14400` (4 h); **maximum** `21600` (6 h): the Discogs Terms forbid showing older Content, so larger values are capped. |
| `CRON_SECRET` | prod | 16+ chars. Protects `GET /api/cron/purge`; the endpoint is disabled without it. Vercel Cron sends it automatically. |
| `RL_SEARCH_IP_PER_MIN`, `RL_SEARCH_USER_PER_MIN`, `RL_IMAGE_IP_PER_MIN`, `RL_IMAGE_USER_PER_MIN` | no | Our own request limits (defaults 30 / 60 / 300 / 600). |
| `DISCOGS_API_BASE` | never | Tests only: points the client at the mock server. Do not set in a real environment. |

Only `NEXT_PUBLIC_*` variables reach the browser, and none of them is a secret. `.env*` is git-ignored except
`.env.example`.

### Database and migrations

Schema lives in `src/server/db/schema.ts`; migrations are committed in `drizzle/`.

```bash
npm run db:generate   # after changing the schema: writes a new SQL migration
npm run db:migrate    # applies pending migrations to DATABASE_URL
npm run db:studio     # optional: browse data
```

The auth tables mirror what the Better Auth CLI generates for this configuration (checked by generating a
reference schema), plus `user.locale` and a database-backed `rate_limit` table.

### Scripts

`npm run dev | build | start | lint | typecheck | test | test:e2e | discogs:smoke`

## How it is put together

* **Routing / i18n**: every URL carries its locale (`/uk`, `/en`, `/nb`). `src/proxy.ts` (Next 16's `middleware`)
  negotiates it; the choice is remembered in a cookie and, for signed-in users, on `user.locale`. All strings are in
  `src/messages/*.json` (a test enforces identical keys and placeholders across languages). Every page and layout must
  call `resolveLocale(params)` (or `setRequestLocale`) so server components render in the right language.
* **Auth**: Better Auth with email + password (verification required, password reset) and Google. Sessions are rows in
  Postgres. Auth endpoints are rate limited, stored in Postgres so it works across serverless instances.
* **Design system**: the Ліс files are vendored **unmodified** into `public/ds/` (see
  `vendor/lis-design-system/VENDOR.md`). `src/ds/` holds thin typed React wrappers over the system's own CSS classes.
  The upstream React layer needs a global `React`, which a bundled Next app does not have, so it is not used; only its
  vanilla behaviour (`bundle.js`: dropdowns, modals, tabs) is loaded. `DS.init(scope)` wires only the **descendants**
  of `scope`, so put refs on a wrapper, not on the `.dd` / `.modal` element itself. `src/app/ds-extensions.css` holds the
  few things the system lacks (status messages, empty states, skip link) and uses design tokens only.
* **Next.js 16 notes**: `cacheComponents` is off (we cache in Postgres and read the session on most routes);
  `experimental.globalNotFound` is on, because a root layout under `/[locale]` cannot compose a normal 404.

## The finder (milestone 3)

Signed-in users find a pressing in four steps, all in `src/components/finder/`:

| Screen | URL | What happens |
| --- | --- | --- |
| 1-3 Track, Artist, Album | `/<locale>/search?mode=track\|artist\|album&q=&artist=` | Search by track (or by artist / album name as a fallback), pick the artist (long lists can be filtered by typing), pick the album. A track that matches nothing offers to retry as an artist or album. |
| 4 Pressing | `/<locale>/master/<id>` | Pressings of the album, filtered by country, year and label (Discogs' own filters and facets). |
| Release card | `/<locale>/release/<id>` | Details, tracklist, barcodes/matrix, and **Add to Wishlist / Add to Collection** (real list API, one list per pressing; "Move" is one update). |

Visitors who are not signed in see a "Sign in to search" state on these URLs (the landing page and Contact page stay public).
Every block of Discogs data carries its own "Data provided by Discogs." link. Throttled, failed or unconfigured calls show a
message (with a countdown and automatic retry when throttled) instead of breaking the page, and thumbnails that fail show a
placeholder. Lists themselves (browse, search, notes, condition) are milestone 4.

## Discogs integration (milestone 2)

Server code is in `src/server/discogs/`, shared pure code (types, normalisation, grouping) in `src/lib/discogs/`.
Details and the open licensing questions: [docs/discogs-integration.md](docs/discogs-integration.md),
[docs/discogs-compliance.md](docs/discogs-compliance.md).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/discogs/search?q=&mode=track\|artist\|master&page=` | Search, grouped by artist and deduped (max 5 pages of 50). **Sign-in required** (all `/api/discogs/*`). |
| `GET /api/discogs/masters/:id/versions?page=&country=&released=&label=` | Pressings of a master (max 10 pages of 50), with filter facets. |
| `GET /api/discogs/releases/:id` | One release. |
| `GET /api/discogs/image?u=` | Image proxy (exact Discogs image hosts only, streamed, never stored). |
| `GET\|PUT\|DELETE /api/lists/items/:releaseId` | The signed-in user's wishlist / collection entry for one pressing (`PUT {"list":"wishlist"\|"collection"}` adds or moves). |
| `GET /api/cron/purge` | Deletes expired cache rows. Needs `Authorization: Bearer $CRON_SECRET`. |

* **Credentials**: `DISCOGS_CONSUMER_KEY` + `DISCOGS_CONSUMER_SECRET` win over `DISCOGS_TOKEN` when both are set.
* **Throttling**: one Postgres token bucket shared by all instances. The limit is read from Discogs' own
  `X-Discogs-Ratelimit*` headers (60/min was observed with a key + secret); before the first response it assumes a
  conservative 25. A 429 is retried with exponential backoff and jitter; if the wait is long the API answers
  `429 {"error":"throttled","scope":"discogs","retryAfter":N}` (plus a `Retry-After` header) so the UI can show a countdown.
  Anonymous callers get `401 unauthorized`. Our own per-IP / per-user limit answers `429 {"error":"rate_limited","scope":"app",...}`.
* **Purge cadence**: `vercel.json` runs the purge hourly. **Vercel's Hobby plan only allows daily cron jobs**, so change
  the schedule to once a day there (expired rows are never served either way, and every cache write also deletes expired rows).
* **Client IP** for the limiter comes from `x-vercel-forwarded-for` / `x-forwarded-for` / `x-real-ip` and only valid IPs
  are accepted. That is trustworthy behind Vercel; if you self-host, put a proxy in front that overwrites these headers.
* **Local gotcha (Windows / some ISPs)**: if requests to `i.discogs.com` time out (`UND_ERR_CONNECT_TIMEOUT`) while
  `api.discogs.com` works, your machine has a broken IPv6 route. Start with `NODE_OPTIONS=--dns-result-order=ipv4first`.
* **Real-API check**: `npm run discogs:smoke` makes one search, one release fetch and one image request with your real
  credentials, prints the rate-limit numbers Discogs reports, and deletes the cache rows it created.

## Tests

```bash
npm test            # unit tests (Vitest): messages, auth links, Discogs normalisation/grouping, token bucket,
                    # client backoff, cache TTL + purge, limiter, image host allow-list. Uses PGlite (embedded
                    # Postgres running the real migrations): no database or secrets needed.
npm run test:e2e    # Playwright: shell smoke tests, the Discogs + lists APIs, and the finder UI (desktop and phone
                    # viewport) against a MOCKED Discogs server; a verified e2e user is created and deleted automatically
                    # (FAKE credentials, no real token). The Discogs flow needs a real Postgres: it uses DATABASE_URL
                    # (from .env.local, or a throwaway Neon branch in CI) and SKIPS when none is set. It removes its rows afterwards.
```

## Deploying to Vercel + Neon (summary; full walkthrough in milestone 5)

1. Create a Neon project; copy the **pooled** connection string into `DATABASE_URL`.
2. Run `npm run db:migrate` once against it.
3. Import the repo into Vercel; set the variables above for Production (and Preview if wanted).
4. Set `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` to the production origin and add the Google redirect URI.
5. Verify a sending domain in Resend and set `EMAIL_FROM` and `RESEND_API_KEY`.
6. Set `NEXT_PUBLIC_CONTACT_EMAIL` (and optionally `_TELEGRAM`), then set `APP_CONTACT=https://<domain>/en/contact`.
7. Google Cloud console > Google Auth Platform > Branding: use the same address as **User support email** (it must be an
   address on your Google account or a Google Group you manage; if your project address is neither, create a Group with that
   address) and as a **Developer contact information** email. App home page: `https://<domain>`. Privacy policy link:
   `https://<domain>/en/privacy` once that page exists (not needed while the app is in Testing mode, required to publish).
   Authorised domain: the production domain.

## Credits and licences

Interface: [Ліс design system](https://github.com/lehenkyi-yevhen-ar/lis-design-system). Fonts: Ermilov (free to use) and
KyivType Sans (CC BY-ND 4.0: do not modify or convert the files; credit is shown in the footer). Release data and
images: Discogs. This app is not affiliated with or endorsed by Discogs.
