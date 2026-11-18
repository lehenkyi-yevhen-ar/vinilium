# Contributing

Vinilium is a small, non-commercial project. Contributions that fit its scope are welcome; read this page first.
**Security problems: do not open an issue, see [SECURITY.md](SECURITY.md).**

## Ground rules (these are not negotiable)

* **Discogs is a read-only data source and its API Terms are built in.** Keep the attribution next to every block of Discogs data, the
  exact non-affiliation notice, the 4 h cache TTL (hard cap 6 h), no permanent storage of Discogs content or images, no release-metadata
  table, search and images only when signed in, the shared 60-a-minute budget and our own limits. Every rule maps to code and a test in
  [docs/discogs-compliance.md](docs/discogs-compliance.md). A change that weakens one is not accepted.
* **Free and non-commercial**: no ads, no donations, no affiliate links, no public sharing pages of Discogs data.
* **Do not weaken** security, authentication, email verification, rate limits or accessibility.
* **`public/ds/` is the vendored design system and is never edited.** Fix things in our own components and `src/app/ds-extensions.css`.
* **Legal text**: do not invent legal claims. Passages marked `[NEEDS LEGAL REVIEW]` keep their mark.
* **Translations** (uk, en, nb): keys and placeholders stay identical across the three files (a test enforces it). Do not "improve" a
  translation by machine; flag doubtful strings for a native speaker.

## Setup

Node.js 22+ (developed on 24) and npm.

```bash
npm install
cp .env.example .env.local   # then fill in the values; the file is git-ignored and must never be committed
npm run db:migrate           # applies the migrations to the DEV database
npm run dev                  # http://localhost:3000
```

Never paste a secret into an issue, a pull request, a commit or a chat. Report which variable is set or unset by its **name** only.

## The two-database rule

There are two Neon branches and they never mix:

| Branch | Variable | Where it lives | Used by |
| --- | --- | --- | --- |
| **dev** | `DEV_DATABASE_URL` | your `.env.local` | `npm run dev`, all e2e runs, `db:*` scripts |
| **production** | `DATABASE_URL` | Vercel's environment variables only | the deployed site; a deliberate production migration is run by the owner with `--production` |

* In development and tests **there is no fallback**: without `DEV_DATABASE_URL` a process refuses to run; it never quietly uses
  `DATABASE_URL`.
* **Never use the production database for tests, walkthroughs or experiments.** State which database a command targets before running
  anything that writes.
* The dev branch may hold copies of real people's data. Tests there create and delete **only their own marked rows** (`e2e-*@example.test`
  users, rows keyed to the mock Discogs origin). Never run a destructive statement on it by hand.
* Most tests need no database at all: the unit tests run on an embedded Postgres (PGlite).

## Tests

```bash
npm run typecheck       # next typegen + tsc
npm run lint
npm test                # unit tests (Vitest, PGlite); no database or secrets needed
npm run test:e2e        # Playwright against a production build, the MOCK Discogs and MOCK Brevo servers; needs DEV_DATABASE_URL
```

Vitest has to be started from PowerShell on Windows (its runner fails to start in Git Bash). Vitest runs with at most 4 workers on purpose
(see `vitest.config.mts`). In CI the e2e job needs no secrets: it uses a throwaway Postgres container.

## Commits and pull requests

* Small, logical commits with a message that says **what and why**. Every commit must pass typecheck, lint and the unit tests.
* If a change cannot be made green after a few honest attempts, revert it and say so rather than weakening a test.
* Fix a bug test-first: write the failing test, then the fix.
* No new runtime dependencies without a strong reason. A dev dependency needs a one-line justification in the pull request. Pick versions
  that are at least 14 days old and run `npm audit`.
* Never edit or commit `.env.local`. If `.env.example` needs a line, add placeholders only (nothing key-shaped: GitHub's push protection
  flags those).
* Update the docs that describe what you changed (`README.md`, `docs/operations.md`, `docs/discogs-compliance.md`,
  `docs/data-inventory.md` when a column is added).

## CI

Every push to `main` and every pull request runs: typecheck, lint, unit tests, `npm run audit:prod`, the secret-free e2e job, CodeQL and a
secret scan. All GitHub Actions are pinned to a full commit SHA (a test checks it); Dependabot proposes updates weekly with a 14-day
cooldown.
