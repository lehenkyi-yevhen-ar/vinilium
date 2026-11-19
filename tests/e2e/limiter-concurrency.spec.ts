import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import { e2ePool, explainDbError } from "../helpers/e2e-db";

/**
 * Our own limiter under concurrency, on a REAL Postgres (the DEV branch locally, the service container in CI).
 *
 * The bug (CI log of PR #1): `insert into rate_limit (id, key, ...) values (<key>, <key>, ...) on conflict (key) do update ...` used the key as the primary key
 * too. ON CONFLICT (key) only arbitrates the `key` index, so two requests that create the SAME counter at the same moment (the first thumbnails of a
 * page, loaded in parallel by someone whose counters were purged) could hit `rate_limit_pkey` instead and fail with 23505 -> an unhandled 500.
 * The race exists only while a counter is being CREATED, and only if two inserts of the same key run on the database at the same instant, which an HTTP burst
 * from one test process hits only now and then (it did not show in several local bursts). So the decisive test is the first one: scripts/limiter-race.ts opens
 * 10 connections beforehand and fires hit() on the same brand-new key from all of them at once, 60 times (about 0.7 % of the calls failed with 23505 before
 * the fix, 0 of 3000 after). The HTTP bursts below are the end-to-end view of the same promise: a brand-new user and address, every counter created inside
 * the burst, never a 5xx. PGlite cannot show the race (one connection); this needs a real server.
 *
 * Own rows only: the users are "e2e-race-<run>-<n>@example.test" (the teardown deletes them and their limiter counters), the addresses are in the
 * documentation-only range 203.0.113.0/24 (the teardown deletes their counters).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs a real Postgres (DEV_DATABASE_URL, or the service container in CI).");
test.describe.configure({ mode: "serial" });

const MOCK = "http://localhost:3201";
const RUN = Date.now().toString(36);
const PASSWORD = "E2e-Password-123";
const ROUNDS = 3;
const BURST = 30;
const NEWLINE = String.fromCharCode(10);

async function freshUser(playwright: PlaywrightWorkerArgs["playwright"], baseURL: string, n: number, ip: string): Promise<APIRequestContext> {
  const email = `e2e-race-${RUN}-${n}@example.test`;
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip, origin: baseURL } });
  const up = await ctx.post("/api/auth/sign-up/email", { data: { name: "Race User", email, password: PASSWORD, locale: "en" } });
  expect(up.ok(), "sign-up").toBe(true);
  const pool = await e2ePool();
  try {
    await pool.query('update "user" set email_verified = true where email = $1', [email]);
  } catch (error) {
    throw explainDbError("race spec (marking the user verified)", error);
  } finally {
    await pool.end();
  }
  const inn = await ctx.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD } });
  expect(inn.ok(), "sign-in").toBe(true);
  return ctx;
}

test("hit() on 60 brand-new keys from 10 connections at the same instant: no failure, exact counts", () => {
  test.setTimeout(180_000);
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  let out = "";
  try {
    out = execFileSync(process.execPath, [tsxCli, "--conditions=react-server", "scripts/limiter-race.ts", "60", "10"], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    out = [e.stdout ?? "", e.stderr ?? ""].join(NEWLINE);
  }
  const line = out
    .trim()
    .split(NEWLINE)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  expect(line, "limiter-race printed no result: " + out.slice(-1500)).toBeTruthy();
  expect(JSON.parse(line!)).toMatchObject({ rounds: 60, concurrency: 10, failedCalls: 0, failures: {}, wrongCounts: 0 });
});

for (let round = 1; round <= ROUNDS; round++) {
  test(`round ${round}: ${BURST} parallel image requests that all create the same counters never fail with a 5xx`, async ({ playwright, baseURL }) => {
    const ip = `203.0.113.${225 + round * 7 + Math.floor(Math.random() * 5)}`;
    const ctx = await freshUser(playwright, baseURL!, round, ip);
    try {
      const url = `/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/a.png`)}`;
      const responses = await Promise.all(Array.from({ length: BURST }, () => ctx.get(url)));
      const statuses = responses.map((r) => r.status());
      const bad = statuses.filter((s) => s >= 500);
      expect(bad, `statuses: ${JSON.stringify(statuses)}`).toEqual([]);
      // an image is either served or refused by a limit (the mock's image bucket is shared with the other projects), never a server error
      expect(statuses.every((s) => s === 200 || s === 429), `statuses: ${JSON.stringify(statuses)}`).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
}

test(`${BURST} parallel searches by a brand-new user and address never fail with a 5xx`, async ({ playwright, baseURL }) => {
  const ip = `203.0.113.${215 + Math.floor(Math.random() * 5)}`;
  const ctx = await freshUser(playwright, baseURL!, 99, ip);
  try {
    const responses = await Promise.all(Array.from({ length: BURST }, (_, i) => ctx.get(`/api/discogs/search?q=${encodeURIComponent(`race-${RUN}-${i % 6}`)}&mode=artist`)));
    const statuses = responses.map((r) => r.status());
    expect(statuses.filter((s) => s >= 500), `statuses: ${JSON.stringify(statuses)}`).toEqual([]);
  } finally {
    await ctx.dispose();
  }
});
