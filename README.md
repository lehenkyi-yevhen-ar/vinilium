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
| Contact (Discogs `User-Agent`, legal pages) | `APP_CONTACT` | `https://example.com/contact` |
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
| `APP_CONTACT` | no | Placeholder, see above. |
| `DISCOGS_TOKEN` | M2 | Personal access token (`Authorization: Discogs token=...`). Server-only. Used only if the key/secret pair below is not set. |
| `DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET` | M2 | App credentials (`Authorization: Discogs key=..., secret=...`). Set both or neither. **Preferred over `DISCOGS_TOKEN` when both are set.** Server-only. |
| `DISCOGS_CACHE_TTL_SECONDS` | M2 | One constant for all cached Discogs content. Default `21600` (6 h). |

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

`npm run dev | build | start | lint | typecheck | test | test:e2e`

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

## Tests

```bash
npm test            # unit tests (Vitest): message parity, redirect guard, email templates
npm run test:e2e    # Playwright (the search -> add-to-list flow arrives in milestone 5)
```

## Deploying to Vercel + Neon (summary; full walkthrough in milestone 5)

1. Create a Neon project; copy the **pooled** connection string into `DATABASE_URL`.
2. Run `npm run db:migrate` once against it.
3. Import the repo into Vercel; set the variables above for Production (and Preview if wanted).
4. Set `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` to the production origin and add the Google redirect URI.
5. Verify a sending domain in Resend and set `EMAIL_FROM` and `RESEND_API_KEY`.

## Credits and licences

Interface: [Ліс design system](https://github.com/lehenkyi-yevhen-ar/lis-design-system). Fonts: Ermilov (free to use) and
KyivType Sans (CC BY-ND 4.0: do not modify or convert the files; credit is shown in the footer). Release data and
images: Discogs. This app is not affiliated with or endorsed by Discogs.
