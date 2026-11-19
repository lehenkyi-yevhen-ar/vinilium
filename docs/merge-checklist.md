# Merge checklist: pull request #1 (`autonomous/hardening`) into `main`

Written for the owner, who does every merge, push and dashboard step. Nothing here was done by the agent. Items marked **(unverified)** could not be
checked from the repository or the command line and need your eyes. Variable names only: never paste a value into this file, a chat or an issue.

## 1. Before you press merge

| Check | Where | Expected |
| --- | --- | --- |
| `CI / checks`, `CI / audit`, `CI / e2e` | PR > Checks | green (e2e was red on the first runs; see the run report for the causes and the fixes) |
| `CodeQL` | PR > Checks, Security > Code scanning | the "Incomplete URL substring sanitization" alert closed (the flagged line was `tests/unit/input-fuzz.test.ts:209`) |
| `Secret scan / gitleaks` (pull-request range) | PR > Checks | green |
| `Secret scan / full history` | runs on **push to `main`**, weekly, on demand | **red until decision 6c** (`docs/decisions-needed.md`): 11 older findings in history. Listing the seven test-file fingerprints first leaves 4 (the first commit's `.env.example`). It does not block a deploy: Vercel does not wait for GitHub checks unless you configured that **(unverified)** |
| Branch is not behind `main` | PR page | no conflicts |
| `docs/pre-launch-checklist.md` | repo | you have read "Known open items"; none of them blocks the merge, all of them are yours |

**No database migration is needed.** `git diff main --stat -- drizzle src/server/db/schema.ts` is empty (verified): the three migrations already on production are all there is. Do not run `db:migrate` against production for this merge. `npm run db:status` with `DATABASE_URL` supplied for that one command (read-only) shows whether production has all three applied.

## 2. What happens on Vercel after the merge

1. GitHub tells Vercel about the new commit on `main`; Vercel builds it and, if the build succeeds, promotes it to **Production** (`https://vinilium.vercel.app`). This assumes the Git integration is connected and Production Branch is `main` (Vercel > Project > Settings > Git) **(unverified)**.
2. The pull request itself may already have produced a **Preview** deployment of the branch. Preview uses the *Preview* environment's variables, which may be empty **(unverified)**: a broken preview is not a sign that production will break, but a Preview that talks to the production database would be: check that `DATABASE_URL` is set for **Production only** (Settings > Environment Variables).
3. Variables are read at **build** time for `NEXT_PUBLIC_*` (inlined into the page code) and at run time for the rest. After changing any variable, **Redeploy** (Deployments > latest > Redeploy); a changed `NEXT_PUBLIC_*` value only shows after a *new build*.
4. The daily purge is `vercel.json`: `/api/cron/purge` at `17 3 * * *` (once a day, valid on Hobby; unchanged from `main`). Vercel sends `Authorization: Bearer <CRON_SECRET>` by itself.

## 3. Environment variables (Production), by name

**Required for the app to work:**

| Name | Notes |
| --- | --- |
| `DATABASE_URL` | the **production** Neon branch (pooled string). Production only; never in `.env.local` |
| `BETTER_AUTH_SECRET` | 16+ characters, random |
| `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` | `https://vinilium.vercel.app` (both) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; the redirect URI in Google Cloud must be `https://vinilium.vercel.app/api/auth/callback/google` |
| `DISCOGS_CONSUMER_KEY`, `DISCOGS_CONSUMER_SECRET` | set both or neither |
| `CRON_SECRET` | 16+ characters; the purge endpoint is disabled without it |
| `EMAIL_PROVIDER` (`brevo`), `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | verification and reset mails (they land in spam; accepted) |
| `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_COUNTRY`, `APP_CONTACT` | legal pages and the Discogs User-Agent; `APP_CONTACT` = `https://vinilium.vercel.app/en/contact` |
| `NEXT_PUBLIC_APP_NAME` | optional, default "Vinilium" |

**Optional, leave unset unless you decide otherwise:** `CSP_MODE` (**keep report-only: unset or `report-only`**; `enforce` only after about a week of `[csp-report]` logs, decision 2), `HSTS_MAX_AGE_SECONDS` and `HSTS_INCLUDE_SUBDOMAINS` (decision 3: unset), `AUTH_EMAIL_PASSWORD_ENABLED`, `AUTH_SIGNUP_ALLOWLIST` (decision 1), `DISCOGS_CACHE_TTL_SECONDS` (unset, or at most `21600`), `RL_*` limits, `NEXT_PUBLIC_CONTACT_TELEGRAM`.

**Must NOT exist in Vercel:** `DEV_DATABASE_URL`, `NEON_WS_PROXY`, `DISCOGS_API_BASE`, `BREVO_API_BASE`, `DISCOGS_TOKEN` (the key and secret pair is used), `RESEND_API_KEY` (unused). Test-only variables are ignored or refused in production, but they should not be there.

New since the last production deploy: only the optional `CSP_MODE` and `HSTS_*` (no existing variable changed meaning). If the secret-rotation checklist in `docs/decisions-needed.md` (6c) applies to you, do it **after** this deploy has been verified, as a separate Redeploy, so a problem is attributable.

## 4. Verify after the deploy (about 10 minutes)

1. Vercel > Deployments: the new deployment is **Ready** and marked Production; open its build log and confirm there are no errors.
2. `https://vinilium.vercel.app/api/health` answers `200` and `{"status":"ok","version":"...","db":"up"}`. `503` with `db: down` means `DATABASE_URL` is wrong or Neon is unreachable (`docs/operations.md`, section 19).
3. Response headers on `/en` (browser dev tools > Network, or `curl -sI https://vinilium.vercel.app/en`): `Content-Security-Policy-Report-Only` present, **no** `Content-Security-Policy` (report-only mode), no `Strict-Transport-Security` unless you set it on purpose.
4. Vercel > Logs, filter Production, a few minutes of use: no `500`, no `[email] ... reason=` errors, `[csp-report]` lines are expected and are what you read for the enforce decision.
5. The purge: Vercel > Cron Jobs shows `/api/cron/purge`. Try it by hand first with `?dryRun=1` (it deletes nothing): `curl -H "Authorization: Bearer <CRON_SECRET>" "https://vinilium.vercel.app/api/cron/purge?dryRun=1"` returns `{"ok":true,"dryRun":true,...}`. Run it in your own shell; do not paste the secret anywhere.
6. Set up (or check) the uptime monitor on `/api/health` every 5 minutes (`docs/operations.md`, section 19).

## 5. Rolling back

* **Instant Rollback** (Vercel > Deployments > the previous Production deployment > **Instant Rollback**, or `vercel rollback`): re-points the Production domain at an earlier deployment without a rebuild. **On the Hobby plan Vercel's documentation says you can only roll back to the immediately previous production deployment** ([docs](https://vercel.com/docs/instant-rollback)); I could not check what your plan shows **(unverified)**. Rolling back does not change environment variables, the database or cron settings, and **auto-assigning of the Production domain stops** until you promote a new deployment again.
* If the previous deployment is not offered: `git revert -m 1 <merge commit>` on a new branch, open a pull request, merge (you push; the agent does not).
* A bad **variable** is not fixed by a rollback: change or delete it, then **Redeploy**.
* No schema change is part of this merge, so there is nothing to undo in Neon. Neon's restore window (`docs/operations.md`, section 7) is for data problems, not for this.

## 6. Smoke checklist by hand on https://vinilium.vercel.app

Use a private window for the first pass, then a signed-in session.

**Sign-in and account**
- [ ] `/en` loads; `/` redirects to your language. The footer shows "Data provided by Discogs." with its link and the non-affiliation notice.
- [ ] **Sign in with Google** completes and returns to the app (a person not on Google's test-users list may or may not get in: the "Testing mode" behaviour is unexplained, so note what happens).
- [ ] Email + password: sign up shows the **"nothing arrived?"** spam note on every screen that sends mail (sign-up, resend, forgot password); a mail does arrive, probably in spam.
- [ ] Sign out; protected pages send you to sign-in and bring you back to the **same step** after signing in.

**Search flow** (track, artist, album, exact pressing, release card)
- [ ] Each step opens; every **Back** link and the browser Back button return to the same step with the same results; reload keeps the place; a copied link opens the same step after signing in.
- [ ] Album covers load (images come through our proxy; they fail for a signed-out visitor, by design). The release card has the Discogs attribution next to the data.
- [ ] "How to search" is collapsed on a phone-width window and open on desktop.

**Lists**
- [ ] Add a release to the Wishlist and to the Collection; edit notes and condition; move between lists; remove. Reload: the changes stayed. CSV export downloads.

**Theme and language, at phone width (about 390 px; the browser's responsive mode is enough for the first pass, a real phone for the second)**
- [ ] The theme switcher (dark, light, system) works on every screen; dark is the default; no flash of the wrong theme after reload.
- [ ] The language menu opens as a bottom sheet on a phone; uk, en and nb change the whole page and keep the URL structure; nothing is cut off, no horizontal scroll.

**Public pages and errors**
- [ ] `/en/privacy`, `/en/terms`, `/en/contact` (and the uk and nb versions) load without signing in; the contact page shows the configured email.
- [ ] A made-up address such as `/en/does-not-exist` shows the real **404 page** inside the layout (status 404, language and theme switchers still there).
- [ ] `/robots.txt` and `/sitemap.xml` load and list only the public pages.

**Then**
- [ ] Vercel logs show no new errors from the pass above.
- [ ] Safari on a real iPhone and a real Android phone: **never tested by anyone** (the automated runs use Chromium, desktop and phone emulation); do one pass before announcing the site.
