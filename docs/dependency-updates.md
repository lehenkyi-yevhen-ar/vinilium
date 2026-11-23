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

## Final decisions (2026-11-23, branch `chore/deps`)

The first review (2026-11-19) judged each pull request on its own CI run. On 2026-11-23 the owner delegated the decision ("the only requirement is that nothing breaks"), and the
updates that passed every check below were **applied by hand** in branch `chore/deps` (small commits, lockfile consistent, nothing downgraded, every version published at least 14 days before
the commit). "Published" is the date of the new version on npm / the GitHub release.

| # | Update | Decision | Published | Evidence | Condition to revisit |
| --- | --- | --- | --- | --- | --- |
| 5 | `actions/checkout` 6.1.0 -> 7.0.1 | **Applied** (commit "CI: actions/checkout ...") | 2026-07-20 | SHA = commit of tag `v7.0.1` in the official repository. The new block on fork-PR checkout applies to `pull_request_target` and `workflow_run`; we use only `push`, `pull_request`, `schedule`. `persist-credentials: false` and `fetch-depth: 0` unchanged | none |
| 4 | `actions/setup-node` 6.5.0 -> 7.1.0 | **Applied** | 2026-10-08 | SHA = tag `v7.1.0`. v7's `NODE_AUTH_TOKEN` change does not apply (no `registry-url`, no token); we pass only `node-version: 22` and `cache: npm` | none |
| 3 | `actions/cache` 5.1.0 -> 6.1.0 | **Applied** | 2026-06-26 | SHA = tag `v6.1.0`. ESM migration; we set only `path` and `key` | after merging, check that the Playwright cache is restored on a repeat run |
| 2 | `actions/upload-artifact` 7.0.1 -> 7.0.2, `github/codeql-action` 4.39.0 -> 4.39.3 | **Applied** (together) | 2026-10-07 / 2026-11-04 | SHAs = tags `v7.0.2` and `v4.39.3`; CodeQL ran the new action end to end on the pull request. The upload-artifact step in `ci.yml` runs only when a test fails, so no CI run exercises it | none |
| 6 | `react`, `react-dom` 19.3.0 -> 19.3.1 (exact pins) | **Applied** | 2026-10-14 | Only `package.json` and the two lockfile entries change. Next.js 16.4.6 vendors its own React and Flight copies (one canary build, 19.3.0-canary-278794d7-20261002); on a production build the client bundle contained only that canary, and `19.3.1` appears in the server code only as the `package.json` version, so no transport mismatch is possible | when a Next.js release newer than 16.4.6 appears (npm "latest" was still 16.4.6 on 2026-11-23): a protocol fix inside Flight comes with it |
| 9 | `eslint` ^9 -> ^10.14.0 | **Applied** as 10.14.0 (not 10.15.0: published 2026-11-13, younger than 14 days) | 2026-10-30 | Same 113 rules as on ESLint 9, none relaxed; a probe file is reported by `react-hooks`, `@typescript-eslint`, `@next/next` and `jsx-a11y`; lint exits 0. **`npm ls` marks three dependencies of `eslint-config-next` (`eslint-plugin-import` 2.32.0, `jsx-a11y` 6.10.2, `react` 7.37.5) "invalid"**: their own peer ranges stop at ESLint 9. This means the plugin authors have not declared ESLint 10 support; they load and report on this code today, but a rule of theirs could still crash on a pattern we do not have yet. Node requirement `^20.19 \|\| ^22.13 \|\| >=24` is met (CI 22, development 24) | when `eslint-config-next` lists ESLint 10 for those plugins, or if a lint run ever crashes inside one of them (then pin ESLint back to 9) |
| 7 | `@types/node` 24.19.2 -> 26.6.6 | **Deferred** (not applied) | 2026-10-28 | CI runs Node 22, README "22+ (developed on 24)", no `engines`, no `.nvmrc`; the Vercel Node version is a project setting not visible in the repository. Types for 26 would accept APIs that Node 22/24 lack: the error would appear at run time and a green type check cannot show it | a deliberate Node upgrade (CI, README, Vercel setting, decision note) with the types on the same major. `dependabot.yml` no longer proposes major bumps of this package |
| 8 | `typescript` ^5 -> ^7 (7.0.2) | **Deferred** (not applied) | 2026-07-08 | The pull request's `checks` job: typecheck passed, then lint died at start-up with `typescript-eslint does not support TS 7.0` (`eslint-config-next` -> `typescript-eslint` 8.72.1; the newest 8.73.0 has the peer `typescript <6.1.0`; upstream issue typescript-eslint#10940); unit tests were skipped because of it. `next build` passed. Its e2e job had 1 failing test (`library.spec.ts:114`, expected 2 batches, got 4; no evidence it is related) | a `typescript-eslint` release that supports TypeScript 7 plus an `eslint-config-next` that uses it; then re-run typecheck, lint, unit and e2e. Optional step before: TypeScript 6.0.x as its own change |

**Verification of the applied set (all on branch `chore/deps`, locally, against the DEV database with own rows only):** typecheck 0; lint 0 on the whole repository; the full unit suite (53 files, 688 tests, including
`tests/unit/ci-supply-chain.test.ts`, which asserts full-SHA pinning and the version comments); `npm run audit:prod` exit 0 (4 moderate findings, none high or critical, below the gate); a production build;
the full e2e suite at the default CSP mode (621 passed, 0 failed, 0 skipped) and at `CSP_MODE=enforce` (621 passed, 0 failed, 0 skipped).
**Not verifiable locally:** the GitHub Actions bumps themselves (a workflow only runs on GitHub). Each pin was checked against the official repository's tag and release notes; the pull request's CI run is the real test, and the Dependabot pull requests #2 to #5 had already
run the same action versions green.

**Which Dependabot pull requests become obsolete once `chore/deps` is merged:** #2, #3, #4, #5 (the same action versions), #6 (react) and #9 (eslint; Dependabot proposed 10.14.0, applied here as 10.14.0). **Stay open:** #7 (`@types/node` 26) and #8 (TypeScript 7), deferred above; #7 is
expected to be closed by Dependabot by itself once the `ignore` rule for `@types/node` majors is merged (the tool's behaviour, not verified here).

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
