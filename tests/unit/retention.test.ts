import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/** The daily purge: expired and stale data goes, live data and people's accounts and lists never do. */

let db: AppDb;
let close: () => Promise<void>;
vi.mock("@/server/db", async () => ({ getDb: () => db, schema: await import("@/server/db/schema") }));

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ CRON_SECRET: "cron-secret-0123456789" });
  await db.delete(schema.user);
  await db.delete(schema.verification);
  await db.delete(schema.rateLimit);
  await db.delete(schema.discogsCache);
});

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW + ms);

async function seed() {
  await db.insert(schema.user).values({ id: "u1", name: "One", email: "one@example.test" });
  await db.insert(schema.session).values([
    { id: "s-old", token: "t-old", userId: "u1", expiresAt: at(-HOUR), updatedAt: at(-2 * HOUR), ipAddress: "198.51.100.1", userAgent: "old" },
    { id: "s-live", token: "t-live", userId: "u1", expiresAt: at(HOUR), updatedAt: at(0) },
  ]);
  await db.insert(schema.account).values({ id: "a1", accountId: "u1", providerId: "credential", userId: "u1", password: "hash", updatedAt: at(0) });
  await db.insert(schema.userItems).values([
    { userId: "u1", discogsReleaseId: 1, list: "wishlist" },
    { userId: "u1", discogsReleaseId: 2, list: "collection", notes: "keep" },
  ]);
  await db.insert(schema.verification).values([
    { id: "v-old", identifier: "one@example.test", value: "x", expiresAt: at(-1000) },
    { id: "v-live", identifier: "two@example.test", value: "y", expiresAt: at(HOUR) },
  ]);
  await db.insert(schema.rateLimit).values([
    { id: "r1", key: "app:search:ip:198.51.100.1", count: 3, lastRequest: NOW - 2 * HOUR }, // ours, stale
    { id: "r2", key: "198.51.100.1/sign-in/email", count: 3, lastRequest: NOW - 2 * HOUR }, // Better Auth's, stale: holds an IP address
    { id: "r3", key: "app:search:ip:198.51.100.2", count: 3, lastRequest: NOW - 1000 }, // fresh
    { id: "r4", key: "198.51.100.2/sign-in/email", count: 1, lastRequest: NOW - 5 * 60_000 }, // fresh
  ]);
  await db.insert(schema.discogsCache).values([
    { key: "old", payload: { a: 1 }, fetchedAt: at(-2 * HOUR), expiresAt: at(-HOUR) },
    { key: "fresh", payload: { a: 2 }, fetchedAt: at(0), expiresAt: at(HOUR) },
  ]);
}
const ids = async (table: typeof schema.session | typeof schema.verification | typeof schema.rateLimit) => (await db.select({ id: table.id }).from(table)).map((r) => r.id).sort();
const counts = async () => ({
  users: (await db.select().from(schema.user)).length,
  accounts: (await db.select().from(schema.account)).length,
  items: (await db.select().from(schema.userItems)).length,
});

describe("purgeRetention", () => {
  it("dry run: reports what a real run would delete and deletes nothing", async () => {
    await seed();
    const { purgeRetention } = await import("@/server/retention");
    const before = { sessions: await ids(schema.session), verification: await ids(schema.verification), rate: await ids(schema.rateLimit), cache: (await db.select().from(schema.discogsCache)).length };
    expect(await purgeRetention(db, { now: NOW, dryRun: true })).toEqual({ dryRun: true, cacheRows: 1, verificationRows: 1, sessionRows: 1, rateLimitRows: 2 });
    expect(await ids(schema.session)).toEqual(before.sessions);
    expect(await ids(schema.verification)).toEqual(before.verification);
    expect(await ids(schema.rateLimit)).toEqual(before.rate);
    expect((await db.select().from(schema.discogsCache)).length).toBe(before.cache);
  });

  it("deletes expired sessions and verification rows, old counters (ours and Better Auth's) and expired cache rows, and only those", async () => {
    await seed();
    const { purgeRetention } = await import("@/server/retention");
    expect(await purgeRetention(db, { now: NOW })).toEqual({ dryRun: false, cacheRows: 1, verificationRows: 1, sessionRows: 1, rateLimitRows: 2 });
    expect(await ids(schema.session)).toEqual(["s-live"]);
    expect(await ids(schema.verification)).toEqual(["v-live"]);
    expect(await ids(schema.rateLimit)).toEqual(["r3", "r4"]);
    expect((await db.select().from(schema.discogsCache)).map((r) => r.key)).toEqual(["fresh"]);
  });

  it("never touches accounts, users or lists", async () => {
    await seed();
    const { purgeRetention } = await import("@/server/retention");
    const before = await counts();
    await purgeRetention(db, { now: NOW });
    await purgeRetention(db, { now: NOW + 365 * 24 * HOUR }); // even a year later: sessions and links are gone, people and their lists are not
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ users: 1, accounts: 1, items: 2 });
  });

  it("is safe to run twice: the second run finds nothing", async () => {
    await seed();
    const { purgeRetention } = await import("@/server/retention");
    await purgeRetention(db, { now: NOW });
    expect(await purgeRetention(db, { now: NOW })).toEqual({ dryRun: false, cacheRows: 0, verificationRows: 0, sessionRows: 0, rateLimitRows: 0 });
  });

  it("keeps a counter whose window ended less than an hour ago", async () => {
    await db.insert(schema.rateLimit).values({ id: "edge", key: "198.51.100.9/sign-in/email", count: 2, lastRequest: NOW - HOUR + 1 });
    const { purgeRetention } = await import("@/server/retention");
    expect((await purgeRetention(db, { now: NOW })).rateLimitRows).toBe(0);
  });
});

describe("GET /api/cron/purge", () => {
  const call = async (query = "", authorization?: string) => {
    const { GET } = await import("@/app/api/cron/purge/route");
    return GET(new Request(`http://localhost/api/cron/purge${query}`, { headers: authorization ? { authorization } : {} }));
  };

  it("needs the secret, in constant time, and is disabled without one", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("", "Bearer wrong")).status).toBe(401);
    expect((await call("", "cron-secret-0123456789")).status).toBe(401); // no "Bearer"
    vi.resetModules();
    setEnv({});
    delete process.env.CRON_SECRET;
    expect((await call("", "Bearer cron-secret-0123456789")).status).toBe(401);
  });

  it("?dryRun=1 only counts; without it, it deletes", async () => {
    await db.insert(schema.user).values({ id: "u9", name: "Nine", email: "nine@example.test" });
    await db.insert(schema.session).values({ id: "s9", token: "t9", userId: "u9", expiresAt: new Date(Date.now() - HOUR), updatedAt: new Date() });
    const dry = await (await call("?dryRun=1", "Bearer cron-secret-0123456789")).json();
    expect(dry).toMatchObject({ ok: true, dryRun: true, sessionRows: 1 });
    expect(await ids(schema.session)).toEqual(["s9"]);
    const real = await (await call("", "Bearer cron-secret-0123456789")).json();
    expect(real).toMatchObject({ ok: true, dryRun: false, sessionRows: 1 });
    expect(await ids(schema.session)).toEqual([]);
  });
});
