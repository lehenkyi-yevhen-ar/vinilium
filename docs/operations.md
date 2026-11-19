# Operations runbook

Short, practical, and written for one operator. **Never paste a secret into a chat, an issue or a commit.** Commands that touch the
production database are run by you, in a shell you close afterwards; always read the target the guard prints before confirming.

Related: [README](../README.md) (setup, environment variables), [Discogs compliance](discogs-compliance.md),
[legal review checklist](legal-review-checklist.md).

## 1. Where things live

| What | Where |
| --- | --- |
| Website and server code | Vercel project (Production environment holds the real variables) |
| Database | Neon: the **production** branch is used by the deployed site only; the **dev** branch by your machine and CI |
| Email (verification, password reset) | Brevo transactional API (free plan: 300 emails a day), sender = a validated address, Reply-To = `NEXT_PUBLIC_CONTACT_EMAIL`. Resend is supported behind `EMAIL_PROVIDER=resend` but needs a verified domain |
| Google sign-in | Google Cloud console > Google Auth Platform |
| Record data | Discogs API (key + secret in Vercel); the service is not affiliated with Discogs |

## 2. Vercel logs: where and what to look for

Vercel dashboard > your project > **Logs** (runtime logs). Set the time range, and filter by text or status. Useful searches:

| Search for | Meaning | What to do |
| --- | --- | --- |
| `[email]` and `FAILED` | A verification or reset email was not sent. The line says `provider=`, `reason=` and sometimes `status=` / `code=` (never an address, key or link): see section 15 for each reason | Fix the cause; people cannot finish sign-up until you do |
| `Invalid environment variables` | A required variable is missing or malformed (the message names it, never its value) | Fix it in Vercel > Settings > Environment Variables, then redeploy |
| `DatabaseConfigError` / `DATABASE_URL is not set` | The database target is wrong | Check `DATABASE_URL` for the Production environment |
| `[csp-report]` | The report-only Content-Security-Policy saw something it would block | See section 10; a handful from browser extensions is normal |
| status `429` on `/api/discogs/*` | Discogs or our own limits are throttling | See section 5 |
| status `401` on `/api/cron/purge` | `CRON_SECRET` is missing or wrong | Set it in Vercel (Cron sends it automatically) and redeploy |
| status `5xx` | A real error | Open the entry; the stack trace names the file |

Logs hold IP addresses and request paths: treat them as personal data (see the privacy policy).

## 3. Rotating secrets

Rotating means: create the new value, put it in Vercel (Production), **redeploy**, then revoke the old one. Do the revoke last so there
is no gap.

| Secret | How | Effect |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | New random value (`openssl rand -base64 32`) | **Everyone is signed out** (sessions no longer verify); no data is lost |
| `GOOGLE_CLIENT_SECRET` | Google Cloud > Credentials > your OAuth client > add a new secret, put it in Vercel, redeploy, then delete the old secret | None for users |
| `BREVO_API_KEY` | Brevo > your name (top right) > **SMTP & API** > **API keys** > generate a new key, put it in Vercel, redeploy, then delete the old key | None; emails resume |
| `RESEND_API_KEY` (only if you use Resend) | Resend > API Keys > create a new key, update Vercel, redeploy, delete the old key | None |
| `DISCOGS_CONSUMER_KEY` / `_SECRET` | Discogs > Settings > Developers > your application | Until updated, record details show the "not set up" or error states |
| `CRON_SECRET` | New random value of 16+ characters in Vercel, redeploy | Vercel Cron picks it up automatically |
| `DATABASE_URL` | Neon > Roles > reset the password of the role, copy the new **pooled** connection string into Vercel, redeploy | Brief errors until the redeploy finishes |

If a secret may have leaked (committed, pasted, logged): rotate it at once, then check the provider's activity log.

## 4. Helping someone who cannot sign in

1. Normal path: **Forgot password** sends a reset link (valid 1 hour). If it does not arrive, check the Brevo logs (section 15) and
   section 2.
2. Their email address is unverified: signing in re-sends the verification email.
3. There is no admin screen and no way for you to set someone's password. Last resort, after you have satisfied yourself about who is
   asking: let them export what they can, then delete the account row so they can sign up again (their lists go with it). Run in the
   Neon SQL editor **on the production branch, saying out loud which branch it is**:

   ```sql
   -- read first: confirm it is the right person
   select id, email, created_at from "user" where email = '<their email>';
   -- then, only if you really mean it (sessions, accounts and lists are deleted by the foreign keys):
   delete from "user" where email = '<their email>';
   ```

## 5. When Discogs throttles

What people see: the "Waiting for Discogs" state with a countdown (never an error page); the screen retries twice by itself and then
offers a button. Causes: the shared limit (about 60 requests a minute for the whole app) is used up, or one person hit their own cold
allowance (`RL_COLD_USER_PER_MIN`, default 24 a minute).

Look (read-only, Neon SQL editor):

```sql
select id, tokens, capacity, blocked_until, observed_limit, observed_remaining from discogs_bucket;
```

* `blocked_until` in the future: Discogs sent a 429 recently and every instance is waiting.
* Often throttled with few users: raise `DISCOGS_CACHE_TTL_SECONDS` toward its 6 h cap (the Discogs Terms forbid more), or lower
  `RL_COLD_USER_PER_MIN`.
* Persistently throttled: ask Discogs about a higher limit; do not work around it.

## 6. If Discogs revokes or changes access

Symptoms: record details show "Details not loaded" or "Waiting", searches fail with a clear message, `/api/discogs/*` answers 502/503.

* **Still works:** accounts, sign-in, lists, notes, condition, move, remove, export (lists store only release IDs and your own fields).
* **Does not:** search and record details.
* Check email from Discogs and the current API Terms of Use first. Do not scrape or use another route to get the data.
* To switch record details off tidily, remove the Discogs variables in Vercel and redeploy: the screens then say record details are not
  set up, instead of failing.
* Tell users plainly (a note on the home page) and keep the export available.

## 7. Database backups

You run these; I never touch production.

Check **how many days of history your Neon plan keeps** (Neon console > Project > Settings > Storage / restore window). That window is
your safety net for "I deleted the wrong thing"; the dump below is your own copy outside Neon.

```powershell
# PowerShell. Use the DIRECT (non-pooled) connection string of the PRODUCTION branch for pg_dump.
$env:DATABASE_URL = "<production connection string>"
pg_dump --format=custom --no-owner --file "vinilium-$(Get-Date -Format yyyy-MM-dd).dump" $env:DATABASE_URL
Remove-Item Env:DATABASE_URL
```

* A dump contains personal data: store it encrypted, off the repository, and delete old ones (the privacy policy must say how long
  backups are kept: see the legal checklist).
* Test a restore only into a **new Neon branch** (`pg_restore --no-owner --dbname <new branch string> file.dump`), never into production.

## 8. Scheduled purge

`vercel.json` runs `/api/cron/purge` once a day (valid on Hobby and Pro). Expired Discogs cache rows are never served, and every cache
write also deletes expired rows, so the cron is a backstop. On the Pro plan you can make it hourly (`"0 * * * *"`).
Manual run: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/cron/purge`.

## 9. Cleaning old Google tokens (one time, after the deploy that stops storing them)

Since this release the app stores **no** Google OAuth tokens. Rows created earlier may still hold some. After deploying, in the Neon SQL
editor **on the production branch**:

```sql
select count(*) from account where provider_id = 'google' and (access_token is not null or refresh_token is not null or id_token is not null);
update account set access_token = null, refresh_token = null, id_token = null,
                   access_token_expires_at = null, refresh_token_expires_at = null
 where provider_id = 'google';
```

## 10. Security headers and CSP

* Always on (every response, `next.config.ts`): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`. HSTS only when you set it (below).
* **The Content-Security-Policy is set per page request by `src/proxy.ts`** (it needs a fresh nonce each time) and has two modes, chosen by
  `CSP_MODE`:

  | `CSP_MODE` | Header | Effect |
  | --- | --- | --- |
  | unset, empty, `report-only` or anything else (default) | `Content-Security-Policy-Report-Only` | blocks **nothing**; browsers report violations to `/api/csp-report`, which logs `[csp-report]` lines |
  | exactly `enforce` | `Content-Security-Policy` | the same policy, enforced |

  The policy is strict in both modes: `script-src 'self' 'nonce-<per request>'` (no `'unsafe-inline'`, no `'unsafe-eval'`), everything else
  `'self'`, no objects, no framing, `base-uri 'self'`. Styles still allow `'unsafe-inline'` (style attributes cannot carry a nonce; see
  [ADR 0005](adr/0005-csp-rollout.md)). The theme script is the static file `/theme-init.js`, so there is no hash to keep in step.
* **Rollout (report-only to enforcing).**
  1. Deploy with `CSP_MODE` unset (report-only). Use the site normally in the three languages, signed in and out, and watch Vercel > Logs for
     `[csp-report]` for a few days. A handful of reports that name a browser extension (`chrome-extension:`, `moz-extension:`, `blocked=inline`
     on a page you did not change) are noise. A report that names one of our own `/_next/` files, `/ds/` files or a page of ours is a real
     finding: fix it before enforcing.
  2. Before the first enforcing deploy run the evidence locally: `npx playwright test --project=setup --project=csp` (zero violations on every
     page and language) and, once, the whole suite with `CSP_MODE=enforce` (PowerShell: `$env:CSP_MODE="enforce"; npx playwright test`).
  3. In Vercel > Settings > Environment Variables (Production) add `CSP_MODE` = `enforce`, **Redeploy**, then click through sign-in (email
     and Google), search, a release card, the lists, the account page and the language and theme menus.
* **Rollback.** Delete `CSP_MODE` (or set it to `report-only`) and **Redeploy**: the browser stops blocking at once for new page loads. Nothing
  else changes. If a page is broken for one person, a browser extension is the usual cause: try a private window first.
* **What to do with a new page or script.** Every page must stay dynamic (it reads the session); a static page cannot carry a nonce. Never add
  an inline `<script>` or `dangerouslySetInnerHTML` script (a unit test fails the build). Load scripts from our own origin or with `<Script>`.
* **HSTS is off until you set `HSTS_MAX_AGE_SECONDS`.** Only do that after you have confirmed the whole site works over HTTPS
  (every page, sign-in, the Google redirect and email links). Roll out in steps: `300`, then `86400`, then `31536000`. Add
  `HSTS_INCLUDE_SUBDOMAINS=1` only if every subdomain is HTTPS too. A browser remembers HSTS for the full period, so do not jump to a
  year first.

## 11. Accessibility checks

Automated (every e2e run): axe on the main screens in the light and dark themes (desktop) and on a phone viewport, and scripted
keyboard checks (skip link, focus indicators, dialogs, pager, forms). A scan cannot judge wording, order or screen-reader behaviour,
so before launch and after big UI changes also do, by hand:

* Unplug the mouse: reach and operate every control on Home, Sign in, Search (3 steps), Release, Lists, Account. Is the order sensible?
* Zoom the browser to 200% and 400% (320 px wide): nothing is cut off or needs sideways scrolling.
* Screen reader smoke test (NVDA on Windows, VoiceOver on iOS): the lists page announces results, errors and "Removed from your lists".
* Turn on high-contrast / forced-colours mode and reduced motion.
* Read the uk and nb pages with a native speaker (see section 12): wording is part of accessibility.

## 12. Native-speaker review of the interface text

```bash
npm run i18n:export                 # writes docs/i18n/review-uk-nb.csv (UTF-8 with BOM; opens in Excel)
npm run i18n:import -- edited.csv   # DRY RUN: reports what would change, or what is wrong
npm run i18n:import -- edited.csv --write
npm test                            # the messages tests re-check keys and placeholders
```

Columns: `key, context, English source, uk, nb, placeholders`. Reviewers edit only the `uk` and `nb` columns. The import **refuses the
whole file** if any row changes a placeholder (`{count}`, plural forms), empties a string, edits the Discogs-prescribed footer wording,
removes a `[NEEDS LEGAL REVIEW]` mark, or if the English source changed since the export. The privacy and terms text is in the same
file but also needs a lawyer: language review does not replace that.

## 13. Legal pages before launch

`npm run legal:checklist` regenerates [legal-review-checklist.md](legal-review-checklist.md). `npm run legal:checklist -- --check`
fails while any `[NEEDS LEGAL REVIEW]` mark remains: run it before launch. Also set `NEXT_PUBLIC_OPERATOR_NAME`,
`NEXT_PUBLIC_OPERATOR_COUNTRY` and `NEXT_PUBLIC_CONTACT_EMAIL`, and change the "Draft of ..." date lines.

**If analytics, advertising or any new tracking is ever added:** the privacy policy, the cookie wording and (where required) a consent
notice must be revisited first, and the new tool added to the list of providers. Today the policy says there is none.

## 14. Deleting a user at their request

They can do it themselves in Account (immediate). On request by email, ask them to do that, or use the SQL in section 4. Remember
that backups age out on their own (state the period in the privacy policy).

## 15. Email (Brevo): logs, limits, switches

**Reading the logs.** In Vercel logs search `[email]`. A failure looks like `[email] verify email FAILED provider=brevo reason=rate_limited status=429`.

| `reason` | Meaning | What to do |
| --- | --- | --- |
| `misconfigured` with `code=no_provider` | No provider key is set in this environment | Set `BREVO_API_KEY` (and `EMAIL_FROM`), then Redeploy |
| `misconfigured` with `code=sender_setting` | `EMAIL_FROM` is missing or not an address | Set it to your validated sender, then Redeploy |
| `misconfigured` with `code=provider_setting` | `EMAIL_PROVIDER` names a provider whose key is missing, or is not `brevo`/`resend` | Fix the variable |
| `auth` (401/403) | Brevo refused the key: wrong, revoked, or **the key is limited to listed IP addresses** | Create a new key; in Brevo Security, **do not enable authorised IPs** (Vercel's addresses change) |
| `rate_limited` (429/402) | The free plan's **daily limit (300 emails)** or a per-second limit | See "At the limit" below |
| `rejected` (400/404...) | Brevo refused this message: sender not validated, an invalid address, a blocked contact | Check the sender in Brevo; for one address, see Brevo's logs |
| `unavailable` (5xx), `timeout`, `network` | Brevo is down or slow (our call times out after 8 s) | Wait; check Brevo's status page |

**Reading Brevo's own logs.** Brevo dashboard > **Transactional** > **Logs** (and **Statistics**): per message status (delivered, soft
bounce, hard bounce, blocked, spam report). Look here first when one person says "nothing arrived".

**At the limit (300 a day).** Every sign-up, verification resend and password-reset request sends one email. Past the limit Brevo
answers 429; the app **keeps working**: the account is still created, the person sees the same "nothing arrived? check your spam
folder, or contact us" note as everyone else (it must not say "we could not email you": that would reveal whether an address has an
account), and you see `reason=rate_limited` in the logs. The limit resets by itself. If you are near it often, switch to Google-only or
invite-only below, or move to a paid plan. (The 300/day figure is the free-plan limit you told me about; confirm it in your Brevo account.)

**Flipping the switches** (Vercel > your project > **Settings** > **Environment Variables**, scope **Production**): add or edit the
variable, **Save**, then **Deployments** > the latest deployment > **...** > **Redeploy**. A changed variable only reaches new deployments.

| Goal | Variable | Value |
| --- | --- | --- |
| Google sign-in only (no email at all) | `AUTH_EMAIL_PASSWORD_ENABLED` | `false` (use exactly that; anything unrecognised is ignored and the default `true` stays) |
| Back to email + password | `AUTH_EMAIL_PASSWORD_ENABLED` | `true`, or delete the variable |
| Invite-only sign-up with email + password | `AUTH_SIGNUP_ALLOWLIST` | `a@example.com,b@example.com` (to open sign-up again, delete the variable) |
| Switch to Resend | `EMAIL_PROVIDER` | `resend` (and set `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain) |

What Google-only mode does: the sign-in, sign-up, forgot-password, reset-password and verify-email pages show a plain message and the
Google button; the API refuses those endpoints with `403 EMAIL_PASSWORD_DISABLED`; the privacy and terms text drop the password and
email lines. **People who only have a password account cannot sign in while it is off**; whether they can get back in through Google with the
same email depends on Better Auth's account linking, which has **not been tested** here. Existing sessions and account deletion keep working.

**Reply-To.** Every email carries `Reply-To: NEXT_PUBLIC_CONTACT_EMAIL` (display name "<app name> contact"), because Brevo replaces a free-mail From address.
Replies therefore reach your real inbox. If `NEXT_PUBLIC_CONTACT_EMAIL` is unset there is no Reply-To (it is never invented).

**By-hand deliverability test:** [email-deliverability-test.md](email-deliverability-test.md).


## 16. Finder URLs, the search help, the theme and the "nothing arrived?" note

* **The finder keeps its state in the address**, so Back links, the browser's Back button, a reload and a copied link return to the same
  step: `mode`, `q`, `by` (search), `g` (artist), `n` (albums shown), `sp` (result pages loaded), `o` (other pressings open), `a` and `t`
  (artist and album title), `country`, `released`, `label` (filters), `vp` (pressing pages loaded). They are parsed in
  `src/lib/finder-state.ts`: invalid or tampered values fall back to defaults and the counters are capped (`n` 10, `sp` 5, `vp` 10).
  Going back re-asks for the pages that were loaded; each is a search request, answered from the cache when it is fresh (see "Search limits" below: such requests do not use the IP's cold allowance).
* **"How to search" keeps one setting in the browser's local storage** (`vinilium:search-help` = `closed`; not a cookie, never sent to
  us). The privacy page says so (section "Cookies"). If other things are ever stored on the device, change that sentence too.
* **The theme switcher** (header, every screen): dark (the design system's default), light, or system. One local-storage key,
  `vinilium:theme` = `dark` | `light` | `system`; nothing stored means dark. It sets `data-theme` on `<html>`, which is how the design system
  switches themes. To make "follow the device" the default for first-time visitors instead, change `DEFAULT_THEME` in `src/lib/theme.ts`.
  The privacy page lists this key and the search-help key; add any new key there too.
* **The phone menus** (language and theme) use the design system's bottom sheet. Two rules in `src/app/ds-extensions.css` keep the header
  from trapping it (the navbar's backdrop-filter and the sticky header's stacking context); do not give a header ancestor of a `.dd` a
  `transform`, `filter` or `backdrop-filter` without checking `tests/e2e/phone-menus.spec.ts`.
* **The "nothing arrived?" note** (`auth.emailNotArrived`) says the message may be in spam or junk because the sender address is not
  authenticated. **When you buy a domain and authenticate it in Brevo, revisit that wording** (and `docs/email-deliverability-test.md`).

## 17. Search limits (per IP, per user, per person's cold fetches)

Every `/api/discogs/*` call except the image proxy goes through `guardUser` (`src/server/discogs/http.ts`):

| Limit | Counts | Default | Variable | Answer when over |
| --- | --- | --- | --- | --- |
| IP flood ceiling | **every** request from the IP, cached answers included | 120 a minute (4 x the next line) | derived | `429 rate_limited` + `Retry-After` |
| IP cold allowance | a request that needs **at least one Discogs call** (counted once per request, not per record) | 30 a minute | `RL_SEARCH_IP_PER_MIN` | `429 throttled` (scope `discogs`) + `Retry-After`; nothing is sent to Discogs |
| User ceiling | every request from the signed-in user | 60 a minute | `RL_SEARCH_USER_PER_MIN` | `429 rate_limited` |
| Person's cold fetches | each uncached record in a batch (albums step, list pages) | 24 a minute | `RL_COLD_USER_PER_MIN` | the batch stops and reports `missing` + `retryAfter` |
| Discogs itself | every call to Discogs, all users | 60 a minute (read from Discogs' headers) | token bucket in Postgres | `429 throttled` + countdown |

**Why it is split.** The finder keeps its state in the URL, so a browser Back, a reload or a copied link re-asks for every page the
state says is loaded (up to 5 search pages, 10 albums pages, 10 pressings pages). Those answers come from our cache and cost Discogs
nothing, but they used to count against the same 30 a minute as a real, cold search, so a person who pressed Back a few times could lock
their whole network out of searching. Now only a request that would call Discogs spends the IP's cold allowance (the protection of the
shared Discogs budget is therefore the same or stricter than before: nothing changed for cold requests, which are still 30 a minute per IP),
while the loose 4x ceiling on all requests keeps a flood from hammering our database.

**The trade-off.** A single IP can now make up to 120 cached requests a minute instead of 30. That costs one Postgres read each and no Discogs
call. It is not a new way to burn the Discogs budget: the cold allowance, the per-person cap and the token bucket are unchanged.


## 18. CI and supply chain

Workflows in `.github/workflows/` (all pinned to full commit SHAs with the version in a comment; every workflow declares `permissions:`;
a unit test, `tests/unit/ci-supply-chain.test.ts`, fails if that erodes):

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` job `checks` | push to `main`, every pull request | typecheck, lint, unit tests |
| `ci.yml` job `audit` | same | `npm run audit:prod` (fails on a high or critical advisory in production dependencies) |
| `ci.yml` job `e2e` | same | the whole Playwright suite against a production build, with **no secrets** |
| `codeql.yml` | push to `main`, pull requests, Mondays | CodeQL for JavaScript/TypeScript (`security-extended`); results in the Security tab |
| `secret-scan.yml` | push to `main`, pull requests | gitleaks over the whole history. Free for a personal account; a repository moved to an organisation needs a free `GITLEAKS_LICENSE` secret |
| `.github/dependabot.yml` | weekly (Mondays) | npm and GitHub Actions updates, minor and patch grouped, **14-day cooldown** before a new release is proposed |

**How the secret-free e2e job works.** The app uses the Neon serverless driver (WebSockets), so a plain Postgres is reached through
Neon's open-source `wsproxy`: two service containers, both pinned by digest (`postgres:17-alpine` and `ghcr.io/neondatabase/wsproxy`),
with the proxy allowed to reach only `postgres:5432`. The variable `NEON_WS_PROXY` (CI only) switches the driver to the proxy;
`src/lib/neon-local.ts` ignores it for any `*.neon.tech` host, so it can never reroute a real Neon connection (unit-tested).
The Discogs and Brevo servers are the mocks in `tests/mocks/discogs-mock.ts`, and every credential in `playwright.config.ts` is fake.
On a failure the HTML report, traces and screenshots are uploaded as an artifact (7 days).

**Status: not yet observed running on GitHub.** The workflows were written and their text checked locally, but nothing was pushed by the
author of this change, so the first run on GitHub is the real test of the proxy wiring (the service containers could not be started on
the Windows development machine, which has no Docker). If the `e2e` job fails at "Apply the migrations" or at the sign-up step, look at
the proxy first: the run log of the `wsproxy` container, and that `NEON_WS_PROXY` reaches both `npm run db:migrate` and the app.

**The audit gate.** `npm run audit:prod` (the CI job `audit`) runs `npm audit --omit=dev --json` and `scripts/audit-gate.ts`: any high or critical advisory fails
unless it is listed in `.audit-allowlist.json` (one GHSA id per entry, a justification, a review date, an expiry date; wildcards and package-wide
ignores are refused, an expired entry fails again). Allowed advisories print as warnings with their justification; moderate and low ones are listed only.
To handle a new finding: read the advisory, check `npm ls <package>` for how it is reached, apply a fix if one is published (never `npm audit fix --force`),
otherwise add a reviewed, short-lived entry and tell the owner. The current entry and the reasoning: `docs/decisions-needed.md`, 6b. Locally: `npm run audit:prod`.

**Reading a pull request from Dependabot.** Check the changelog, run the checks, merge. A GitHub Action update changes the SHA and the
`# vX.Y.Z` comment together; if only one changed, something is wrong. Security updates ignore the cooldown on purpose.

**Updating a pinned action by hand.** Get the *commit* SHA of the tag (`git ls-remote --tags https://github.com/<owner>/<action>.git`
shows the tag object for annotated tags; use `<tag>^{}`), check the tag is at least two weeks old, and replace SHA and comment together.

## 19. Health check, metrics and the purge

**`GET /api/health`** (also `HEAD`): for an uptime monitor. `200 {"status":"ok","version":"<package version>","db":"up"}` when the database
answers a `select 1` (3 s timeout), `503 {"status":"degraded",...,"db":"down"}` when it does not. It reports nothing else: no environment, no
secret, no person, and it never calls Discogs (a monitor must not spend the shared budget). The answer is remembered for 30 seconds per
instance, so polling it hard does not become a stream of queries.

* Point a free uptime monitor (UptimeRobot, Better Stack, Healthchecks, your choice) at `https://<domain>/api/health`, **every 5 minutes**,
  alert on anything but 200. Every probe wakes the database: on a scale-to-zero Neon plan that keeps compute running. Check what your plan
  includes before choosing a shorter interval (not verified here).
* `503` with `db: down` means Neon is unreachable or the connection string is wrong: see sections 2 and 3. A `200` does **not** mean Discogs
  works; look at section 5 for that.

**The `[metrics]` line.** Each server instance counts events in memory and writes **one line a minute while it is busy** (nothing when idle):

```
[metrics] window=60s discogs_calls=12 cache_hits=48 cache_misses=12 throttled=0 cap_hits=1 upstream_errors=0
```

| Counter | Meaning |
| --- | --- |
| `discogs_calls` | requests actually sent to Discogs (each one used budget) |
| `cache_hits`, `cache_misses` | answers served from our cache, and lookups that had to go upstream (per record for batches) |
| `throttled` | our token bucket or a Discogs 429 said wait |
| `cap_hits` | the IP's or the person's cold allowance refused a request (nothing was sent to Discogs) |
| `upstream_errors` | Discogs answered 5xx or an unusable body, or the call failed |

There is one line per instance, so add the lines of a minute to get the app-wide numbers. They hold **no person, IP address, query or content**
(`tests/unit/metrics.test.ts`, `tests/unit/log-hygiene.test.ts`). Search the Vercel logs for `[metrics]`. A healthy quiet day: `cache_hits` well above
`cache_misses`, `discogs_calls` far below 60 a minute, `throttled=0`. Sustained `throttled` with few users: section 5.

**The daily purge** (`/api/cron/purge`, `vercel.json`) applies the retention rules of `docs/data-inventory.md`: expired Discogs cache rows,
expired verification rows and sessions, and rate-limit counters (ours and Better Auth's) whose window ended more than an hour ago. It never touches
accounts, users or lists. See what it would delete without deleting anything:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<domain>/api/cron/purge?dryRun=1"
# {"ok":true,"dryRun":true,"cacheRows":0,"verificationRows":2,"sessionRows":5,"rateLimitRows":31}
```

The end-to-end tests only ever call it with `?dryRun=1`, because the dev branch can hold copies of real accounts.

### 18a. The CI e2e job fails at "Apply the migrations": what it means and how to reproduce it

**What happened (2026-11-18, first run on GitHub).** `npm run db:migrate` printed `Migrations applied before: 0 of 3` and then
`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"` with empty parameters. The old script treated **any** error as "no migrations table yet" (so the "0 of 3"
swallowed a failed connection) and drizzle's "Failed query" wrapper hides the real error in `error.cause`; the Neon driver reports a failed websocket as a bare
`ErrorEvent` with no message. So the database was not reachable through the websocket path.

**Root cause (verified locally for the part that is ours).** `src/lib/neon-local.ts` set `neonConfig.wsProxy` to a **function** returning the bare proxy address.
The driver's own documentation (`node_modules/@neondatabase/serverless/CONFIG.md`) says only a **string** gets `?address=<host>:<port>` appended; a function must build
that query itself. The proxy was therefore asked for `/v1` with **no target address**, and wsproxy (which matches the address against `ALLOW_ADDR_REGEX`) refused
every connection. Recorded with a throwaway local server that logs what the driver requests: old config `-> /v1`, fixed config `-> /v1?address=postgres:5432`.
It is now a string, with a regression test (`tests/unit/neon-local.test.ts`, "the address the Neon driver really asks the proxy for").
**Not verified:** that the proxy and Postgres containers then work together in the Actions service network (no Docker here): only a run on GitHub shows that.

**What changed so the next run says exactly where it breaks.**

* `scripts/ci-db-probe.ts` runs before the migration and checks three stages, retrying for about 40 s: (1) the proxy answers HTTP, (2) a websocket to
  `ws://<proxy>?address=postgres:5432` opens, (3) Postgres answers an SSLRequest through it. A failure prints the stage and a hint, and fails the job
  immediately with an annotation.
* `scripts/db-migrate.ts` proves the connection (`select 1`, several tries) and, on failure, prints the whole redacted `cause` chain including the
  websocket address that was tried (`scripts/lib/db-error.ts`). Only a missing relation counts as "nothing applied yet".
* The proxy logs every connection (`LOG_CONN_INFO`), and a `docker logs` step prints the last lines of both service containers on failure.
* `NEON_WS_PROXY` is `127.0.0.1:5433/v1` (an address, not `localhost`, which removes any IPv6 or DNS doubt).
* The run ends with a step summary listing the failed tests, and the HTML report, traces and screenshots are the `playwright-failure-<run>` artifact.

**Reading a failure.** Stage 1 fails: the proxy container did not start or the port mapping is wrong (`ports: 5433:80`). Stage 2 fails or the socket closes at
once: the proxy refused the address (it only allows `^postgres:5432$`) or cannot resolve or reach `postgres` (look at the `wsproxy` log: it prints the
address it tried and the error). Stage 3 fails with an ErrorResponse or an unexpected byte: something answers that is not Postgres. Authentication errors
appear in the migrate output (`28P01`): the credentials in the job's `DEV_DATABASE_URL` and the service's `POSTGRES_PASSWORD` must match.

**Reproduce locally (Git Bash, Docker Desktop; not run by the author, so treat as untested).**

```bash
# ===== LOCAL COPY OF THE CI DATABASE PATH =====
docker network create vinilium-e2e
docker run -d --name vin-pg --network vinilium-e2e -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=vinilium_e2e \
  postgres:17-alpine@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7
docker run -d --name vin-wsproxy --network vinilium-e2e -p 5433:80 -e ALLOW_ADDR_REGEX='^vin-pg:5432$' -e LOG_CONN_INFO=true \
  ghcr.io/neondatabase/wsproxy@sha256:7f2e2149aa6a57ba382a140102fba44f5053f3e44389ccc18adcecf896054efb
export DEV_DATABASE_URL='postgresql://postgres:postgres@vin-pg:5432/vinilium_e2e'   # the host name the PROXY resolves
export NEON_WS_PROXY='127.0.0.1:5433/v1'
export NODE_OPTIONS='--dns-result-order=ipv4first'
npx tsx scripts/ci-db-probe.ts && npm run db:migrate
docker logs vin-wsproxy; docker logs vin-pg | tail -20
# then the suite (this is a throwaway database, never your DEV branch):
CI=true npx playwright test
# clean up:  docker rm -f vin-pg vin-wsproxy && docker network rm vinilium-e2e
```

**Status:** the proxy and Postgres containers were confirmed working together by the second run's log; what failed next is in 18c.

### 18c. The CI e2e job, second run (2026-11-18, run 44290044943): what failed and why

The first fix worked: in that run the probe printed `probe ok (attempt 1)` and `db:migrate` printed `Migrations applied now: 3 of 3`, so the Postgres and wsproxy service containers
**do** work together in the Actions network (read from the log; this settles the "unverified" in 18a). The suite then stopped after 38 seconds, `30 passed, 27 failed, 492 did not run`. Two separate causes:

1. **The test side used a second copy of the database driver (the root cause that matters).** The sign-in setup and the teardown failed with a bare `ErrorEvent` after 0.4 s. `@neondatabase/serverless` is a dual package (`require` loads `index.js`, `import()` loads `index.mjs`) and Playwright compiles test files to CommonJS, so `tests/helpers/e2e-db.ts` wrote the proxy setting to the CommonJS copy while the specs built their `Pool` from `await import(...)`, the ESM copy, which still tried a real `wss://postgres/v2`. Proved locally: a probe test printed `same neonConfig instance: false`. It never showed locally because with no `NEON_WS_PROXY` the setting is inert. Fix: every test-side connection comes from `e2ePool()` (one dynamic import for the config **and** the pool); `tests/unit/e2e-db-access.test.ts` fails if a spec builds its own pool. The failure text is now the redacted cause chain (`explainDbError`), not a bare event. Reproduced locally the CI way (below) and the setup passes through the proxy.
2. **Firefox and WebKit projects ran on a Chromium-only runner.** `playwright.config.ts` defined them unconditionally (the comment said "not part of CI"); the job installs Chromium only, so 26 tests died with `Executable doesn't exist`. On CI they now exist only with `E2E_EXTRA_BROWSERS=1`; on a developer machine nothing changed.

**A local, Docker-free copy of the CI path** (what the author used: a Postgres-compatible PGlite behind a small websocket-to-TCP bridge that answers like wsproxy, `CI=true`, `NEON_WS_PROXY=127.0.0.1:5433/v1`, host `postgres:5432` in `DEV_DATABASE_URL`, two workers) ran the probe, the migrations, the setup and the signed-out tests green. It is **not** a faithful Postgres: one test (`discogs.spec.ts`, "resolves albums' own titles...") failed there because the master rows were missing from `discogs_cache` right after the first request, and the same test **passed against the real DEV branch on Neon**. I did not find the cause inside PGlite's connection multiplexer; treat the PGlite result as a harness limit, and the GitHub run (real Postgres 17) as the verdict.

**Slow test, fixed at the cause.** `discogs.spec.ts` "Back / reload restores..." sent 76 requests one after another; against the remote DEV branch each is a database round trip (about 0.4 s) and the test hit its 30 s limit. The repeats now go five at a time (the limiter counts requests, not timing), so it no longer depends on network distance.

### 18b. Dated reminder: the picomatch audit exception expires on 2026-12-31

`npm run audit:prod` passes today only because `.audit-allowlist.json` lists **one** advisory, picomatch GHSA-fc5q-39xc-vjpf (ReDoS in glob matching, range <=4.0.7, no patched release when it was reviewed on 2026-11-18). The entry **stops working on 2026-12-31**, and the `audit` job then fails on purpose. What to check, in order:

1. `npm view picomatch version` and `npm view picomatch time --json`: is there a release above 4.0.7 that the advisory marks as fixed?
2. `npm ls picomatch`: which paths still resolve to a vulnerable copy (the production path is `next-intl` > `@parcel/watcher` > `picomatch`; the rest is test tooling).
3. A fix exists: accept Dependabot's pull request (it waits 14 days by design) or run `npm update picomatch`, run `npm run audit:prod` and the unit tests, then **delete the entry** from `.audit-allowlist.json` in the same commit.
4. No fix yet: re-read the justification in the entry (extractor not enabled, no visitor-controlled pattern, no copy in the serverless output: `grep -rl picomatch .next/server .next/static` after a build), then move `reviewed` and `expires` forward in one small commit with the reason. Do not widen the entry (one advisory id, no wildcards: the gate refuses anything else).
