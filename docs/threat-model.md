# Threat model

Scope: the Vinilium web app (Next.js on Vercel), its Neon Postgres database, and the services it talks to (Discogs, Google, Brevo). One
operator, no staff, no admin screen. Written 2026-11; update it when a trust boundary or an asset changes.

Honesty note: a **Test** column names a file that exercises the mitigation. "Not covered" means exactly that. Nothing here has had a
professional penetration test.

## 1. Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| People's accounts: name, email, password hash, language | Personal data; account takeover | `user`, `account`, `session`, `verification` (Postgres) |
| Sessions | Whoever holds a session token is that person | `session` rows; an HttpOnly cookie |
| Wishlist and Collection (release ids, notes, condition) | The product; notes are free text and may be personal | `user_items` |
| The shared Discogs request budget (about 60 a minute for everyone) | One person must not be able to use it all; Discogs can revoke access | `discogs_bucket`, `discogs_cache` |
| Discogs credentials, Brevo key, Google secret, `BETTER_AUTH_SECRET`, `CRON_SECRET`, database URLs | Full compromise of the matching service | Vercel environment variables only |
| The free Brevo quota (300 emails a day) | Exhausting it stops all sign-ups and password resets | Brevo |
| The operator's standing with Discogs, Google and Brevo | A policy breach can end the service | Discogs Terms: [discogs-compliance.md](discogs-compliance.md) |

## 2. Actors

| Actor | Capability |
| --- | --- |
| Anonymous visitor | Reaches public pages and the auth endpoints; can sign up |
| Signed-in user (legitimate) | Searches, keeps lists, exports, deletes their account |
| Malicious signed-in user | Anyone can sign up, so assume a user who scripts the API, uses many accounts, or probes other people's data |
| Network attacker / malicious website | Can make a victim's browser send requests (CSRF), lure to a crafted link (open redirect), or serve a hostile page |
| Compromised or hostile third party | Discogs (malformed or hostile data), an image host, a browser extension |
| The operator's own mistakes | A test run against the wrong database, a leaked secret, a weakened limit |

## 3. Trust boundaries

1. Browser to the app: everything in a request is untrusted (URL, query, headers, body). Cookies authenticate, so a request from another
   site can carry them.
2. App to Postgres: trusted, over TLS; only the app holds credentials. Dev and production are separate databases ([ADR 0001](adr/0001-two-databases.md)).
3. App to Discogs: the data coming back is untrusted (it is normalised to a whitelisted shape before use); our credentials go out.
4. App to Brevo and Google: secrets go out; callback and redirect targets come back.
5. Vercel Cron to `/api/cron/purge`: authenticated by `CRON_SECRET` only.

## 4. Abuse cases

Each row: the attack, what stops it, and the test. Status: **mitigated**, **partly** (residual risk written down) or **open**.

| # | Abuse case | Mitigation | Test | Status |
| --- | --- | --- | --- | --- |
| 1 | **Account enumeration** by sign-up, sign-in, password reset or "resend verification": does this email have an account? | Sign-in and reset answer the same for known and unknown addresses; the "nothing arrived?" note is shown to everyone and never says "we could not email you" (so a failing send does not reveal an account); sign-in errors are generic | `tests/e2e/auth-modes.spec.ts` (known vs unknown address, same note and same API answer); `tests/unit/email-not-arrived-copy.test.ts` | partly: the password-reset answer for an unknown address is tested against a known one; the answer to **signing up with an address that already has an account** and **response timing** were NOT tested |
| 2 | **Rate-limit evasion** by rotating IPs, spoofing `X-Forwarded-For`, or many accounts | The client IP is taken from Vercel's headers and only a syntactically valid IP is accepted; the per-user and per-IP limits are independent, so many IPs still hit the per-user limit and many users on one IP hit the per-IP limit; auth endpoints have their own limits in Postgres | `tests/unit/discogs-http.test.ts`, `tests/unit/rate-limit.test.ts`, `tests/unit/auth-security.test.ts` | partly: a botnet with many IPs and many accounts is bounded only by the shared Discogs budget and sign-up friction (email verification, the sign-up allowlist). Behind anything but Vercel the forwarded headers are forgeable (documented in the README) |
| 3 | **Discogs budget exhaustion by one user**: scripting cold searches or opening huge list pages | Sign-in required; cache first (4 h); per-user ceiling; the IP's cold allowance (30 a minute); per-person cold cap (24 a minute); the Postgres token bucket never exceeds the budget; bounded retries with backoff and jitter; a refused request sends nothing upstream | `tests/unit/search-ip-limit.test.ts`, `tests/unit/cold-fetch-cap.test.ts`, `tests/unit/token-bucket.test.ts`, `tests/unit/discogs-client.test.ts` | mitigated. Many cooperating accounts can still starve others for a while; the bucket guarantees Discogs itself is never exceeded |
| 4 | **Image-proxy SSRF**: make the server fetch an internal address or a hostile host | Exact host allow-list (no wildcards), https only, no credentials, no ports, no IP literals, redirects followed by hand (2 hops) with every hop re-validated, no SVG, 8 MB cap while streaming, sign-in required | `tests/unit/discogs-image-ssrf.test.ts`, `tests/unit/discogs-image.test.ts`, `tests/unit/input-fuzz.test.ts` (300 junk addresses, no upstream call), `tests/e2e/discogs.spec.ts` | mitigated |
| 5 | **Open redirect** through a callback or return parameter | `next` is accepted only as a same-site relative path (no `//`, backslash, control characters, and it must still parse to our origin) and is always prefixed with the locale; Better Auth refuses a `callbackURL`, `redirectTo`, `errorCallbackURL` or `newUserCallbackURL` that is not our origin | `tests/unit/session.test.ts`, `tests/unit/input-fuzz.test.ts` (40,000 random targets), `tests/unit/auth-security.test.ts` (every Better Auth redirect field) | mitigated. Fixed on the way: a tab or newline in `next` (a browser deletes them, so `/<tab>/evil.example` becomes `//evil.example`) was accepted before; the locale prefix had hidden it |
| 6 | **CSRF** on state-changing calls | Session cookie is `SameSite=Lax`, `HttpOnly`, `Secure`; Better Auth checks `Origin` on POST; our own write endpoints check that `Origin` equals our host; Discogs and list endpoints refuse `Sec-Fetch-Site: cross-site`; API answers are `no-store` | `tests/unit/auth-security.test.ts` (Origin, cookie flags), `tests/unit/discogs-http.test.ts`, `tests/e2e/discogs.spec.ts`, `tests/unit/lists.test.ts` | mitigated |
| 7 | **Session fixation / theft** | A new random token on every sign-in (a planted token is never accepted); `HttpOnly` so script cannot read it; no inline script (CSP); sessions are Postgres rows, so deleting the row or the account ends it at once; the secret rotation signs everyone out | `tests/unit/auth-security.test.ts`, `tests/unit/proxy-csp.test.ts`, `tests/e2e/csp.spec.ts` | mitigated. A person cannot yet list or end their other sessions (see `docs/decisions-needed.md`) |
| 8 | **Email abuse of the 300-a-day quota**: sign up with many addresses, or hammer "forgot password" for a victim | Sign-up, reset and resend are limited per IP (5, 3 and 3 a minute); `AUTH_SIGNUP_ALLOWLIST` (invite only) and `AUTH_EMAIL_PASSWORD_ENABLED=false` (Google only) turn the email flows off; past the quota the app keeps working and logs `rate_limited` | `tests/unit/auth-security.test.ts`, `tests/unit/auth-modes.test.ts`, `tests/e2e/auth-modes.spec.ts`, `tests/unit/email-providers.test.ts` | partly: one attacker with many IPs can still use the whole quota in a day; the switches are the remedy and need the operator to act |
| 9 | **Account deletion races**: a request already in flight when the account is deleted; deleting twice | Every table that holds a person's data cascades from `"user"`; a write that loses the race hits the foreign key and answers `401` instead of a crash or an orphan row | `tests/unit/account-deletion.test.ts` | mitigated. The `verification` table is not linked to `"user"` by a key: see `docs/data-inventory.md` for how it is cleaned |
| 10 | **Injection** (SQL, header, log, CSV formula, HTML) | Drizzle parameterises every query; every API parameter is validated with Zod and bounded; control characters are stripped from URL state and from CSP report lines; CSV cells that start with `= + - @` are defused; React escapes output; the CSP forbids inline script | `tests/unit/input-fuzz.test.ts`, `tests/unit/finder-state.test.ts`, `tests/unit/lists-library.test.ts`, `tests/unit/security-headers.test.ts` | mitigated |
| 11 | **XSS** | No `dangerouslySetInnerHTML` and no inline script anywhere (a test scans the source); nonce-based CSP, enforced behind `CSP_MODE=enforce` | `tests/unit/theme.test.ts`, `tests/e2e/csp.spec.ts` | partly: the CSP defaults to report-only until the owner flips the switch ([ADR 0005](adr/0005-csp-rollout.md)); styles still allow `'unsafe-inline'` |
| 12 | **Hostile or malformed Discogs data** | Responses are normalised to a whitelisted shape; unexpected shape is a `502`, never a crash; titles are rendered as text; links to Discogs are rebuilt from ids | `tests/unit/discogs-normalize.test.ts`, `tests/unit/vinyl-regression.test.ts` | mitigated |
| 13 | **Secrets in logs or responses** | Logs name variables, never values; email failure lines carry provider, reason and status only; error responses carry a code and a fixed message; a scanner and a test check the log statements | `tests/unit/log-hygiene.test.ts`, `tests/unit/email-providers.test.ts`, `tests/unit/input-fuzz.test.ts` (no stack, path or SQL in any error body) | mitigated |
| 14 | **A test or script run against the production database** | One rule for the database choice, no fallback, scripts refuse production, the e2e teardown can only match its own synthetic rows | `tests/unit/database-target.test.ts`, `tests/unit/dev-cleanup-sql.test.ts`, `tests/e2e/global-teardown.ts` | mitigated by construction; relies on the operator keeping `DATABASE_URL` out of `.env.local` |
| 15 | **Cron endpoint abuse** | `CRON_SECRET` compared in constant time; disabled without a secret | `tests/unit/discogs-cache.test.ts` (purge), `tests/e2e/discogs.spec.ts` | mitigated |
| 16 | **A leaked or exposed credential in the repository** | `.env*` is ignored, a secret scan runs on every push (gitleaks, full history) and before every commit | `.github/workflows/secret-scan.yml`, `tests/unit/ci-supply-chain.test.ts` | mitigated once the workflow has run on GitHub |
| 17 | **Supply chain**: a malicious dependency or action | Actions pinned to commit SHAs; Dependabot with a 14-day cooldown; `npm audit` gate on production dependencies; no new runtime dependencies without a reason | `tests/unit/ci-supply-chain.test.ts`, `.github/workflows/ci.yml` (job `audit`) | partly: install scripts of dependencies run on a developer machine; lockfile review is by eye |

## 5. Known gaps and decisions

* No list of sessions and no "sign out other devices" yet; no two-factor sign-in. Both are product decisions: `docs/decisions-needed.md`.
* The CSP is report-only by default; enforcement is the owner's switch with evidence behind it.
* HSTS is off until HTTPS is confirmed everywhere.
* There is no web application firewall and no bot detection; the limits are the defence.
* Backups and restores are the operator's job (`docs/operations.md`, section 7).

## 6. Route by route

Every file under `src/app/api/`: who may call it, how its input is validated, which limit applies, and the test. "Session" means a signed-in
user (`getRequestUserId`); "same-site" means a request the browser labels cross-site is refused (`Sec-Fetch-Site`), and for writes the `Origin` must be our host.

| Route | Who | Input validation | Limit | Test |
| --- | --- | --- | --- | --- |
| `/api/auth/*` (Better Auth) | anyone; the sign-up switches (`guard.ts`) apply first | Better Auth's own schemas; redirect fields checked against our origin; `Origin` checked | sign-in 8, sign-up 5, reset 3, resend 3, anything else 60 a minute, in Postgres, 429 with `Retry-After` | `auth-security.test.ts`, `auth-modes.test.ts` |
| `GET /api/discogs/search` | session, same-site | Zod `searchQuerySchema` (q 1-100, mode enum, by, page 1-5; control characters removed) | IP flood 4x, IP cold 30, user 60 a minute | `input-fuzz.test.ts`, `search-ip-limit.test.ts`, `discogs-http.test.ts` |
| `GET /api/discogs/masters` | session, same-site | `masterIdsSchema` (1-12 distinct ids) | as above, plus the person's cold cap 24 | `discogs-releases-batch.test.ts`, `cold-fetch-cap.test.ts` |
| `GET /api/discogs/masters/:id/versions` | session, same-site | `idSchema`, `versionsQuerySchema` | as search | `input-fuzz.test.ts` |
| `GET /api/discogs/releases`, `/releases/:id` | session, same-site | `releaseIdsSchema` (1-24), `idSchema` | as search; the batch also the person's cold cap | `discogs-releases-batch.test.ts`, `chaos-discogs.test.ts` |
| `GET /api/discogs/image` | session, same-site | `u` must be an https URL on an allow-listed Discogs host (no credentials, ports, IP literals; redirects re-checked) | image budget: IP 300, user 600 a minute, and its own token bucket | `discogs-image-ssrf.test.ts`, `input-fuzz.test.ts` |
| `GET /api/lists/items` | session, same-site | Zod `querySchema` (list, q, sort, dir, page, pageSize) | none beyond the session (a cheap indexed read) | `input-fuzz.test.ts`, `lists-library.test.ts` |
| `GET/PUT/PATCH/DELETE /api/lists/items/:releaseId` | session, same-site, `Origin` must match for writes | `idSchema`, Zod bodies (`strict`, grades enum, notes length, control characters removed) | writes 120 a minute per user; a lost race with account deletion answers 401 | `input-fuzz.test.ts`, `account-deletion.test.ts`, `lists.test.ts` |
| `GET /api/lists/export` | session, same-site | `format` csv or json | 10 a minute per user | `lists-library.test.ts` |
| `GET /api/account/export` | session, same-site | none | 5 a minute per user | `account-export.test.ts` |
| `POST /api/csp-report` | anyone (browsers send it) | 8 KB cap, JSON parsed defensively, only a few clipped fields kept, queries stripped | 30 a minute per IP (silently dropped beyond) | `log-hygiene.test.ts`, `security-headers.test.ts` |
| `GET\|HEAD /api/health` | anyone | none | answer remembered 30 s per instance | `health.test.ts` |
| `GET /api/cron/purge` | `Authorization: Bearer $CRON_SECRET`, constant-time compare; disabled without a secret | `dryRun=1` only | none (secret) | `retention.test.ts` |

Error bodies carry a code and a fixed message only (`errorResponse`); the fuzz test asserts no stack, path, SQL or connection string appears in any answer.
Gaps: reads of `/api/lists/items` have no limiter of their own; `/api/health` and `/api/csp-report` are open by nature.
When the limiter's own counter cannot be written (a database error) every caller fails in a deliberate way and never lets a request through unchecked: search, images, masters and lists answer a structured 503 with `Retry-After`, the cold-fetch allowance answers "not allowed, retry in 2 s", and only `/api/csp-report` fails open (it protects only log volume). A race in creating a counter (two simultaneous first requests) used to surface as a 500 and is fixed; see `docs/operations.md` section 17a.
