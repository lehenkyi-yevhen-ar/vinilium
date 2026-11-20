# Dependency updates: policy and the first review (2026-11-19)

Dependabot (`.github/dependabot.yml`) opens the pull requests. **It proposes; a person decides and merges.** CI being green is necessary,
never sufficient. This page holds the policy, and the review of the first eight pull requests it opened (after PR #1 was merged).

## Policy

**May be merged when CI is green** (after a look at the changelog and the "published at least 14 days ago" date, which the 14-day
cooldown in `dependabot.yml` already enforces for everything except security updates):

* a minor or patch group of **development tools** that CI exercises (types of libraries, test tooling) and that is not in the list below;
* a minor or patch group of **GitHub Actions**, after checking that every new commit SHA is the commit of the official release tag
  (`gh api repos/<owner>/<action>/git/ref/tags/<tag>`; for an annotated tag one more call for the tag object) and that the SHA and the
  `# vX.Y.Z` comment changed together (`tests/unit/ci-supply-chain.test.ts` also asserts the pinning).

**Always needs a manual look before merging, whatever CI says:**

* every **major** update (it has its own pull request on purpose: majors are not in any group);
* every **runtime dependency** (`dependencies` in `package.json`: Next.js, React, Better Auth, Drizzle, the Neon driver, next-intl, ...);
* **Node.js** (the CI `node-version`, the README, the Vercel project setting) and `@types/node`, which must stay on the major of the Node we
  actually run (CI 22, development 24). A bump of the types is part of a deliberate Node upgrade, never a stand-alone pull request
  (Dependabot is told not to propose major bumps of it);
* **TypeScript** and **ESLint** (with `eslint-config-next` and `typescript-eslint`): they move together, and a green `checks` job is the
  proof only if the lint step really ran and no rule was relaxed;
* **workflow actions** with a new major (inputs, Node runtime, cache behaviour, permissions can change; read the release notes against the
  way our workflows use the action: `actions/checkout`, `setup-node`, `cache`, `upload-artifact`, CodeQL).

**Never merge** a pull request whose `checks` job is red because a tool refuses to start (as with TypeScript 7 below), and never "fix" such a
pull request by relaxing a lint rule, a type option, a test or a timeout.

**Supply-chain rule:** adopt only a version that was published at least 14 days ago. The cooldown handles it for Dependabot; for a manual
bump check `npm view <package>@<version> time` (or the release date on GitHub) yourself.

## The first eight pull requests

Checked on 2026-11-19 (CI result = the `checks`, `audit`, `e2e`, CodeQL and gitleaks jobs of the pull request). "Published" is the
date of the new version on npm / the GitHub release; every one of them is more than 14 days old.

| # | Update | Kind | Published | CI | Decision | Evidence | Condition to revisit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | `actions/upload-artifact` 7.0.1 -> 7.0.2, `github/codeql-action` 4.39.0 -> 4.39.3 | minor/patch group, CI only | 2026-10-07 / 2026-11-04 (15 days) | green | **Safe to merge later** | Each new SHA is the commit of its release tag in the official repository. CodeQL ran the new action end to end. The upload-artifact step in `ci.yml` runs only on failure, so it was not exercised. No input of ours changes. | Merge together with #3-#5 (same files; Dependabot rebases the later ones). |
| 3 | `actions/cache` 5.1.0 -> 6.1.0 | major, CI only | 2026-06-26 | green | **Safe to merge later** | SHA matches tag `v6.1.0`. v6 = ESM migration and toolkit update, v6.1.0 = read-only token handling. We set only `path` and `key`; the step ran ("Cache not found" then "Cache saved"). | After merging, check that the Playwright cache is restored on the next run. |
| 4 | `actions/setup-node` 6.5.0 -> 7.1.0 | major, CI only | 2026-10-08 | green | **Safe to merge later** | SHA matches tag `v7.1.0`. v7 changed `NODE_AUTH_TOKEN` handling (we set no `registry-url` and no token). We pass only `node-version: 22` and `cache: npm`; the npm cache was restored. | None beyond green CI after the rebase. |
| 5 | `actions/checkout` 6.1.0 -> 7.0.1 | major, CI only | 2026-07-20 | green | **Safe to merge later** | SHA matches tag `v7.0.1`. The new block on fork-PR checkout applies to `pull_request_target` and `workflow_run`; we use only `push`, `pull_request`, `schedule`. `persist-credentials: false` and `fetch-depth: 0` unchanged; gitleaks (needs full history) passed. | None beyond green CI after the rebase. |
| 6 | `react`, `react-dom` 19.3.0 -> 19.3.1 | patch group, **runtime** | 2026-10-14 | green | **Safe to merge later, with a manual look** | One change: RSC (Flight) transport protocol. No API change. Both pinned exactly and moved together. Full e2e on a production build passed. Unverified: which copy of the React server runtime Next 16 uses for the protocol. | Look at a signed-in and a signed-out page and a language switch on a local production build or the preview before merging. |
| 7 | `@types/node` 24.19.2 -> 26.6.6 | major, types only | 2026-10-28 | green | **Defer** | CI runs Node 22, README "22+ (developed on 24)", no `engines`, no `.nvmrc`; the Vercel Node version is a project setting not visible in the repo. Types for 26 would accept APIs that Node 22/24 lack: the error would appear at run time, and a green type check cannot show it. | A deliberate Node upgrade (CI, README, Vercel setting, decision note) with the types on the same major. `dependabot.yml` no longer proposes major bumps of this package. |
| 8 | `typescript` ^5 (5.9.3) -> ^7 (7.0.2) | major, tooling | 2026-07-08 | **red** (`checks`: lint; `e2e`: 1 test) | **Defer** | `checks`: typecheck passed, then lint died at start-up: `typescript-eslint does not support TS 7.0` (`eslint-config-next` -> `typescript-eslint` 8.72.1; newest 8.73.0 has peer `typescript <6.1.0`; upstream tracking issue typescript-eslint#10940). Unit tests were skipped because of it. `next build` passed. `e2e`: 512 passed, 1 failed (`library.spec.ts:114`, a request-batching check, expected 2 batches, got 4); no evidence it is related, possibly a timing flake (unverified). | A `typescript-eslint` release with TS 7 support plus an `eslint-config-next` that uses it; re-run typecheck, lint, unit, e2e. Optional step before: TypeScript 6.0.x as its own pull request. |
| 9 | `eslint` ^9 (9.39.5) -> ^10 (10.14.0) | major, tooling | 2026-10-30 | green | **Safe to merge later, with a manual look** | CI green incl. lint. Checked out locally: `npm ci`, typecheck 0, lint 0 (no rule changed), unit 685/685. The resolved config has the same 113 rules as on ESLint 9 and a probe file was reported by `react-hooks`, `@typescript-eslint`, `@next/next` and `jsx-a11y`. `eslint-config-next@16.4.6` allows `eslint >=9`. ESLint 10 needs Node `^20.19 \|\| ^22.13 \|\| >=24` (CI 22, development 24: met). Caveat: `npm ls` marks `eslint-plugin-import` 2.32.0, `jsx-a11y` 6.10.2 and `react` 7.37.5 (dependencies of `eslint-config-next`) as invalid, their declared peer range stops at ESLint 9. | Accept that caveat, or wait for an `eslint-config-next` that lists ESLint 10 for them. Review one at a time, not together with #8. |

## What changed in `.github/dependabot.yml` (and why)

| Change | Why |
| --- | --- |
| `interval: weekly` -> `monthly` (both ecosystems; the `day: monday` line removed, `time` and `timezone` kept) | Eight pull requests in the first run show the load of a weekly cadence for a one-person project; with the 14-day cooldown a monthly rhythm still reaches every release. Security updates are not affected: they are opened at once. |
| `open-pull-requests-limit` 5 -> 3 | A backlog of majors is reviewed, not piled up. |
| Minor and patch stay grouped (`minor-and-patch`, `actions-minor-and-patch`), **majors are not grouped** (comment added) | A major then always has its own pull request and its own CI run, so it can never ride along with a routine bump and one failing major (TypeScript 7 today) cannot block the others. One "all majors" group would do the opposite, and is therefore not used. |
| `ignore` for `@types/node` major versions | The types follow the Node major we run (see the policy above). |
| `cooldown` 14 days, `labels`, `commit-message` prefixes | Unchanged. |

`tests/unit/ci-supply-chain.test.ts` pins this file (monthly, cooldown >= 14, grouping of minor and patch only, at most 3 open
pull requests, the `@types/node` major rule, labels and prefixes).

**Label:** Dependabot reported that the label `dependencies` does not exist in the repository ("could not be found"), so it adds no label.
Creating it is a repository setting: `gh label create dependencies --color 0366d6 --description "Dependency updates"`.
