# Pre-launch checklist

> **The single, ordered list for the owner is now [LAUNCH.md](LAUNCH.md).** This file stays as the long form with its "Verified" notes; where the two differ, LAUNCH.md and [decisions-needed.md](decisions-needed.md) (section 0, decided 2026-11-23) are current.

Tick each item yourself. "Verified" says what was actually checked and by whom; everything else is open. Last updated 2026-11-19 (PR #1 follow-up,
`docs/autonomous-run-report.md`). The section "Known open items" at the end lists what is still undecided; none of it was decided by the agent.

## Legal and policy

- [ ] **Every `[NEEDS LEGAL REVIEW]` mark** is resolved by a lawyer: `npm run legal:checklist` lists them (it fails while any remain:
      `npm run legal:checklist -- --check`). One more was added in this run (how long Vercel keeps server logs).
- [ ] Set `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_COUNTRY` and `NEXT_PUBLIC_CONTACT_EMAIL`; change the "Draft of ..." date lines.
- [ ] The privacy text matches `docs/data-inventory.md` (cross-checked in this run; mismatches fixed are in the run report).
- [ ] **Native-speaker review** of the Ukrainian and Norwegian text, starting with `docs/i18n/doubtful-strings.md`.

## Discogs

- [ ] **Application Name and Description Policy** (not part of the pasted Terms): check the app name and description registered at Discogs.
- [ ] `APP_CONTACT` = `https://<domain>/en/contact` once a domain exists (today a placeholder).
- [ ] `DISCOGS_CONSUMER_KEY` / `_SECRET` are set in Vercel (Production); `DISCOGS_CACHE_TTL_SECONDS` is unset or at most `21600`.
- [ ] The Discogs account email is monitored (the Terms can change "via account email or otherwise").
- [ ] Every rule still maps to code and a test: `docs/discogs-compliance.md`, section "Rule, code and test".

## Security

- [ ] **CSP rollout**: deploy report-only, read `[csp-report]` for about a week, then `CSP_MODE=enforce` (operations.md, section 10).
- [ ] **HSTS**: leave `HSTS_MAX_AGE_SECONDS` unset until HTTPS works on every page, the Google redirect and the email links; then step 300,
      86400, 31536000. Without a custom domain it stays off (decision 3 in `docs/decisions-needed.md`).
- [ ] Rotate nothing now, but know how: operations.md, section 3.
- [ ] `CRON_SECRET` is set in Vercel (16+ characters) and the daily purge has run once (Vercel > Cron Jobs; `?dryRun=1` shows what it would delete).
- [ ] **Repository visibility** decided (decision 5b): CodeQL and secret scanning on a private repository.
- [ ] The **GitHub Actions run of PR #1** is green: `checks`, `audit`, `e2e`, CodeQL, secret scan (pull-request range). The `e2e` job failed on its first two runs (wrong proxy address, then the test side using a second copy of the database driver, plus Firefox/WebKit projects on a Chromium-only runner); both fixed, see the run report. The full-history secret scan stays red until decision 6c is made.
      Then turn on branch protection for `main` and Dependabot alerts.

## Content and credits

- [ ] **The Lis design system licence**: confirm the vendored files' licence and any attribution it asks for.
- [ ] **Fonts**: Ermilov (free to use) and KyivType Sans (CC BY-ND 4.0: do not modify or convert; credit is in the footer). Confirm the footer credit is what the licence asks for.
- [ ] No ads, no donations, no affiliate links, no public sharing pages of Discogs data (checked by review, not by a test).

## Email

- [ ] Run the by-hand deliverability test (`docs/email-deliverability-test.md`) with real mailboxes in all three languages.
- [ ] Decide the long-term sender (decision 1): stay on Brevo with a free-mail sender, or buy a domain and authenticate it (then change the
      "nothing arrived?" wording).
- [ ] `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_PROVIDER=brevo` set; Brevo's authorised-IP list is **off**.

## Data

- [ ] Run `docs/ops/dev-cleanup.sql` on the **DEV** branch (confirm the branch id first) so no real person's data sits in a development database.
- [ ] A backup restore was tested into a **new** Neon branch (operations.md, section 7). Know your Neon plan's restore window and state it in the
      privacy policy.
- [ ] `npm run db:status` shows all migrations applied on production (run by you, with `DATABASE_URL` supplied for that command).

## Operations

- [ ] An **uptime monitor** polls `/api/health` (operations.md, section 19): every 5 minutes, alert on a non-200.
- [ ] You know where the logs are and which lines matter (operations.md, section 2): `[email]`, `[csp-report]`, `[metrics]`.
- [ ] The `[metrics]` line appears once a minute while the app is busy (operations.md, section 19).

## Accessibility and devices

- [ ] The manual accessibility checks in operations.md, section 11 (keyboard only, 200% and 400% zoom, a screen reader, forced colours).
- [ ] **Real devices**: the automated runs use Chromium (desktop and a phone emulation). A real iPhone (Safari), a real Android phone and
      Firefox desktop have **not** been tested by anyone; do a pass before announcing the site.

## Dependencies

- [x] **picomatch audit exception: removed 2026-11-19.** The CI `audit` job reported the entry stale (no advisory matches it any more) and `.audit-allowlist.json` is now `[]`. Nothing to check on 2026-12-31 unless the advisory comes back: then `npm run audit:prod` fails by itself, and `docs/operations.md` section 18b says what to do.

## Known open items (undecided: kept visible, not decided by the agent)

- [ ] **Sign-in methods and email** (decision 1): keep email + password (mails go to spam, accepted), go invite-only with `AUTH_SIGNUP_ALLOWLIST`, or Google-only with `AUTH_EMAIL_PASSWORD_ENABLED=false`. Whether a password-only account can come back through Google with the same email is untested.
- [ ] **Google "Testing mode" behaviour is unexplained**: a third account that is not on the test-users list signed in. Find out why before relying on the list as an access control.
- [ ] **Publishing the Google app**, and whether Google accepts `vercel.app` as an authorized domain: **unverified** (no custom domain is planned).
- [ ] **6 open `[NEEDS LEGAL REVIEW]` marks** (`npm run legal:checklist`; down from 15 on 2026-11-23, see [legal-accuracy-review.md](legal-accuracy-review.md): the privacy and terms texts were checked against the code and public sources, which is not a lawyer's review, and the pages say so in a notice at the top).
- [ ] **Native-speaker review of uk and nb**: `docs/i18n/review-uk-nb.csv` (import with `npm run i18n:import`) and `docs/i18n/doubtful-strings.md`.
- [ ] **HSTS**: only after HTTPS is confirmed everywhere (decision 3); `HSTS_MAX_AGE_SECONDS` stays unset until then.
- [ ] **CSP enforce rollout**: report-only first, read `[csp-report]` for about a week, then `CSP_MODE=enforce` (decision 2). `CSP_MODE` stays report-only on the first deploy of PR #1.
- [ ] **Discogs Application Name and Description Policy**: check the name and description registered at Discogs.
- [ ] **`APP_CONTACT`** = `https://vinilium.vercel.app/en/contact` in Vercel (Production).
- [ ] **Repository visibility** (decision 5b): private for now; CodeQL upload and secret scanning depend on the plan.
- [ ] **Lis design-system licence and font credits** (KyivType Sans, CC BY-ND 4.0: do not modify or convert the font files).
- [ ] **DEV cleanup SQL not yet run** (`docs/ops/dev-cleanup.sql`, DEV branch `br-empty-band-b9f6dxji`, in the Neon SQL Editor, by you).
- [ ] **Secret-history decision** (decision 6c): the seven test-file fingerprints can be listed now; the four `.env.example` ones only after you decide whether to rotate.
- [ ] **Safari and real-device coverage is unverified**: Chromium (desktop and phone emulation) is tested in CI; Firefox and WebKit only run the signed-out smoke tests, on a developer machine.
