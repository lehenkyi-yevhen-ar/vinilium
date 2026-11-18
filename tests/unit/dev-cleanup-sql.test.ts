import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { discogsBucket, discogsCache, rateLimit, session, account, user, userItems, verification } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";

/**
 * docs/ops/dev-cleanup.sql is never run by the agent, so it is run HERE, on an embedded Postgres with the real migrations:
 * it must parse, refuse to run off the expected branch, delete exactly the personal data, keep the schema, the migration journal
 * and the Discogs cache, and be safe to run twice. (The Neon-only setting `neon.branch_id` does not exist in PGlite, which is
 * exactly the "branch id unknown" case the file's override line is for.)
 */

const FILE = readFileSync(path.resolve(__dirname, "../../docs/ops/dev-cleanup.sql"), "utf8");
const part = (from: string, to?: string) => {
  const a = FILE.indexOf(from);
  const b = to ? FILE.indexOf(to) : FILE.length;
  expect(a, `marker "${from}"`).toBeGreaterThan(-1);
  expect(b, `marker "${to}"`).toBeGreaterThan(a);
  return FILE.slice(a, b);
};
const PART1 = part("-- PART 1: READ-ONLY CHECK", "-- PART 2: THE CLEAN-UP");
const PART2 = part("-- PART 2: THE CLEAN-UP", "-- PART 3: READ-ONLY CHECK AFTER");
const PART3 = part("-- PART 3: READ-ONLY CHECK AFTER");

let db: AppDb;
let close: () => Promise<void>;
// drizzle's pglite driver keeps the raw client here
const raw = () => (db as unknown as { $client: { exec: (q: string) => Promise<unknown[]> } }).$client;
const count = async (table: string) => Number((await db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n);

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

async function seed() {
  const now = new Date();
  await db.insert(user).values([
    { id: "u1", name: "Synthetic One", email: "one@example.test" },
    { id: "u2", name: "Synthetic Two", email: "two@example.test" },
  ]);
  await db.insert(session).values({ id: "s1", token: "t1", userId: "u1", expiresAt: new Date(now.getTime() + 3_600_000), updatedAt: now, ipAddress: "198.51.100.1" });
  await db.insert(account).values({ id: "a1", accountId: "g1", providerId: "google", userId: "u2", updatedAt: now });
  await db.insert(verification).values({ id: "v1", identifier: "one@example.test", value: "x", expiresAt: now });
  await db.insert(userItems).values({ userId: "u1", discogsReleaseId: 1, list: "wishlist", notes: "synthetic" });
  await db.insert(rateLimit).values({ id: "r1", key: "app:search:ip:198.51.100.1", count: 3, lastRequest: Date.now() });
  await db.insert(discogsCache).values({ key: "k1", payload: { a: 1 }, fetchedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
  await db.insert(discogsBucket).values({ id: "api:test", tokens: 10, capacity: 25, refillPerSec: 0.4, updatedAt: now });
}

describe("docs/ops/dev-cleanup.sql", () => {
  it("PART 1 and PART 3 are read-only and run", async () => {
    await seed();
    const before = await count('"user"');
    await raw().exec(PART1);
    await raw().exec(PART3);
    expect(await count('"user"')).toBe(before);
    expect(PART1).toContain("br-empty-band-b9f6dxji"); // the expected DEV branch id, as the owner stated it
    expect(PART1 + PART3).not.toMatch(/\b(delete|update|insert|truncate|drop|alter)\b\s+(from|into|table)?/i);
  });

  it("PART 2 stops, and changes nothing, when the branch id is not the expected one (or unknown) and no override is set", async () => {
    await db.execute(sql.raw("select set_config('vinilium.dev_branch_confirmed_by_hand', '', false)"));
    await expect(raw().exec(PART2)).rejects.toThrow(/not the DEV branch/);
    await db.execute(sql.raw("rollback")).catch(() => {});
    expect(await count('"user"')).toBe(2);
    expect(await count("user_items")).toBe(1);
    expect(await count("verification")).toBe(1);
  });

  it("PART 2 with the by-hand override deletes all personal data and keeps the schema, the journal and the Discogs cache", async () => {
    const journalBefore = await count("drizzle.__drizzle_migrations");
    expect(journalBefore).toBeGreaterThan(0);
    await raw().exec(PART2.replace("-- select set_config", "select set_config"));
    for (const t of ['"user"', "session", "account", "verification", "user_items", "rate_limit"]) expect(await count(t), t).toBe(0);
    expect(await count("discogs_cache")).toBe(1);
    expect(await count("discogs_bucket")).toBe(1);
    expect(await count("drizzle.__drizzle_migrations")).toBe(journalBefore);
    // the tables are still there, with their columns (the schema is untouched)
    const cols = await db.execute(sql.raw("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'user_items'"));
    expect(Number(cols.rows[0].n)).toBeGreaterThan(5);
  });

  it("is safe to run twice", async () => {
    await raw().exec(PART2.replace("-- select set_config", "select set_config"));
    for (const t of ['"user"', "session", "account", "verification", "user_items", "rate_limit"]) expect(await count(t), t).toBe(0);
  });

  it("mentions every personal-data table that exists (it fails when a table is added to the schema and the script is not updated)", async () => {
    const tables = (await db.execute(sql.raw("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"))).rows.map((r: Record<string, unknown>) => String(r.table_name));
    const known = ["user", "session", "account", "verification", "user_items", "rate_limit", "discogs_cache", "discogs_bucket"];
    expect(tables.sort()).toEqual(known.sort());
    for (const t of known) expect(FILE, t).toContain(t);
  });
});
