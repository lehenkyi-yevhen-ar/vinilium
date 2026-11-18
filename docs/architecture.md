# Architecture

One Next.js (App Router) application on Vercel (Hobby, region `fra1`), one Postgres database on Neon (eu-central-1), and three outside
services: Discogs (read-only data), Google (sign-in) and Brevo (email). Decisions behind the shape: [docs/adr/](adr/README.md).

## Request flow

```mermaid
flowchart TD
    B["Browser"] -->|page request| P["proxy.ts<br/>locale (next-intl) + CSP nonce"]
    P --> L["Locale layout<br/>reads the session, renders per request"]
    L --> PG["Pages and client components<br/>finder, lists, account, legal"]
    B -->|fetch /api/discogs/*| G["guardUser<br/>1 same-site check<br/>2 session (Better Auth cookie)<br/>3 IP flood ceiling + user ceiling"]
    G -->|signed out| E401["401 unauthorized"]
    G -->|over a limit| E429["429 rate_limited + Retry-After"]
    G --> SV["service.ts<br/>cache-through"]
    SV -->|fresh row| C[("discogs_cache<br/>TTL 4 h, cap 6 h")]
    SV -->|miss| CL["cold allowances<br/>IP once per request, person per call"]
    CL -->|over| E429D["429 throttled + countdown<br/>nothing sent to Discogs"]
    CL --> TB[("discogs_bucket<br/>token bucket, shared by all instances")]
    TB -->|token| D["Discogs API<br/>key + secret, User-Agent"]
    TB -->|none now| E429D
    D -->|normalise, whitelist| C
    B -->|GET /api/discogs/image?u=| IG["guardUser (image budget)"] --> IP["image proxy<br/>exact hosts, https, redirects re-checked,<br/>streamed, never stored"] --> D
    B -->|auth calls| A["/api/auth/*<br/>guard (sign-up switches) + Better Auth<br/>own rate limits"]
    A --> DB[("Postgres<br/>user, session, account,<br/>verification, rate_limit")]
    A -->|Google OAuth| GO["Google"]
    A -->|verification and reset mail| BR["Brevo HTTPS API"]
    B -->|/api/lists/*| LS["gateLists<br/>session, same-origin check, limits"] --> UI[("user_items<br/>release id + the user's own fields")]
    CR["Vercel Cron, daily"] -->|Bearer CRON_SECRET| PU["/api/cron/purge"] --> C
```

## The pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Proxy | `src/proxy.ts` | Locale negotiation, and a fresh CSP nonce per page request ([ADR 0005](adr/0005-csp-rollout.md)). |
| Pages | `src/app/[locale]/…` | Every URL carries its locale (`uk`, `en`, `nb`). Pages are dynamic: the layout reads the session. Unknown addresses end in `[...rest]` and a localized 404. |
| Auth | `src/server/auth/`, `/api/auth/*` | Better Auth: email + password (verification required) and Google. Sessions are Postgres rows. `guard.ts` applies the two sign-up switches. OAuth tokens are never stored (`oauth-tokens.ts`). |
| Discogs client | `src/server/discogs/` | `client.ts` (auth, retries, backoff with jitter), `token-bucket.ts` (shared budget), `cache.ts` (TTL cache), `service.ts` (cache-through, batches), `image.ts` (proxy), `http.ts` (guard, schemas, responses). |
| Limits | `src/server/limits.ts`, `rate-limit.ts` | Postgres fixed-window counters ([ADR 0002](adr/0002-postgres-rate-limiting.md)); numbers in `docs/operations.md` section 17. |
| Lists | `src/server/lists/`, `/api/lists/*` | `user_items`: one list per pressing, notes, condition. No Discogs content. |
| Email | `src/server/email/` | Brevo over HTTPS; Resend behind a switch ([ADR 0004](adr/0004-brevo-free-mail-sender.md)). |
| Design system | `public/ds/` (vendored, never edited), `src/ds/`, `src/app/ds-extensions.css` | Thin typed wrappers over the system's own classes; fixes live in our CSS. |
| Database | `src/server/db/`, `drizzle/` | Neon serverless driver; dev and production are separate branches ([ADR 0001](adr/0001-two-databases.md)). |

## What each layer answers

| Situation | Answer | Who handles it |
| --- | --- | --- |
| Not signed in | `401 unauthorized`; pages show "Sign in to search" | `guardUser`, page checks |
| Request from another site | `403 forbidden` | `isCrossSite` (Sec-Fetch-Site) |
| Too many requests from an IP or user | `429 rate_limited` + `Retry-After` | `guardUser` |
| This IP or person spent its cold allowance | `429 throttled` (batches: `missing` + `retryAfter`) | `coldIp`, `coldLimiter` |
| Discogs budget used up or Discogs said 429 | `429 throttled` + countdown, automatic retry twice | token bucket, `client.ts` |
| Discogs error or unexpected shape | `502 upstream`; the screen offers a retry | `service.ts`, `respond` |
| Release removed on Discogs | `404`; batches report `gone`; the card says "No longer on Discogs" | `service.ts` |
| Discogs credentials missing | `503 unconfigured`; the screen says details are not set up | `client.ts` |

## Where the Discogs Terms are enforced

See [discogs-compliance.md](discogs-compliance.md): each rule with the code and the test that cover it.
