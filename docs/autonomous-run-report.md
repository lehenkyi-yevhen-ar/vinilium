# Autonomous run report: branch `autonomous/hardening`

Written for the project owner. Nothing was pushed; production was never touched; every e2e run was against the **DEV branch via `DEV_DATABASE_URL`** (stated before each run).
Details per block: `docs/autonomous-progress.md`. Bugs: `docs/autonomous-changes.md`. Open decisions: `docs/decisions-needed.md`.

## 1. Blocks

| Block | Status | Notes |
| --- | --- | --- |
| A Baseline and pending items | **done** | Help collapsed on phones (was not done); limiter fix (was a real defect); timeouts explained and fixed; DEV cleanup SQL written and tested on PGlite, not run |
| B CI and supply chain | **done, never run on GitHub** | e2e job without secrets, CodeQL, secret scan, Dependabot (14-day cooldown), SHA-pinned actions, SECURITY.md, CONTRIBUTING.md |
| C Security hardening | **done** | Nonce CSP behind `CSP_MODE` (default report-only), threat model with a route table, auth/CSRF/redirect/cookie/rate-limit tests on the real Better Auth, fuzzing, log hygiene |
| D Resilience and chaos | **partly** | 18 chaos tests, concurrency and per-person-cap tests, `/api/health`. Scenarios are unit tests with a fake fetch, not switches on the mock server; mock Brevo scenarios were already covered |
| E Data lifecycle and privacy | **done** | Inventory + schema test, retention purge with dry run, complete export, privacy text corrected in three languages |
| F Accessibility and responsive | **partly** | New reflow, spacing, forced-colour, reduced-motion, 44 px and focus checks found and fixed three defects. Firefox and WebKit run the smoke tests. Not done: keyboard walkthroughs beyond the existing ones; axe over every state in every language and theme |
| G Internationalisation | **partly** | Plural categories and locale formatting tested; doubtful strings listed. Not done: the 40%-longer pseudo-locale test |
| H Performance and budget | **partly** | Measured and budgeted; counters in the log. Not measured: CLS, real latency |
| I Product polish | **partly** | 404 inside the layout, error pages, manifest and icons (no service worker), robots, sitemap, Open Graph on public pages, attribution crawler, spam-placement notes. **Not done:** account page rework, sessions list, email HTML for dark mode |
| J Code quality | **not done as a pass** | Only fixes made on the way |
| K Documentation | **done** | README, operations 10/17/18/19, architecture (mermaid), 5 ADRs, compliance map, pre-launch checklist, performance |

## 2. Commits (`git --no-pager log main..autonomous/hardening --oneline`)

| Hash | Message |
| --- | --- |
| abd4ec0 | Cap vitest at 4 workers: stops the 30 s import timeouts and the worker crash |
| f5a3f60 | Search limiter: Back, reload and copied links no longer use up the per-IP allowance |
| 486097d | Fix phone bottom sheets sitting 40 px too low (the last button was cut off) |
| 2c34418 | "How to search" starts collapsed on phones (640 px and below) |
| 8d84d31 | e2e teardown: delete only users whose address the suite itself generates |
| 5393880 | Add docs/ops/dev-cleanup.sql: remove all personal data from the DEV branch (not run by the agent) |
| e820b79 | Add an enforceable nonce-based CSP behind CSP_MODE (default report-only); fix the proxy matcher |
| 9abaf06 | CI and supply chain: secret-free e2e job, CodeQL, secret scan, Dependabot, SECURITY.md, CONTRIBUTING.md |
| 0ad9a0e | Harden inputs, redirects and the deletion race (found by fuzzing and real Better Auth tests); add per-minute event counters |
| a5a9e2d | Data lifecycle: data inventory with a schema test, retention purge with dry run, complete export, privacy text corrected |
| b56d329 | Add /api/health for uptime monitoring |
| 06bdfe8 | Error pages, web app manifest and icons, robots.txt, sitemap and meta tags for public pages |
| a362bd4 | Accessibility fixes found by new reflow, spacing, forced-colour, touch-target and focus checks; attribution crawler; Firefox and WebKit smoke projects |
| cc7e22e | Chaos tests for Discogs failures, performance budgets, plural and locale checks; docs/performance.md |
| (last) | Docs: run report, progress, decisions, inventory links, threat-model route table |

Every commit passed typecheck, lint and the whole unit suite on exactly its staged tree (the first seven were gated with a stash; from the eighth on, the staged tree was checked
out into a temporary folder and tested there). A secret scan of the added lines ran before each (counts only: zero findings every time).

## 3. Verified and unverified

| Area | Verified (and how) | Unverified |
| --- | --- | --- |
| Unit tests | 528 passed, 0 failed, 0 skipped; **10 consecutive full runs, all 528 green** (43-47 s each); under a 16-process CPU hog the slowest test fell from 14 s to 3 s | Behaviour on GitHub's runners |
| Limiter | `search-ip-limit.test.ts` on the real route handlers; e2e restores test | Real traffic |
| CSP | `csp.spec.ts`: zero violations on 9 public pages x 3 languages, the 404s, and 8 signed-in pages; the **whole e2e suite with `CSP_MODE=enforce`**: 317 passed and 1 failed (a keyboard test already failing on `main`, fixed), 53 not run behind it, then keyboard, auth-modes and csp re-run enforcing: 61 passed | Other browsers' enforcement; real users' extensions |
| Auth security | Real Better Auth in production mode on PGlite (note: vitest's `TEST=true` silently disables Better Auth's origin checks and rate limits, which the test undoes) | Google sign-in redirect flow (needs real credentials) |
| e2e extra | a11y-extra + attribution: 141 passed, 10 failed, then the three defects fixed and re-run: all passing except one WebKit language-menu test that failed once and passed once | Real devices, screen readers, CLS |
| CI | Supply-chain test (SHA pinning, digests, permissions, no secrets) | **That any workflow runs on GitHub**; the Postgres + wsproxy service wiring was never started (no Docker here) |
| Dev cleanup SQL | Run on PGlite: guard stops it, override works, idempotent | Neon's `neon.branch_id` setting is read by the repo's own `db:migrate` guard the same way, but was not checked against Neon in this run |
| Performance | Call counts exact; times against a fake 25 ms Discogs | Real latency; per-route bundle sizes; CLS |

**Skipped tests with reasons.** Unit: none. e2e: no test was skipped by `test.skip` in the runs; the 53 "did not run" in the first enforce run were behind one failing project and were run afterwards.

**Found, not fixed, needs your attention:** `npm run audit:prod` exits 1 (6 high, 4 moderate; picomatch has no patched release): **the CI `audit` job will be red** (decision 6b).

## 4. Bugs found and fixed

Full table with tests: `docs/autonomous-changes.md`. In short: `%00` in a search, filter or note answered **500** (and an emoji cut mid-character did too); the proxy matcher ran on `/` only;
phone bottom sheets sat 40 px too low (last button cut off); the per-IP limiter counted Back/reload; `safeNextPath` accepted a tab trick; a write racing account deletion crashed;
auth 429 lacked `Retry-After`; Better Auth counters, sessions and verification rows were never purged; the export lacked the picture address; the privacy text was inaccurate about counters and logs;
small buttons, chips and forced-colour buttons failed 44 px and boundary checks; the Ukrainian/Norwegian privacy page overflowed at 320 px; two pre-existing failing e2e tests.

## 5. Failed or reverted changes

None reverted. Dead ends inside the run: the first limiter design had a race (fixed, test added); three first-draft tests had wrong assumptions (Better Auth test mode, a
stale lone-surrogate in the fuzzer, a WebKit scrollbar) and were corrected, not weakened.

## 6. Decisions for you (`docs/decisions-needed.md`) and my recommendation

1. Sign-in methods: keep email+password+Google with the switches ready (flip to invite-only or Google-only if the Brevo quota is hit).
2. CSP: deploy report-only, read the logs for about a week, then `CSP_MODE=enforce`.
3. HSTS: leave unset until a domain exists.
4. Sessions list and "sign out other devices": show browser and date only, never the IP; **not implemented**.
5. Search-engine indexing: keep (public pages only). 5b. Repository visibility: stay private; CodeQL results may not upload on a private repository.
6. Two-factor: not now. 6b. The audit gate (see above): an explicit dated exception, not a lowered level.
7. Open items only you can check: Discogs Application Name policy, `APP_CONTACT`, Lis licence and font credits, native review (`docs/i18n/doubtful-strings.md`), every `[NEEDS LEGAL REVIEW]` mark (one added: Vercel log retention).

## 7. Lines for `.env.example` (placeholders only; I did not edit the file)

```
# Content-Security-Policy mode: empty or report-only (default) or exactly: enforce
CSP_MODE=
```
`NEON_WS_PROXY` is for the CI job only and must not be added to `.env.example` or to Vercel.

## 8. Dev dependencies

None added. No runtime dependency added. `package.json` and `package-lock.json` are unchanged (`git diff main --stat -- package.json package-lock.json` is empty).
Browsers downloaded locally (not in the repo): Playwright Firefox and WebKit.

## 9. Test totals

* Unit: **528 passed, 0 failed, 0 skipped** ; 10 of 10 consecutive full runs green.
* e2e (DEV branch, mock Discogs and Brevo): full suite with `CSP_MODE=enforce` 317 passed / 1 failed (fixed) / 53 not run, then 61 passed; attribution + a11y-extra 141 passed / 10 failed, defects fixed, last targeted run
  63 passed / 1 failed (WebKit language menu, flaky); Firefox: all shell tests passed; WebKit: 4 of the shell tests failed on a scrollbar assumption (fixed) and one flaked.
* Database rows: the DEV branch's real users were never read or modified (the only writes were the e2e user and its list rows, keyed to their own id).

## 10. What you must do, in order

```powershell
# ===== (1) REVIEW THE BRANCH (run by you, in C:\dev\vinilium) =====
git --no-pager log main..autonomous/hardening --oneline
git --no-pager diff --stat main
```

```powershell
# ===== (2) PUSH THE BRANCH TO GITHUB (run by you, in C:\dev\vinilium) =====
# Note: main itself is 2 commits ahead of origin/main (theme switcher, phone-menu fix); those commits travel with the branch.
git --no-pager push -u origin autonomous/hardening
```

```powershell
# ===== (3) OPEN A PULL REQUEST AND CHECK THE ACTIONS (run by you) =====
# On GitHub: Compare & pull request. Expect: checks green; audit RED (decision 6b); e2e is the first-ever run of the Postgres+wsproxy wiring (docs/operations.md section 18);
# CodeQL may not upload while the repository is private; secret-scan should be green.
gh pr create --base main --head autonomous/hardening --title "Hardening: CSP, CI, privacy, a11y, tests" --body-file docs/autonomous-run-report.md
gh pr checks --watch
```

```powershell
# ===== (4) DEV CLEAN-UP SQL (run by you, in the Neon console > SQL Editor, on the DEV branch) =====
# Open docs/ops/dev-cleanup.sql. Run PART 1 alone: it must print branch_id = br-empty-band-b9f6dxji.
# If it prints a different id: STOP, you are on the wrong branch. If it is NULL, confirm the branch id in the console and use the override line described in the file.
# Then run PART 2 (the whole BEGIN..COMMIT block), then PART 3: every count must be 0 except discogs_cache, discogs_bucket and the migration journal.
```

```powershell
# ===== (5) DASHBOARD STEPS STILL OPEN (names only, no values) =====
# Vercel > Project > Settings > Environment Variables (Production): CSP_MODE (optional, set to "enforce" later), CRON_SECRET, DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET,
#   BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME, EMAIL_PROVIDER, NEXT_PUBLIC_CONTACT_EMAIL, NEXT_PUBLIC_OPERATOR_NAME, NEXT_PUBLIC_OPERATOR_COUNTRY, APP_CONTACT; then Redeploy.
# Vercel > Cron Jobs: confirm /api/cron/purge ran once (use ?dryRun=1 by hand first).
# Google Cloud > Auth Platform > Branding: support email, developer contact, privacy policy link (https://<domain>/en/privacy).
# Neon: confirm the restore window of your plan and state it in the privacy policy [NEEDS LEGAL REVIEW]; keep DATABASE_URL (production) out of .env.local.
# GitHub: enable branch protection on main, Dependabot alerts; decide repository visibility (decision 5b).
# An uptime monitor on https://<domain>/api/health every 5 minutes.
```
