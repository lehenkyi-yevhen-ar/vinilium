# Vinilium

Find vinyl pressings, keep a wishlist and a collection. Next.js (App Router) + TypeScript, Neon Postgres + Drizzle,
Better Auth, `next-intl` (uk / en / nb), and the **Ліс** design system. Discogs is used read-only as a data source.

> Status: feature-complete for the current scope (sign-in, the finder, Wishlist and Collection, privacy and terms drafts), and hardened in
> the 2026-11 run. Start with [docs/architecture.md](docs/architecture.md), then [docs/operations.md](docs/operations.md). The rules that
> must never be weakened are in [docs/discogs-compliance.md](docs/discogs-compliance.md); what is stored about people is in
> [docs/data-inventory.md](docs/data-inventory.md); the threats considered are in [docs/threat-model.md](docs/threat-model.md); the open
> decisions are in [docs/decisions-needed.md](docs/decisions-needed.md) and the launch list in [docs/pre-launch-checklist.md](docs/pre-launch-checklist.md).
> Contributing and security reports: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md).

## Project status

**What works** (tested in CI on Chromium, desktop and a phone emulation, plus the unit suite; the owner has also checked Safari and a real phone):
sign-up and sign-in with email + password and with Google; email verification and password reset (through Brevo); the finder (track, artist,
album, pressing, release card) in Ukrainian, English and Norwegian, in a dark and a light theme; the Wishlist and the Collection with notes and condition,
export (CSV, JSON, and "download my data") and account deletion; a health route, a daily purge, security headers and a Content-Security-Policy.

**Limited by design:**

* **Discogs terms come first.** Record details are fetched by the server with the service's own credentials, cached for at most 4 hours (never above 6), and
  **never stored as a copy**: the database holds only Discogs release numbers plus the person's own notes, grades and dates. Searching and looking at record details
  **needs a sign-in**. The attribution notice and "Data provided by Discogs." are shown as the terms ask ([docs/discogs-compliance.md](docs/discogs-compliance.md)).
  Discogs can limit or withdraw access at any time; the lists, accounts and export keep working without it.
* **Free and non-commercial:** no advertising, payments, donations, affiliate links or tracking; two cookies (session, language) and two localStorage keys (a help flag, the theme).
* **Run by one person**, on free plans (Vercel Hobby, Neon, Brevo's free 300 emails a day). Mail from a free-mail sender often lands in spam: accepted, and the pages say so.

**Known and unverified** (nothing here is hidden; each item is in [docs/LAUNCH.md](docs/LAUNCH.md) with what to do):

* The privacy policy and terms were **prepared by the operator without professional legal advice**; they are checked against the code and public sources
  ([docs/legal-accuracy-review.md](docs/legal-accuracy-review.md)), which is not a lawyer's review, and some passages still carry a `[NEEDS LEGAL REVIEW]` mark.
* The Ukrainian and Norwegian texts are AI-written and wait for a native speaker ([docs/i18n/review-uk-nb.csv](docs/i18n/review-uk-nb.csv)).
* The Content-Security-Policy defaults to **report-only** (which mode the live site runs is for the owner to confirm: the smoke test reports it); HSTS is off by default; the Google sign-in app is in Testing mode (an unexplained,
  accepted observation about test users is recorded in [docs/decisions-needed.md](docs/decisions-needed.md)).
* Firefox on desktop and a real Android phone have not been tested by anyone; WebKit and Firefox only run signed-out smoke tests on a developer machine.
* The GitHub Actions workflows were checked locally and on pull requests; the Vercel, Neon and Brevo dashboards and plans were not inspected by the agent (every
  dashboard step in the docs says so).
* `npm run smoke:prod` ([scripts/smoke-prod.ts](scripts/smoke-prod.ts)) is the anonymous, read-only check of the live site; the owner runs it.

## Placeholders to replace before launch

Everything below is a **placeholder** and is flagged here on purpose:

| What | Where | Placeholder |
| --- | --- | --- |
| App name | `NEXT_PUBLIC_APP_NAME` | `Vinilium` |
| Public domain | `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL` | `http://localhost:3000` |
| Contact for Discogs (`User-Agent`) | `APP_CONTACT` | `https://example.com/contact` |
| Public contact email / Telegram (contact page, privacy policy) | `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_TELEGRAM` | `contact@example.com` / `https://t.me/your_handle` (set in `.env.local`, never in the repo) |
| Email sender | `EMAIL_FROM` | Your validated sender address. With **Brevo** and a free-mail sender, Brevo replaces the From address with its own (`brevosend.com`); replies are steered to `NEXT_PUBLIC_CONTACT_EMAIL` |
| Translations | `src/messages/{uk,nb}.json` | Written by an AI model; have a native speaker review them |
| Legal pages (privacy, terms) | `src/messages/*.json` > `legal.*` | Prepared by the operator **without professional legal advice** (a notice on both pages says so), checked against the code and public sources ([docs/legal-accuracy-review.md](docs/legal-accuracy-review.md)). Six open questions are marked `[NEEDS LEGAL REVIEW]` (list: `docs/legal-review-checklist.md`). The operator is shown as a private individual under `NEXT_PUBLIC_OPERATOR_NAME` (a project name or nickname), in `NEXT_PUBLIC_OPERATOR_COUNTRY` |

## Requirements

Node.js 22+ (developed on 24) and npm.

## Setup

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run db:migrate              # applies drizzle/*.sql to the DEV database (DEV_DATABASE_URL)
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DEV_DATABASE_URL` | **local: required** | Neon **pooled** connection string of the **dev branch**. The ONLY database `npm run dev`, the e2e tests and the `db:*` scripts will use. Without it they refuse to start. See "Two databases" below. |
| `DATABASE_URL` | production only | Neon **pooled** connection string of the **production branch**. Set it in **Vercel's environment variables**, NOT in your local `.env.local`. Used only when `NODE_ENV=production`. |
| `DEV_DATABASE_BRANCH`, `DATABASE_BRANCH` | no | Names (not secret) the safety guard prints next to the host, e.g. `dev` / `production`. |
| `BETTER_AUTH_SECRET` | yes | 32+ random chars: `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public origin, no trailing slash. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | When both are set, the Google button appears. Redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google`. |
| `EMAIL_PROVIDER` | no | `brevo` or `resend`. Unset = whichever key below is set (Brevo first). With no key at all, development **prints verification and reset links to the server console**; in production the send fails (logged as `[email] ... FAILED`, never printing the link). |
| `BREVO_API_KEY` | prod (Brevo) | Brevo transactional API key (server-only). Brevo is called over HTTPS (`api.brevo.com/v3/smtp/email`); no SMTP and no extra package. In Brevo, **do not enable the authorised-IP list**: Vercel's IP addresses change. |
| `RESEND_API_KEY` | prod (Resend) | Only if you switch to Resend (`EMAIL_PROVIDER=resend`), which needs a verified domain. |
| `EMAIL_FROM` | prod | The sender address, plain (`you@example.com`) or `Name <you@example.com>`. For Brevo it must be a sender you validated in Brevo; the app refuses to guess one. |
| `EMAIL_FROM_NAME` | no | Display name of the sender (default: the app name). |
| `AUTH_EMAIL_PASSWORD_ENABLED` | no | Default `true`. **`false` = Google sign-in only**: email + password sign-up, sign-in, verification resend and password reset are hidden and refused (`403 EMAIL_PASSWORD_DISABLED`); no emails are sent; the privacy and terms text follow. Use exactly `false`. Changing it needs a **Redeploy** in Vercel. |
| `AUTH_SIGNUP_ALLOWLIST` | no | Comma-separated emails. When set, only these can **sign up with email + password** (`403 SIGNUP_INVITE_ONLY` for anyone else). A brake on abuse: every sign-up sends an email and the free Brevo plan has a daily cap. Does not affect sign-in or Google. |
| `APP_CONTACT` | no | Sent to Discogs in the `User-Agent`. **Once the production domain exists, set it to the URL of the contact page: `https://<domain>/en/contact`** (the English page: Discogs staff read English, and every locale serves the same page). Until then it stays a placeholder. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | yes (before launch) | Public contact address shown on `/<locale>/contact` and used by the privacy policy as the contact for personal-data requests. Visible in the browser by design. If missing or invalid, the page says contact details are not set up. |
| `NEXT_PUBLIC_CONTACT_TELEGRAM` | no | `@handle` or a `t.me` link. Invalid values are dropped. **Unset = the Telegram line is hidden.** |
| `DISCOGS_TOKEN` | no | Personal access token (`Authorization: Discogs token=...`). Server-only. Used only if the key/secret pair below is not set. |
| `DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET` | one of the two styles | App credentials (`Authorization: Discogs key=..., secret=...`). Set both or neither. **Preferred over `DISCOGS_TOKEN` when both are set.** Server-only. |
| `DISCOGS_CACHE_TTL_SECONDS` | no | The ONE TTL for everything cached from Discogs (cache rows and the image proxy's `Cache-Control`). Default `14400` (4 h); **maximum** `21600` (6 h): the Discogs Terms forbid showing older Content, so larger values are capped. |
| `CRON_SECRET` | prod | 16+ chars. Protects `GET /api/cron/purge`; the endpoint is disabled without it. Vercel Cron sends it automatically. |
| `RL_SEARCH_IP_PER_MIN`, `RL_SEARCH_USER_PER_MIN`, `RL_IMAGE_IP_PER_MIN`, `RL_IMAGE_USER_PER_MIN` | no | Our own request limits (defaults 30 / 60 / 300 / 600). `RL_SEARCH_IP_PER_MIN` is the number of **cold** requests (ones that need a Discogs call) one IP may make a minute; requests answered from the cache (a browser Back, a reload) do not use it, and instead count against a flood ceiling of **4 times** that number for all requests from the IP. See "Search limits" in [docs/operations.md](docs/operations.md). |
| `RL_COLD_USER_PER_MIN` | no | Cold (uncached) Discogs lookups one person may cause per minute (default **24**: two cold pages of 12). Over it the screen shows "Waiting for Discogs" with a countdown. Why 24: Discogs allows ~60/min for the whole app, so two heavy users leave a fifth for everyone else. |
| `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_COUNTRY` | before launch | Who runs the service, shown in the privacy policy and terms. Unset = a visible `[... TO BE FILLED]` placeholder. |
| `CSP_MODE` | no | `report-only` (default) or exactly `enforce`: the Content-Security-Policy that `src/proxy.ts` sends with a nonce per page request. Anything else is report-only. Rollout and rollback: [docs/operations.md](docs/operations.md) section 10. |
| `NEON_WS_PROXY` | CI only | `host:port/v1` of Neon's websocket proxy, so the secret-free CI e2e job can use a plain Postgres container. Ignored for any `*.neon.tech` host. Never set it in a real environment. |
| `HSTS_MAX_AGE_SECONDS`, `HSTS_INCLUDE_SUBDOMAINS` | no | **Unset = no HSTS header.** Set only after the whole site is confirmed to work over HTTPS, and raise in steps (300, 86400, 31536000). `HSTS_INCLUDE_SUBDOMAINS=1` adds `includeSubDomains`. See [docs/operations.md](docs/operations.md). |
| `DISCOGS_API_BASE` | never | Tests only: points the client at the mock server. Do not set in a real environment. |

Only `NEXT_PUBLIC_*` variables reach the browser, and none of them is a secret. `.env*` is git-ignored except
`.env.example`.

### Two databases: dev and production

| Variable | Branch | Where it lives | Used by |
| --- | --- | --- | --- |
| `DEV_DATABASE_URL` | **dev** | local `.env.local` (and CI: a throwaway branch) | `npm run dev`, **all e2e runs**, `db:migrate`, `db:studio`, `db:status`, the real-API smoke test |
| `DATABASE_URL` | **production** | **Vercel's environment variables only** | only when `NODE_ENV=production`: the deployed server (a deliberate production migration: see below) |

**There is no fallback.** In development and test (`npm run dev`, `npm test`, e2e, every script) the database is
`DEV_DATABASE_URL` and nothing else: if it is not set, the process refuses to start or run, with a message that names the
variable. It never quietly uses `DATABASE_URL`. The rule lives in `src/lib/database-target.ts` and is shared by the app, the
scripts, `drizzle.config.ts`, Playwright and the tests. Local development, unit tests and e2e all work with ONLY
`DEV_DATABASE_URL` in `.env.local`, so production credentials never need to be on your machine.

Warning: a local `npm run build && npm start` runs in production mode and therefore wants `DATABASE_URL`. Do not put the
production string in `.env.local` for that: it fails with "DATABASE_URL is not set (production runtime)", which is the point.

**Safety guard.** Every script that touches a database prints its target first (variable, host, database, branch; **never the
user or password**) and then applies this rule:

| Command | Dev database | Production |
| --- | --- | --- |
| `db:migrate`, `db:studio` | runs | only with `--production` AND `DATABASE_URL` supplied for that one command (below) |
| e2e tests, `discogs:smoke` (create or delete test data) | runs | **refuses, always**; there is no flag |
| `db:status` | reads | reads (read-only), if `DATABASE_URL` is supplied |

A bare `npx drizzle-kit migrate` can only ever reach the dev database: `drizzle.config.ts` uses `DEV_DATABASE_URL` or, without
it, an address that cannot connect. If `DEV_DATABASE_URL` points at the same server as `DATABASE_URL`, everything refuses.
CI: set `DEV_DATABASE_URL` to a throwaway Neon branch; never give CI the production string.

**A deliberate production migration** (rare; take the string from Vercel's environment variables, and run the command in a shell
that is then closed or cleared). The guard prints the target (host, database, branch, never the password) and the
`--production` flag is the confirmation:

```powershell
# PowerShell
$env:DATABASE_URL = "<the production connection string>"
npm run db:migrate -- --production
Remove-Item Env:DATABASE_URL
```

```bash
# bash
DATABASE_URL="<the production connection string>" npm run db:migrate -- --production
```

Without `--production` the command targets the dev database (and stops if `DEV_DATABASE_URL` is missing); with `--production`
but without `DATABASE_URL` it stops with "DATABASE_URL is not set".

### Database and migrations

Schema lives in `src/server/db/schema.ts`; migrations are committed in `drizzle/`.

```bash
npm run db:generate   # after changing the schema: writes a new SQL migration
npm run db:migrate    # applies pending migrations to the DEV database (a production run is deliberate: see above)
npm run db:status     # READ-ONLY report: migrations applied and row counts (no hosts, no e-mails); production only if DATABASE_URL is supplied
npm run db:studio     # optional: browse data (guarded like db:migrate)
```

The auth tables mirror what the Better Auth CLI generates for this configuration (checked by generating a
reference schema), plus `user.locale` and a database-backed `rate_limit` table.

### Scripts

`npm run dev | build | start | lint | typecheck | test | test:e2e | discogs:smoke`

Also: `audit:prod` (fails on a high/critical advisory in production dependencies; used by CI), `audit:all`, `i18n:export` /
`i18n:import` (native-speaker review package), `legal:checklist` (privacy/terms review gate), `smoke:prod` (anonymous read-only check of the live site; you run it).

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
| 1-3 Track, Artist, Album | `/<locale>/search?mode=track\|artist\|album&q=&by=&g=` | **Vinyl pressings only.** Search by track (optionally narrowed by an artist), by artist, or by album title; pick the artist (long lists can be filtered by typing), then the album (12 at a time; each album's title, year and cover come from its master record). An empty result offers to retry as another kind of search. |
| 4 Pressing | `/<locale>/master/<id>` | Pressings of the album, filtered by country, year and label (Discogs' own filters and facets). |
| Release card | `/<locale>/release/<id>` | Details, tracklist, barcodes/matrix, and **Add to Wishlist / Add to Collection** (real list API, one list per pressing; "Move" is one update). |

Visitors who are not signed in see a "Sign in to search" state on these URLs (the landing page and Contact page stay public).
Every block of Discogs data carries its own "Data provided by Discogs." link. Throttled, failed or unconfigured calls show a
message (with a countdown and automatic retry when throttled) instead of breaking the page, and thumbnails that fail show a
placeholder.

## Wishlist and Collection (milestone 4)

`/<locale>/lists` (signed-in users; header link and phone tab bar), code in `src/components/library/`, rules shared by server and
screens in `src/lib/lists/`, queries in `src/server/lists/items.ts`.

* **What is stored**: `user_items` holds only the Discogs release id plus the user's own fields (list, notes, media/sleeve
  condition, added date). Nothing from Discogs, so nothing here is subject to the 6-hour rule.
* **Paging, sort and search work on stored fields only**: 12 or 24 per page; sort by added date, notes, or (Collection only)
  condition; search in notes and by grade (`vg+`). Titles and artists are NOT searchable, because they are Discogs content.
* **Discogs data for the visible page only**: one `GET /api/discogs/releases?ids=` (at most 24) per page view, served through the
  TTL cache. Per record the screen shows a skeleton while loading, "Waiting for Discogs" with an automatic retry (twice, then a
  button) when throttled, an error with a retry button when a single lookup failed, or a "No longer on Discogs" placeholder
  when Discogs says 404 (remembered for an hour). The user's own notes, condition, Move and Remove keep working in every state.
  The client refetches the page's Discogs data at 5.5 hours, inside the 6-hour display limit.
* **Optimistic UI with rollback**: editing notes, setting a grade, moving and removing update the screen at once; if the server
  refuses, the change is undone and the card says so. Remove always goes through a confirm modal.
* **Export**: `GET /api/lists/export?format=csv|json`: release ids, list, notes, condition and dates, nothing from Discogs.
  CSV cells that start with `= + - @` are defused against spreadsheet formula injection.
* **Cost of a list page** (measured, see "Tests"): cold = one Discogs call per uncached record on the visible page (12 or 24);
  warm = none. The next page only asks for its own records.

## Discogs integration (milestone 2)

Server code is in `src/server/discogs/`, shared pure code (types, normalisation, grouping) in `src/lib/discogs/`.
Details and the open licensing questions: [docs/discogs-integration.md](docs/discogs-integration.md),
[docs/discogs-compliance.md](docs/discogs-compliance.md).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/discogs/search?q=&mode=track\|artist\|album&by=&page=` | Vinyl releases, grouped by artist and by master, deduped (max 5 pages of 50). `by` narrows a track or album search to one artist. **Sign-in required** (all `/api/discogs/*`). |
| `GET /api/discogs/masters?ids=1,2,3` | Title, year and cover of up to 12 albums (master records), cached one by one. |
| `GET /api/discogs/masters/:id/versions?page=&country=&released=&label=` | VINYL pressings of a master (max 10 pages of 50), with filter facets. |
| `GET /api/discogs/releases/:id` | One release. |
| `GET /api/discogs/image?u=` | Image proxy (exact Discogs image hosts only, streamed, never stored). |
| `GET /api/discogs/releases?ids=1,2,3` | Card data (title, artist, year, country, label, format, thumbnail) for up to 24 releases, cached one by one under the same key as `/releases/:id`. Answers `gone` (404 on Discogs), `missing` (not resolvable right now) and `retryAfter`. |
| `GET\|PUT\|PATCH\|DELETE /api/lists/items/:releaseId` | The signed-in user's wishlist / collection entry for one pressing (`PUT {"list":"wishlist"\|"collection"}` adds or moves; `PATCH {notes?, conditionMedia?, conditionSleeve?}` edits the user's own fields, condition on the Collection only). |
| `GET /api/lists/items?list=&q=&sort=&dir=&page=&pageSize=` | One page of the signed-in user's stored items (no Discogs content). |
| `GET /api/lists/export?format=csv\|json` | The user's own list data as a download (10 per minute). |
| `GET /api/cron/purge` | The daily retention purge (expired cache rows, verification rows and sessions, old limiter counters; never accounts or lists). `?dryRun=1` only counts. Needs `Authorization: Bearer $CRON_SECRET`. |
| `GET /api/health` | `{status, version, db}` for an uptime monitor; no secrets, no personal data, no Discogs call. |

* **Credentials**: `DISCOGS_CONSUMER_KEY` + `DISCOGS_CONSUMER_SECRET` win over `DISCOGS_TOKEN` when both are set.
* **Throttling**: one Postgres token bucket shared by all instances. The limit is read from Discogs' own
  `X-Discogs-Ratelimit*` headers (60/min was observed with a key + secret); before the first response it assumes a
  conservative 25. A 429 is retried with exponential backoff and jitter; if the wait is long the API answers
  `429 {"error":"throttled","scope":"discogs","retryAfter":N}` (plus a `Retry-After` header) so the UI can show a countdown.
  Anonymous callers get `401 unauthorized`. Our own per-IP / per-user limit answers `429 {"error":"rate_limited","scope":"app",...}`.
* **Purge cadence**: `vercel.json` runs the purge **once a day** (`17 3 * * *`), which is valid on Vercel's Hobby plan (Hobby rejects
  anything more frequent). On the Pro plan you may change it to hourly. Expired rows are never served either way, and every cache write
  also deletes expired rows. Functions run in `fra1` (Frankfurt), next to the Neon database in eu-central-1.
* **Client IP** for the limiter comes from `x-vercel-forwarded-for` / `x-forwarded-for` / `x-real-ip` and only valid IPs
  are accepted. That is trustworthy behind Vercel; if you self-host, put a proxy in front that overwrites these headers.
* **Local gotcha (Windows / some ISPs)**: if requests to `i.discogs.com` time out (`UND_ERR_CONNECT_TIMEOUT`) while
  `api.discogs.com` works, your machine has a broken IPv6 route. Start with `NODE_OPTIONS=--dns-result-order=ipv4first`.
* **Real-API check**: `npm run discogs:smoke` makes one search, one release fetch and one image request with your real
  credentials, prints the rate-limit numbers Discogs reports, and deletes the cache rows it created.

## Privacy policy, terms and account data (milestone 5)

* `/<locale>/privacy` and `/<locale>/terms` (uk/en/nb, linked from the footer and the sign-up form) are **drafts**: anything that makes a
  legal claim carries a visible `[NEEDS LEGAL REVIEW]` mark and a banner says so. The factual parts (what is stored, cookies, providers,
  deletion, export) describe what the code actually does. Open items: [docs/legal-review-checklist.md](docs/legal-review-checklist.md).
* **Google tokens are not stored.** Google sign-in uses only the basic profile; the OAuth access/refresh/ID tokens Better Auth would
  otherwise keep in the `account` table are nulled by a database hook (`src/server/auth/oauth-tokens.ts`).
* **Account data export**: Account > "Download my data" (`GET /api/account/export`): name, email, language, creation date and your lists.
  Never a hash, session, IP address or token. Lists can also be exported as CSV or JSON on the lists page.
* Only two cookies are used (sign-in session, language): both strictly necessary, no analytics. If that changes, revisit the policy first.

## Security and accessibility (milestone 5)

* **Headers** (`src/lib/security-headers.ts`, applied in `next.config.ts`): nosniff, frame denial, referrer and permissions policies. The
  **Content-Security-Policy** is set per page request by `src/proxy.ts` with a nonce (`script-src 'self' 'nonce-...'`, no `'unsafe-inline'`),
  **report-only by default** and enforcing with `CSP_MODE=enforce` ([ADR 0005](docs/adr/0005-csp-rollout.md)); reports land in the server log
  as `[csp-report]`. HSTS is opt-in (`HSTS_MAX_AGE_SECONDS`).
* **Health and metrics**: `GET /api/health` for an uptime monitor; one `[metrics]` log line a minute ([docs/operations.md](docs/operations.md) section 19).
* **Image proxy / SSRF**: exact host allow-list, https only, no credentials, ports or IP literals, redirects followed by hand for at most
  2 hops with every hop re-validated, no SVG, 8 MB cap enforced while streaming. Covered by `tests/unit/discogs-image*.test.ts`.
* **CI** (`.github/workflows/`): typecheck, lint, unit tests, `npm run audit:prod`, the secret-free end-to-end suite, CodeQL and a secret scan;
  Dependabot with a 14-day cooldown; every action pinned to a commit SHA ([docs/operations.md](docs/operations.md) section 18).
* **Accessibility**: axe (WCAG 2.0-2.2 A/AA) runs over the main screens in the light and dark themes (desktop) and on a phone, plus
  scripted keyboard tests. What a tool cannot judge is the manual checklist in [docs/operations.md](docs/operations.md).
* **Operations runbook**: [docs/operations.md](docs/operations.md) (logs, rotating secrets, backups, Discogs throttling or revocation,
  native-speaker review, HSTS and CSP rollout).

## Tests

```bash
npm test            # unit tests (Vitest): messages, auth links, Discogs normalisation/grouping, token bucket,
                    # client backoff, cache TTL + purge, limiter, image host allow-list. Uses PGlite (embedded
                    # Postgres running the real migrations): no database or secrets needed.
npm run test:e2e    # (adds the a11y-* axe projects and the keyboard project after the library projects) Playwright: shell smoke tests, the Discogs + lists APIs, and the finder UI (desktop and phone
                    # viewport) against a MOCKED Discogs server; a verified e2e user is created and deleted automatically
                    # (FAKE credentials, no real token). The Discogs flow needs a real Postgres: it uses DEV_DATABASE_URL ONLY
                    # (from .env.local, or a throwaway Neon branch in CI) and SKIPS when none is set. It removes its rows afterwards.
```

## Deploying to Vercel + Neon (summary; full walkthrough in milestone 5)

1. In Neon, use your **production branch**: copy its **pooled** connection string into `DATABASE_URL` in **Vercel's environment variables** (Production), and nowhere else.
2. Apply migrations with a deliberate production run (see "A deliberate production migration" above).
3. Import the repo into Vercel; set the variables above for Production (and Preview if wanted).
4. Set `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` to the production origin and add the Google redirect URI.
5. Email: validate your sender in Brevo and set `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` and `EMAIL_PROVIDER=brevo`; run the hand test in [docs/email-deliverability-test.md](docs/email-deliverability-test.md) before inviting anyone.
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
