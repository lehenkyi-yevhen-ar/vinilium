# Pre-launch checklist

Tick each item yourself. "Verified" says what was actually checked and by whom; everything else is open. Last updated with the 2026-11
hardening run (`docs/autonomous-run-report.md`).

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
- [ ] First **GitHub Actions run** is green: `checks`, `audit`, `e2e` (the secret-free e2e job has never run on GitHub), CodeQL, secret scan.
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
