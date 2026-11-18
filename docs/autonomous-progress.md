# Autonomous run: progress log

Branch: `autonomous/hardening`, created from `main`. `main` was 2 commits ahead of `origin/main` (the theme switcher and the phone-menu fix), so the
branch starts from them and those two commits are not on GitHub yet. Nothing was pushed by the agent. If the run is interrupted and you say
"continue", resume from the first block below that is not "done", at its "Next step".

Database rule: development, tests and e2e used `DEV_DATABASE_URL` only (no fallback); production was never touched. Every e2e run was stated as
"DEV branch via DEV_DATABASE_URL" before it ran. Teardown check: see block A. Full details and totals: `docs/autonomous-run-report.md`.

| Block | Status | Commits | Next step |
| --- | --- | --- | --- |
| A Baseline and pending items | done | abd4ec0 f5a3f60 486097d 2c34418 8d84d31 5393880 | none |
| B CI and supply chain | done (CI never run on GitHub) | 9abaf06 | push, open a PR, read the first run |
| C Security hardening | done (CSP is report-only by default) | e820b79 0ad9a0e | flip `CSP_MODE=enforce` after a week of logs |
| D Resilience and chaos tests | partly | cc7e22e b56d329 | extend the mock Discogs server with scenario switches if wanted |
| E Data lifecycle and privacy | done | a5a9e2d | native review, legal review |
| F Accessibility and responsive | partly | a362bd4 | real devices; keyboard walkthroughs of the finder; WebKit flake |
| G Internationalisation | partly | cc7e22e | pseudo-locale test; native review |
| H Performance and budget | partly | cc7e22e 0ad9a0e | CLS in a real browser; Zod removal from forms |
| I Product polish | partly | 06bdfe8 a362bd4 | account page rework, sessions list, email HTML for dark mode |
| J Code quality | not done beyond fixes made on the way | | dead-code pass |
| K Documentation | done | the commit of this file | keep ADRs current |

## A. Baseline and pending items: done

* **Baseline** (main, before any change): typecheck 0, lint 0, unit 360 passed 0 skipped (one worker crash on the very first cold run, see c).
  e2e: signed-out and signed-in projects ran on the DEV branch; every test that was skipped or failing is listed in the run report.
* **(a) "How to search" collapsed at 640 px and below**: was NOT done (open at every width). Done in 2c34418; checked visually at 390 px
  (screenshot read: the form is on the first screen).
* **(b) Per-IP search limiter and Back/reload**: was a real defect. f5a3f60: cold allowance (30) plus a 4x flood ceiling; trade-off in
  `docs/operations.md` section 17; a race in my first version was found by its own test.
* **(c) Flaky 30 s import timeouts**: cause found (Vite's single transform thread, 15 workers). abd4ec0: 4 workers. 10 consecutive full runs on the
  final code: see the run report.
* **DEV cleanup SQL**: `docs/ops/dev-cleanup.sql`, tested on PGlite (guard, override, idempotent). Not run.
* **Teardown safety**: `tests/e2e/global-teardown.ts` deletes users only by an exact regex of what the suite generates; its other statements are
  keyed to the mock origin or to 203.0.113.0/24; every `user_items` delete in the specs is keyed to the e2e user's own id read from its own session. The
  e2e purge test now uses `?dryRun=1` only.

## B. CI and supply chain: done

Workflows, Dependabot, SECURITY.md, CONTRIBUTING.md. Verified locally: the supply-chain test (SHA pinning, digests, permissions, cooldown, no secrets).
**Unverified: nothing has run on GitHub**; the e2e job's Postgres + wsproxy wiring could not be started locally (no Docker).

## C. Security hardening: done

CSP (nonce, `CSP_MODE`), threat model, auth-security tests on the real Better Auth, fuzzing, log hygiene, route table (`docs/threat-model.md`
section "Route by route"). Evidence: `tests/e2e/csp.spec.ts` plus the whole suite with `CSP_MODE=enforce`.

## D. Resilience: partly

Done: `tests/unit/chaos-discogs.test.ts` (18), concurrency and per-person cap tests, `/api/health`. Not done: the scenarios were written as unit tests with a
fake fetch rather than as switches on `tests/mocks/discogs-mock.ts`, so the UI states for each scenario are covered by the existing e2e specs
(throttled countdown, error with retry, not found) and not by new ones.

## E. Data lifecycle and privacy: done

Inventory + schema test, retention purge with dry run, export completeness, privacy text corrected in three languages (mismatches in the run report).

## F. Accessibility: partly

Done: reflow, text spacing, forced colours, reduced motion, 44 px, focus visibility, axe over the existing screens. Firefox and WebKit installed;
the signed-out smoke tests run in both. Not done: full keyboard walkthroughs beyond `keyboard.spec.ts`; axe over every state in every language and theme
(a11y.spec.ts covers the main screens in light and dark, desktop and phone, three languages for the start screens).

## G. Internationalisation: partly

Plural categories and locale formatting tested; native-speaker CSV unchanged (`npm run i18n:export` regenerates it); doubtful strings listed.
Not done: the 40%-longer pseudo-locale test (the 320 px reflow runs in uk and nb, the longest languages, instead).

## H. Performance: partly

Measured and budgeted (`docs/performance.md`, `tests/unit/performance-budget.test.ts`); counters in the log. Not measured: CLS, real latency.

## I. Product polish: partly

Done: 404 (inside the layout), error and global-error pages, manifest and icons (no service worker), robots, sitemap, Open Graph on public pages,
attribution crawler, spam-placement notes. Not done: account page rework and the sessions list (decision 4), email HTML for dark mode, an email
rendering test per language beyond the existing ones.

## J. Code quality: not done as a pass

No dead-code or duplication sweep. Bugs found on the way are in `docs/autonomous-changes.md`.

## K. Documentation: done

README, operations (sections 10, 17, 18, 19), architecture with a mermaid diagram, five ADRs, compliance map, pre-launch checklist, decisions, performance, changes.
