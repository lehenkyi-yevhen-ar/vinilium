# Decisions needed from the owner

These are product or policy choices that are yours. Nothing here has been implemented except where a row says so. Each has options and a
recommendation; reply with the number and the choice, or ignore the ones you are happy to leave as they are.

## 1. Which sign-in methods stay open

| Option | What changes | Cost |
| --- | --- | --- |
| **A. Keep email + password and Google, open sign-up (today)** | nothing | Every sign-up sends an email; the free Brevo plan stops at 300 a day, and mail lands in spam (ADR 0004). A script can use the quota up in minutes |
| B. Email + password plus `AUTH_SIGNUP_ALLOWLIST` (invite only) | you list the people | You maintain a list; nobody else can join |
| C. Google only (`AUTH_EMAIL_PASSWORD_ENABLED=false`) | no email is sent at all; no password to leak | Everyone needs a Google account; password-only accounts cannot sign in (whether they can come back through Google with the same email is **untested**) |

**Recommendation: A for now, with the switches ready.** Watch `[email] ... reason=rate_limited` in the logs for a few weeks. If the quota is ever
reached, or sign-ups start looking like abuse, flip to B or C in Vercel and redeploy (operations.md, section 15). It needs no code change.

## 2. When to turn the CSP from report-only to enforcing

`CSP_MODE=enforce` is built, tested in a real browser on every page and language, and the whole e2e suite was run with it (see the run report).
**Recommendation: deploy as is (report-only), read `[csp-report]` in the Vercel logs for about a week of normal use, then set `CSP_MODE=enforce`
and redeploy.** Rollback is deleting the variable and redeploying. Steps: operations.md, section 10. Trade-off: enforcing also blocks the scripts
that some browser extensions inject, so one person's extension may stop working on this site.

## 3. HSTS

Off by default. It must only be switched on once every page, the Google redirect and email links work over HTTPS, and a browser remembers it for the
whole period. Without a custom domain there is no `includeSubDomains` question, but you also cannot undo it quickly for a host you do not
control. **Recommendation: leave it unset until a domain exists, then 300, 86400, 31536000 in steps** (operations.md, section 10).

## 4. Sessions and "sign out other devices"

Better Auth supports listing sessions and revoking the others without a new dependency. A session row stores an IP address and a browser
description, which is why showing them is a privacy decision as well as a UI one. **Recommendation: show the browser description and the
date only (never the IP address), with a "Sign out other devices" button.** **Status: not implemented** in this run (it needs new strings in three languages and a design pass; Better Auth's `listSessions` and `revokeOtherSessions` are available when you decide).

## 5. Do you want search engines to index the site?

`robots.txt` and `sitemap.xml` now exist and expose only the public pages (home, contact, privacy, terms in three languages); the app screens and
the API are disallowed. Open Graph tags are on the public pages only. **Recommendation: keep as is.** If you prefer the site not to be indexed at all, change
`robots.ts` to `disallow: "/"` and remove `sitemap.ts` (one commit).

## 5b. Repository visibility

The repository is private. CodeQL and secret scanning on GitHub are free for public repositories; for a private one they need GitHub Advanced
Security (a paid feature on organisations; on a personal private repository check what your plan includes). The CodeQL workflow may fail to
upload results while the repository is private and without that feature. **Recommendation: stay private until the legal review is done and the
Discogs Terms question about public code is settled, and judge the CodeQL result when the first run appears.** Dependabot version updates work on
private repositories; the gitleaks job works on a personal account.

## 6. Two-factor sign-in or passkeys

Not built. **Recommendation: not now.** The data is a wishlist; the risk is low and each factor adds support work for one operator. Revisit if
the app grows past friends.

## 6b. `npm run audit:prod` was red (2026-11-18): decided and implemented, for you to confirm

**Facts (verified).** `npm audit --omit=dev` reports 10 findings: 4 moderate (esbuild, a development-server advisory, reached through `drizzle-kit`) and
6 high, all the **same** advisory, picomatch GHSA-fc5q-39xc-vjpf (ReDoS in glob matching, range `<=4.0.7`). **4.0.7 is the latest release, so there is no
patched version**; `npm audit fix` would only downgrade `vitest` and `drizzle-kit`, and nothing was run with `--force`. `package.json` is correct (vitest,
vite, drizzle-kit, tsx are `devDependencies`); `--omit=dev` still lists them because `better-auth` names `vitest` and `drizzle-kit` as *optional peer*
dependencies, which npm counts as production edges (the lockfile marks them `devOptional`). The only truly production path is
`next-intl` -> `@parcel/watcher` -> `picomatch`; `next-intl` uses `@parcel/watcher` in its experimental message *extractor*, with a fixed list of
ignore globs, and this app does not enable the extractor. `picomatch` appears in no traced serverless file (0 matches in `.next/server` and `.next/static`).
Real impact for this app: none that a visitor can reach.

**Decision implemented (option c).** `npm run audit:prod` is now `scripts/audit-gate.ts`: it fails on any **new** high or critical advisory, and passes with a
warning on an advisory listed in `.audit-allowlist.json`. An entry covers one advisory id (no wildcards, no package-wide ignore), must carry a justification
and a review date, and **stops working on its expiry date** (this one: 2026-12-31, 43 days), after which the job fails again until someone re-reviews it. An
invalid allowlist fails the gate. Tests: `tests/unit/audit-gate.test.ts`.

**Update 2026-11-19: the entry was removed.** The CI `audit` job printed "the allowlist entry GHSA-fc5q-39xc-vjpf (picomatch) matches no advisory any more: remove it", and a local
`npm run audit:prod` says the same: `npm audit --omit=dev` now reports only the 4 moderate esbuild findings and no high one (picomatch is still 4.0.7, so the advisory itself
was changed or withdrawn in the advisory database; I did not find out which). `.audit-allowlist.json` is now `[]`. The gate is unchanged: any **new** high or critical advisory
fails the job, and an exception can be added again (id, justification, review date, expiry) if this one comes back. The text below is the history of the decision.

**What you still decide (history):** whether you accept that one exception (it is yours to veto: delete the entry and the gate goes red again). Re-check it
when picomatch publishes a fix (Dependabot will propose it, with its 14-day cooldown), and in any case by 2026-12-31.

## 6c. gitleaks: 11 older findings in main's history (found 2026-11-18, full-history scan)

The new full-history job scans everything reachable from `main` with gitleaks 8.24.3 and `.gitleaks.toml`. It reports **11 findings, all rule `generic-api-key`**
(redacted; commits are short ids): `a6013f44` (the first commit): `.env.example` lines 12, 20, 25, 45 and the fake session secrets in `tests/unit/auth-links.test.ts:5` and
`tests/unit/email.test.ts:9`; `9f3db890`: `tests/unit/email-providers.test.ts:139`, `tests/e2e/auth-modes.spec.ts:233` and `:252`; `b01c7c9b`: `playwright.config.ts:53`
and `tests/helpers/env.ts:21`. **I allow-listed none of them** (you asked for exactly the two findings of this pull request), so the full-history job on `main` will fail
until you decide.

* **Test files (7 findings):** made-up strings (`0123456789abcdef...`, `test-secret-...`, a cron secret of digits). Not credentials. Safe to allow-list by fingerprint.
* **`.env.example` in the first commit (4 findings): not certain.** The values on lines 12 (`BETTER_AUTH_SECRET`, 44 characters, 43 distinct, base64-looking),
  20 (`GOOGLE_CLIENT_SECRET`-shaped), 25 (`RESEND_API_KEY`-shaped) and 45 (`DISCOGS_CONSUMER_SECRET`-shaped) look random, not like words, and none of them equals the value in
  your current `.env.local` or `.env.example`. You told me earlier they were fake key-shaped placeholders (GitHub push protection flagged them and you allowed them); I cannot prove that.
  **If any of them was ever a real credential, rotate it:** `BETTER_AUTH_SECRET` (Vercel; signs everyone out), the Google client secret, the Resend key (unused here), the Discogs key and secret.
  If they were made-up placeholders, nothing to rotate; add their fingerprints to `.gitleaksignore` (lines below) with that reason.
* **`CRON_SECRET`: rotate only if** the value in Vercel equals one of the strings that were committed (`cron-secret-0123456789`, `SECRET-CRON-0123456789`,
  `e2e-cron-secret-0123456789`). They were made up for tests, so a real random value cannot match; compare once by eye. Rotation has no user-visible effect (section 3 of `operations.md`).

### What to do, in this order

**Step 1: the seven made-up test strings (safe now).** They are fixtures in test files (`0123456789abcdef...`, `test-secret-...`, a cron secret of digits), made up for a test and never used for anything. Append this block to `.gitleaksignore` (the file's test requires the comment lines; each entry matches exactly one line of one commit, so it can never hide a future secret):

```
# Seven made-up test fixtures in old commits (reviewed 2026-11-19): strings invented for a test, never a credential, never used anywhere.
# Commit 9f3db890 (email providers and sign-up modes): the fake keys of the Brevo/Resend provider tests and the auth-modes spec.
9f3db890ebcb053115c4011a53ff3699032cb6e8:tests/e2e/auth-modes.spec.ts:generic-api-key:233
9f3db890ebcb053115c4011a53ff3699032cb6e8:tests/e2e/auth-modes.spec.ts:generic-api-key:252
9f3db890ebcb053115c4011a53ff3699032cb6e8:tests/unit/email-providers.test.ts:generic-api-key:139
# Commit b01c7c9b: the fake session and cron secrets in the Playwright config and the unit-test env helper.
b01c7c9bcf94f00be1b09f03267909c8ea2b55d8:playwright.config.ts:generic-api-key:53
b01c7c9bcf94f00be1b09f03267909c8ea2b55d8:tests/helpers/env.ts:generic-api-key:21
# Commit a6013f44 (the first commit): fake session secrets set inside two unit tests.
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:tests/unit/auth-links.test.ts:generic-api-key:5
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:tests/unit/email.test.ts:generic-api-key:9
```

Verified: all seven lines exist at those commits and all seven commits are ancestors of `origin/main`. **Not re-run here:** gitleaks itself was not installed in this session, so the fingerprints come from the earlier scan (2026-11-18); the first full-history run on GitHub after you add them will confirm them.

**Step 2: the four findings in the first commit's `.env.example`: NOT allow-listed, on purpose.** They are lines 12 (`BETTER_AUTH_SECRET`), 20 (`GOOGLE_CLIENT_SECRET`), 25 (`RESEND_API_KEY`) and 45 (`DISCOGS_CONSUMER_SECRET`) of commit `a6013f44`. Their values look random and I cannot prove they were placeholders. **Add the block below only after you have decided that nothing real was ever in them (or after you rotated what was):**

```
# Four values in the first commit's .env.example (a6013f44), reviewed by the owner on <DATE>: <made-up placeholders, never used> OR <real values that were
# ROTATED on <DATE>, so the leaked values no longer work>. Pick one sentence and delete the other.
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:.env.example:generic-api-key:12
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:.env.example:generic-api-key:20
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:.env.example:generic-api-key:25
a6013f44ae00ef7fdcd6a46a2d22cdd8288add70:.env.example:generic-api-key:45
```

**Effect on the "full history" job** (`Secret scan`, push to `main`, weekly, manual): today it reports 11 findings and fails. After step 1: 4 findings, still failing. After step 1 and step 2: 0 findings, green. Rotating does **not** turn the job green by itself: history stays as it is (this repository's history was not and will not be rewritten by the agent), so the job only goes green once the fingerprints are listed. That is the right order: rotate first (the old value is then dead), then list the fingerprint, with the date and the reason in the comment. The pull-request scan (the range of the PR) is already green and is unaffected.

### Rotation checklist (names only: no value is ever written here)

Do this **only if** any value in the first commit's `.env.example` was ever a real credential, or you are not sure. If you are sure they were placeholders, skip it and go to step 2. Order matters: new value first, revoke the old one last, so there is no gap (`docs/operations.md`, section 3).

| # | Name | Rotate when | Where | What breaks and how long | How to verify |
| --- | --- | --- | --- | --- | --- |
| 1 | `BETTER_AUTH_SECRET` | the value in the first commit was ever used in Vercel (Production) | Vercel > Settings > Environment Variables: a new random value (`openssl rand -base64 32`) | **Everyone is signed out**; nothing is lost; nobody needs to reset a password | Redeploy, open the site in a private window, sign in again; `/api/health` is 200 |
| 2 | `GOOGLE_CLIENT_SECRET` | the Google client secret of the first commit was ever the real one | Google Cloud > Google Auth Platform > Clients > add a NEW secret; put it in Vercel; Redeploy; **then** disable and delete the old one | Nothing for users if the order is kept; Google sign-in fails between "old deleted" and "Redeploy done" | Sign in with Google on the live site after the Redeploy |
| 3 | `DISCOGS_CONSUMER_KEY` and `DISCOGS_CONSUMER_SECRET` | the Discogs pair of the first commit was ever the real application key | Discogs > Settings > Developers > your application: generate a new pair, put **both** in Vercel, Redeploy | Until updated, release details show the "not set up" or error state | Open a release card on the live site; the Vercel log shows no `discogs` 401 |
| 4 | `RESEND_API_KEY` | only if Resend was ever really used (this app sends through Brevo) | Resend > API Keys: delete the key | Nothing (unused) | n/a |
| 5 | `CRON_SECRET` | only if the value in Vercel equals one of the made-up strings committed in tests (`cron-secret-0123456789`, `SECRET-CRON-0123456789`, `e2e-cron-secret-0123456789`); a random value cannot | Vercel: a new value of 16+ characters | Nothing user-visible; Vercel Cron sends the new value by itself | `curl -H "Authorization: Bearer <value>" ".../api/cron/purge?dryRun=1"` answers 200 (run it in your shell; do not paste the value anywhere) |

**The test session secret (the "low-entropy" warning in the CI log).** Better Auth prints `BETTER_AUTH_SECRET appears low-entropy` during the e2e run because the test server is given a made-up phrase, repeated, as its secret: it is set only in `playwright.config.ts` (the env of the app server under test) and in `tests/e2e/auth-modes.spec.ts` (its two extra servers). No workflow sets it, the CI job has no secrets at all, and unit tests use `FAKE_AUTH_SECRET` (a repeated letter, `tests/helpers/fake-secrets.ts`). It is about 2.5 bits of entropy per character (a repeated phrase), well under gitleaks' threshold, and the pull-request secret scan is green with it. It was never a production value as far as the repository shows, but the repository cannot show what is in Vercel: **compare once, by eye, that the value of `BETTER_AUTH_SECRET` in Vercel (Production) is not that phrase** (it must be a long random value; if it is the phrase, rotate it as in row 1 above). The warning is harmless for a test server and is left as it is.

After any change in Vercel: **Redeploy** (Deployments > the latest > Redeploy; variables are read at deploy time). Then read the Vercel logs for a few minutes for `401`, `403` or `[email]` errors. Brevo (`BREVO_API_KEY`) is not in the first commit, so it is not part of this list.

(The local branch `backup/pre-history-rewrite` has 6 more findings in commits `65477321` and `38dfea4b`; that branch is not on GitHub, so CI never sees them.)

## 7. Items only you can check (not decisions, but open)

* **Discogs "Application Name and Description Policy"**: it was not part of the pasted Terms. Check that the app name and the description
  registered at Discogs comply.
* **`APP_CONTACT`**: becomes `https://<domain>/en/contact` once a domain exists; today it is a placeholder.
* **The Lis design-system licence and the font credits** (Ermilov, KyivType Sans CC BY-ND 4.0): confirm the licence of the vendored files and that the
  credit shown in the footer is what the licences ask for.
* **Native-speaker review** of the Ukrainian and Norwegian text, including the strings written in this run: `docs/i18n/doubtful-strings.md`.
* **Every `[NEEDS LEGAL REVIEW]` mark** (`npm run legal:checklist`), including the new one about how long Vercel keeps server logs.
