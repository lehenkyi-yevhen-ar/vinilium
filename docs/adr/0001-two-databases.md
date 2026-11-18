# 0001. Two databases: dev and production, no fallback

**Status:** accepted (2026-11-16, tightened 2026-11-17).

## Context

Until 2026-11-16 every command (migrations, e2e, walkthroughs) used one `DATABASE_URL`, which was the production Neon branch. Tests create
and delete users, sessions and cache rows, so that was a real risk to real data.

## Decision

* Neon has two branches. `DATABASE_URL` is production and is set in Vercel only. `DEV_DATABASE_URL` is the dev branch and lives in the
  git-ignored `.env.local`.
* The rule is one pure function (`src/lib/database-target.ts`), shared by the app, the scripts, `drizzle.config.ts`, Playwright and the tests:
  production runtime uses `DATABASE_URL`; development and test use `DEV_DATABASE_URL` **and nothing else**. Without it a process refuses to
  start. There is no fallback.
* Scripts print their target (host, database, branch, never credentials) and refuse production without `--production` (migrations) or
  always (anything that creates or deletes test data). If `DEV_DATABASE_URL` points at the production server, everything refuses.
* Most tests need no database: the unit tests run on an embedded Postgres (PGlite) with the real migrations.

## Consequences

* A developer machine never needs the production string. A production migration is a deliberate command run by the owner.
* The dev branch may hold copies of real accounts, so tests there create and delete only their own marked rows
  (`e2e-*@example.test`, rows keyed to the mock Discogs origin); `docs/ops/dev-cleanup.sql` removes personal data from it on request.
* CI needs a database that is neither: the secret-free e2e job uses a throwaway Postgres container reached through Neon's open-source
  websocket proxy, because the app uses the Neon serverless driver (`src/lib/neon-local.ts`, never applied to a `*.neon.tech` host).
