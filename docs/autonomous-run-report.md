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
| 51f7f64 | Docs: run report, progress, decisions, inventory links, threat-model route table |

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

---

# Follow-up: pull request #1 checks (2026-11-18)

Four checks failed on the pull request. Each: root cause, change, what is verified locally, what only GitHub can confirm. New commits (`git --no-pager log origin/autonomous/hardening..HEAD --oneline`):

| Hash | Message |
| --- | --- |
| f33ac5f | URL checks: parse and compare exact hosts everywhere (CodeQL "Incomplete URL substring sanitization"), with hostile-input tests |
| aee7ce5 | gitleaks: fixtures that cannot look like keys, a config with exact-fingerprint exceptions, full-history scan, notice instead of failure |
| eb013b5 | audit: a gate that fails on any NEW high advisory and passes only on a reviewed, expiring, per-advisory allowlist |
| d87cc5f | CI e2e: fix the websocket-proxy address (root cause), name the failing stage, show the real error; CodeQL upload skips with a notice |
| (last) | Docs: follow-up report |

## 1. CodeQL "Incomplete URL substring sanitization" (High)

* **Root cause.** The alert location was not captured, so the whole repository was searched (src, scripts, tests, workflows) for includes/startsWith/endsWith/indexOf/unanchored-regex checks on URLs, hosts, origins and redirects. **Every production check already parsed with the URL class and compared exactly.** The one substring check on a host was a test helper in `tests/unit/discogs-normalize.test.ts:18` (`u.includes("i.discogs.com")`, which also matches `evil.com/i.discogs.com` and `i.discogs.com.evil.com`): the most likely alert. Not confirmed: I cannot see the alert.
* **Files and fixes.**
  * `tests/unit/discogs-normalize.test.ts`: parses the URL and compares the exact host.
  * `src/server/auth/request-user.ts` (`originMatches`, the CSRF Origin check): it compared `new URL(origin).host` after the parser had "repaired" the value, so `https://app.example\@evil.com` and `https://app%2eexample` matched the site (found by the new hostile tests). An Origin must now be exactly what the parser returns as its origin.
  * `src/lib/discogs/normalize.ts` (`discogsUrlFor`): accepted a path starting with `//`; refused.
  * `src/lib/neon-local.ts`: now also off for `x.neon.tech.` (trailing dot) and percent-encoded dots.
  * Unchanged because already correct: the image proxy allow-list (`validateImageUrl`), `parseTelegram`, `safeNextPath`, `isCrossSite`.
* **Tests.** `tests/unit/url-checks.test.ts` (95): `evil.com/discogs.com`, `discogs.com.evil.com`, userinfo tricks, encoded dots, backslashes, mixed case, trailing dots, IPv6, punycode, other ports and schemes, against the image allow-list, `discogsUrlFor`, `parseTelegram`, neon-local, the Origin and Sec-Fetch-Site checks and `safeNextPath`. SSRF protections unchanged.
* **Verified locally:** the tests. **Only GitHub can confirm** that the alert closes. If it is still open after this push and the flagged line is a test or script, dismiss with: *"False positive: test helper or script, not a request path. The production code parses URLs with the URL class and compares exact hosts (see tests/unit/url-checks.test.ts)."* Paste me the file and line and I will fix it instead.

## 2. gitleaks

* **Root cause.** The `generic-api-key` rule flags a high-entropy literal next to SECRET or KEY. Two fixtures written in this PR (`CRON_SECRET: "<made-up string>"` in `retention.test.ts:17` and `health.test.ts:20`) matched. Made-up strings, never used anywhere.
* **Change.** `tests/helpers/fake-secrets.ts` builds fake secrets from a repeated character (long enough for the code, zero entropy) and every key-shaped literal in the tests uses it. `.gitleaks.toml` extends the default rules and ignores nothing by path or pattern. `.gitleaksignore` lists the two historical findings by exact fingerprint with the reason (a toml `[[allowlists]]` with AND needs a newer gitleaks than 8.24.3, the version the pinned action runs). `secret-scan.yml`: the action (pinned SHA) uses the config on PRs and pushes and skips with a notice for an organisation-owned repository without a licence; a second job scans the **full history** with the pinned binary (sha256 checked) on push to `main`, weekly and on demand, and writes counts, rule ids, files and short commits to the step summary. A unit test fails if a high-entropy literal reappears next to SECRET, API_KEY or TOKEN in tests.
* **Verified locally** (gitleaks 8.24.3, checksum-verified against the published list): the pull-request range has 0 findings with the config; the new commits have 0.
* **Full-history result (counts and rule ids only):** all refs including the local `backup/pre-history-rewrite` branch: 17 findings in the first scan. **History reachable from `origin/main`: 11, all rule `generic-api-key`**, none allow-listed (you asked for exactly two): 7 in test files (made-up strings) and **4 in `.env.example` of the first commit** whose values look random and are not your current ones. Fingerprints, details and the rotation advice: `docs/decisions-needed.md` 6c.
* **Could any be real?** The 4 in `.env.example`: I cannot rule it out (the session secret has 43 distinct characters out of 44). **CRON_SECRET: do not rotate because of this**, unless the value in Vercel equals one of the made-up strings that were committed (`cron-secret-0123456789`, `SECRET-CRON-0123456789`, `e2e-cron-secret-0123456789`); a real random value cannot. Rotating has no user-visible effect. Rotating `BETTER_AUTH_SECRET`, the Google secret and the Discogs key is warranted only if you ever used the first-commit `.env.example` values for real.
* **Only GitHub can confirm:** that the action accepts the config and the ignore file the same way as the local binary, and that the full-history job installs the pinned binary.

## 3. CI / audit

* **Root cause.** `package.json` is correct: vitest, vite, drizzle-kit and tsx are `devDependencies`. `--omit=dev` still lists them because **`better-auth` declares `vitest` and `drizzle-kit` as optional peers**, which npm counts as production edges (the lockfile marks them `devOptional`). The 6 "high" findings are **one** advisory (picomatch GHSA-fc5q-39xc-vjpf, ReDoS, range `<=4.0.7`); **4.0.7 is the latest release: no patched version exists** (`npm view`). The only truly production path is `next-intl` to `@parcel/watcher` to `picomatch`, used only by next-intl's experimental message extractor with fixed ignore globs (this app does not enable it); `picomatch` is in no traced serverless file (0 matches in `.next/server` and `.next/static`). The 4 moderate are esbuild (development server) through `drizzle-kit`. `npm audit fix --force` would downgrade vitest and drizzle-kit: not run.
* **Decision implemented.** `npm run audit:prod` is `scripts/audit-gate.ts`: fails on any **new** high or critical advisory; an advisory passes (annotation and summary warning) only while it is on `.audit-allowlist.json`: one GHSA id per entry (wildcards and package-wide ignores refused), justification, review date, **expiry date** (this one: 2026-12-31). Invalid or expired entries fail the job; stale ones are reported. No dependency changed. Documented in `docs/decisions-needed.md` 6b and `docs/operations.md` section 18. 21 tests.
* **Verified locally:** `npm run audit:prod` exits 0 with the warning; unit tests. **Only GitHub can confirm** the job passes there.

## 4. CI / e2e

* **Root cause (the part that is ours, verified locally).** `src/lib/neon-local.ts` set `neonConfig.wsProxy` to a **function** returning the bare proxy address. The Neon driver's own docs (`CONFIG.md`) say only a **string** gets `?address=<host>:<port>` appended. wsproxy was asked for `/v1` with no target address and refused every connection. Reproduced with a throwaway local server recording the driver's request: old config `-> /v1`, fixed config `-> /v1?address=postgres:5432`. The log hid it because `db-migrate.ts` treated any error as "0 migrations applied" and printed only drizzle's "Failed query" wrapper (the Neon driver reports a failed websocket as a bare ErrorEvent).
* **Changes.** String `wsProxy` plus a regression test that records the real request. `scripts/ci-db-probe.ts` (proxy HTTP, websocket, Postgres through the proxy; retries about 40 s; fails fast naming the stage). `scripts/db-migrate.ts` proves the connection, prints the whole redacted cause chain including the websocket address, and only a missing relation means "nothing applied" (`scripts/lib/db-error.ts`). Workflow: proxy connection logging, `docker logs` of both service containers on failure, a step summary of failed tests (Playwright JSON reporter), `NEON_WS_PROXY=127.0.0.1:5433/v1`, the probe before the migration. `docs/operations.md` 18a: root cause, how to read each stage, a Docker reproduction (untested). Also: CodeQL's upload is a separate `continue-on-error` step that prints a notice and keeps the SARIF as an artifact, and gitleaks-action skips with a notice for an organisation-owned repository without a licence. All workflows re-read (permissions, full-SHA pins, Node 22, `persist-credentials: false`, no secrets; checked by `ci-supply-chain.test.ts`).
* **Verified locally:** the address the driver requests; the migrate script's output against an unreachable database and against a dead proxy port; all new unit tests. **NOT verified (no Docker here):** that the Postgres and wsproxy containers then work together in the Actions service network. If the e2e job still fails, its log now says at which stage.

## Totals

Unit: **657 passed, 0 failed, 0 skipped** (49 files); typecheck and lint clean. e2e was not re-run for this follow-up: only CI, test-fixture and URL-guard code changed; the Origin-check change is covered by the new unit tests but the existing e2e write tests were not re-run.

---

# Follow-up 2: pull request #1 after the push of 68e438e (2026-11-19)

Written for the owner. Nothing was pushed by the agent; production was never touched. Database target of every e2e run below: **the DEV branch via `DEV_DATABASE_URL`** (stated before each run), except the runs marked "local CI copy" (an empty in-memory Postgres under the host name `postgres`, which cannot reach Neon). Only the e2e user and its rows were created and deleted.

## What GitHub showed (read with `gh`, GET only)

* `CI / checks`, `CI / audit`, `Secret scan` (PR range): green. `CI / e2e` (run 44290044943): red. CodeQL: one open alert, `js/incomplete-url-substring-sanitization`, High, **`tests/unit/input-fuzz.test.ts:209`**, message "'http://discogs.test' may be followed by an arbitrary host name".

## Task 1: CI / e2e, two root causes (both verified)

The log: probe ok, `Migrations applied now: 3 of 3` (so the first fix worked and the service containers work together), then `Running 549 tests using 2 workers`, `27 failed, 492 did not run, 30 passed (38.1s)`.

1. **The test side used a second copy of the driver.** The sign-in setup failed after 0.4 s and the teardown printed "cleanup skipped: ErrorEvent". `@neondatabase/serverless` is a dual package (`require` gives `index.js`, `import()` gives `index.mjs`); Playwright compiles tests to CommonJS, so `e2e-db.ts` set `wsProxy` on the CommonJS copy while the specs built their `Pool` from `await import(...)` (the ESM copy), which tried a real `wss://postgres/v2`. Evidence: a throwaway Playwright test printed `same neonConfig instance: false`. Invisible locally because with no `NEON_WS_PROXY` the setting is inert. Fix: `e2ePool()` (config and pool from one import), used by every spec, the setup and the teardown; `explainDbError()` prints the redacted cause chain instead of a bare event; `tests/unit/e2e-db-access.test.ts` fails if a spec builds its own pool or imports the driver.
2. **Firefox and WebKit projects on a Chromium-only runner.** 26 failures `Executable doesn't exist at .../firefox-1572/...`. The config defined both projects unconditionally while its comment said "not part of CI". Now they exist on CI only with `E2E_EXTRA_BROWSERS=1`; unit-tested both ways.

**Differences between CI and local that I checked, not assumed:**

| Difference | Result |
| --- | --- |
| Clean database, only migrations | Reproduced with an empty PGlite behind a websocket bridge; migrations (3 of 3), setup and the signed-out tests pass |
| Websocket proxy, IPv4/IPv6, ports | Same `NEON_WS_PROXY=127.0.0.1:5433/v1` and `--dns-result-order=ipv4first`; the real run's log shows the probe succeeding |
| 2 workers, `CI=true` (no server reuse, html and json reporters, `forbidOnly`, no retries) | Used in the local CI copy |
| Browser installation | Cause 2 above |
| Env vars (`CSP_MODE`, cron secret, mock URLs) | Set by `playwright.config.ts` for the server, not read from the job: identical |
| Our per-IP limiters, one runner IP | Every project uses its own `x-forwarded-for` from 203.0.113.0/24; unchanged and passing |
| Global timeout vs slow tests | One test was latency-bound (below); the job limit is 60 minutes and the full local run takes about 30 |
| Test-order dependence | Projects are chained by `dependencies`; the full run passed in that order twice (report-only, enforce) |

**A slow test, fixed at the cause.** `discogs.spec.ts` "Back / reload restores..." made 76 sequential requests; each is a database round trip (about 0.4 s to Neon), so it hit the 30 s limit **on DEV** (it had passed before; next to the CI Postgres it is fast). The repeats now go five at a time. No timeout was raised.

**Not reproduced faithfully, stated plainly.** In the local CI copy one test (`discogs.spec.ts` "resolves albums' own titles ...") failed because the `master` rows were not in `discogs_cache` right after the first request; the same test **passed against real Postgres (the Neon DEV branch)** in three separate runs. Two direct experiments (concurrent inserts and concurrent selects through the same bridge, 40 and 100 rounds) found no lost or wrong rows, so I did **not** find the cause and cannot call it a harness artifact with certainty. It is the one thing the GitHub run (Postgres 17) must confirm; if `masters` fails there, the first place to look is the `persist()` writes in `batchCached` (`src/server/discogs/service.ts`) under a slower connection.

**Teardown leak found and fixed on the way.** The limiter key shape `app:<scope>:ipcold:<ip>` (added with the Back/reload fix) did not match the teardown pattern, so the suite left counters behind (DEV `rate_limit`: 6 rows before, 85 after the two full runs, 63 after the fixed teardown). They are counters, not personal data, and the retention purge removes them; the teardown now also deletes the `ipcold` counters of the 203.0.113.0/24 test addresses and the limiter counters of the e2e users it deletes (keyed to the id of a row the suite created). DEV users stayed at 3, `user_items` and `discogs_cache` at 0.

**Readable failures (already in the workflow, now fed by better errors):** failing test names in the step summary, the HTML report, traces and screenshots as the `playwright-failure-<run>` artifact, `docker logs` of both service containers, redacted cause chains in the setup, teardown and migrate output. Section 18c of `docs/operations.md` explains this run.

## Task 2: CodeQL

* **Root cause.** `expect(u.startsWith(BASE), u).toBe(true)` with `const BASE = "http://discogs.test"`. `startsWith` accepts `http://discogs.test.evil.example/x`. My earlier repository scan looked for URL **literals** inside `includes/startsWith/...` and missed a **constant** holding a URL. The earlier fix (`f33ac5f`) therefore left this line, which is why the alert persisted.
* **Fix.** `expect(new URL(u).origin).toBe(new URL(BASE).origin)`. A scan, and then a permanent test, `tests/unit/url-substring-guard.test.ts`, check `src`, `scripts` and `tests` for `startsWith/endsWith/includes/indexOf/lastIndexOf` with a URL or host, literal or constant (and template prefixes): zero other hits. `host.endsWith(".neon.tech")` on an already parsed, lower-cased hostname is a dot-boundary suffix check and is allowed. Also checked: no `.replace(/https?:\/\//...)` on a security path (the two found are a test helper turning a mail link into a path and the mock server rewriting image hosts) and no unanchored host regex. The image proxy allow-list was not touched.
* **Verified locally:** the tests. **Only GitHub can confirm** that the alert closes. If it stays open, dismiss it in GitHub with: *"False positive: test assertion on the origin of a URL our own code built; production code parses URLs with the URL class and compares exact hosts (tests/unit/url-checks.test.ts, tests/unit/url-substring-guard.test.ts)."* I do not expect to need it: the flagged expression no longer exists.

## Task 3: full local runs (DEV branch, own rows only)

| Run | Result |
| --- | --- |
| typecheck | exit 0 |
| lint | exit 0 (after ignoring Playwright's generated report folders, see below) |
| unit, full | **663 passed, 0 failed, 0 skipped** (51 files; was 657) |
| e2e full, `CSP_MODE` unset (report-only), 8 workers, includes the Firefox and WebKit shell tests | **549 passed, 0 failed, 0 skipped** (30.2 min) |
| e2e full, `CSP_MODE=enforce` | **549 passed, 0 failed, 0 skipped** (30.6 min) |

The same-site Origin check in `src/server/auth/request-user.ts` (hostile-origin hardening) is exercised by the write e2e tests (library, keyboard, phone menus, auth-modes): all passed in both runs. No test was skipped. Not covered: real Safari, real phones.

`npm run lint` failed with 133 errors once, from `playwright-report/` (minified viewer code written by my `CI=true` runs; git-ignored but not ESLint-ignored); it is now in the ESLint ignores.

## Tasks 4 to 7 (documents)

* `docs/decisions-needed.md` 6c: the exact seven `.gitleaksignore` lines (test fixtures only), the four `.env.example` lines **not** to add yet, the effect on the full-history job (11 findings now, 4 after the first block, 0 after both), and a rotation checklist by name. gitleaks itself was not installed in this session, so the fingerprints were checked for existence (all eleven lines exist in commits that are ancestors of `origin/main`) but not re-scanned.
* Picomatch expiry (2026-12-31): `docs/pre-launch-checklist.md` ("Dependencies") and `docs/operations.md` section 18b.
* `docs/merge-checklist.md`: what Vercel does after the merge, variables by name, `CSP_MODE` staying report-only, the daily cron, `/api/health`, verification, rollback (Hobby: previous production deployment only, per Vercel's documentation; unverified for your plan), a hand smoke checklist. **No migration is needed** (`git diff main --stat -- drizzle src/server/db/schema.ts` is empty).
* `docs/pre-launch-checklist.md` "Known open items": every item you listed, undecided.

## New commits (`git --no-pager log origin/autonomous/hardening..HEAD --oneline`)

| Hash | Message | Gate on its own tree |
| --- | --- | --- |
| 6a7a1ae | CI e2e: one copy of the database driver on the test side (root cause of the setup/teardown failure), no Firefox/WebKit on the Chromium-only runner | typecheck 0, lint 0, unit 661 passed |
| 4e0b663 | e2e: send the 75 repeated searches five at a time (76 sequential round trips hit the 30 s test limit against a remote database) | typecheck 0, lint 0, unit 661 passed |
| 463b3d3 | lint: ignore Playwright's generated report and results folders | typecheck 0, lint 0, unit 661 passed |
| db5f5e8 | CodeQL: compare the exact origin in input-fuzz.test.ts:209, plus a guard test for the whole class | typecheck 0, lint 0, unit 663 passed |
| (next) | Docs: follow-up 2 (CI e2e root causes, CodeQL, merge checklist, 6c, reminders, open items) | docs only |

Each code commit was checked out alone in a temporary git worktree (shared node_modules) and run through typecheck, lint and the whole unit suite.

## Still only GitHub can confirm

1. CI / e2e passes end to end on the runner (2 vCPU, Postgres 17 behind wsproxy), in particular the `masters` test above and the total duration.
2. The CodeQL alert closes.
3. The full-history secret scan stays red until you decide 6c.
