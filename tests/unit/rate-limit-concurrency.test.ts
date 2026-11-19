import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * The counter row's id and the creation race (PR #1, CI log): `insert ... (id, key, ...) values (<key>, <key>, ...) on conflict (key) do update`
 * used the key as the primary key too. `ON CONFLICT (key)` only arbitrates the `key` index, so a collision on the PRIMARY KEY (`id`) was a
 * 23505 "duplicate key value violates unique constraint rate_limit_pkey" -> an unhandled 500 for whoever lost the race.
 *
 * PGlite has one connection, so it cannot produce the real race; tests/e2e/limiter-concurrency.spec.ts and scripts/limiter-race.ts do that on a real
 * Postgres. What PGlite CAN show deterministically is the cause: a row that already holds the id the old code would have chosen.
 */

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.execute(sql`drop trigger if exists zz_boom on rate_limit`);
  await db.delete(rateLimit);
});

const T0 = 3_000_000_000_000;
const rows = () => db.select().from(rateLimit);

describe("the counter row id is not the key", () => {
  it("a counter is created with its own id, and the next hit updates that same row", async () => {
    const { hit } = await import("@/server/rate-limit");
    await hit(db, { key: "image:user:u1", limit: 10, windowSec: 60, now: T0 });
    const [first] = await rows();
    expect(first.key).toBe("app:image:user:u1");
    expect(first.id).not.toBe(first.key);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/); // a random UUID, like the ids Better Auth's adapter gives its own rows

    await hit(db, { key: "image:user:u1", limit: 10, windowSec: 60, now: T0 + 1000 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(all[0].count).toBe(2);
  });

  it("the deterministic reproduction: a row that already holds the id the old code chose does not make the first hit fail", async () => {
    // Old code: id = key. Another row holding that id (here under a different key) made the insert collide on rate_limit_pkey, which
    // ON CONFLICT (key) does not arbitrate: 23505. With a random id there is nothing to collide with.
    await db.insert(rateLimit).values({ id: "app:image:user:u2", key: "legacy-other-key", count: 1, lastRequest: T0 });
    const { hit } = await import("@/server/rate-limit");
    const r = await hit(db, { key: "image:user:u2", limit: 10, windowSec: 60, now: T0 });
    expect(r).toMatchObject({ allowed: true, count: 1 });
  });

  it("rows written by the old code (id = key) keep counting: no migration is needed", async () => {
    await db.insert(rateLimit).values({ id: "app:search:user:u3", key: "app:search:user:u3", count: 5, lastRequest: T0 });
    const { hit } = await import("@/server/rate-limit");
    const r = await hit(db, { key: "search:user:u3", limit: 10, windowSec: 60, now: T0 + 1000 });
    expect(r.count).toBe(6);
    expect(await rows()).toHaveLength(1);
  });

  it("does not touch Better Auth's rows (other keys, ids it generated itself)", async () => {
    await db.insert(rateLimit).values({ id: "ba-generated-id", key: "203.0.113.9|/sign-in/email", count: 3, lastRequest: T0 });
    const { hit } = await import("@/server/rate-limit");
    await hit(db, { key: "image:ip:203.0.113.9", limit: 10, windowSec: 60, now: T0 });
    const ba = (await rows()).find((r) => r.id === "ba-generated-id");
    expect(ba).toMatchObject({ key: "203.0.113.9|/sign-in/email", count: 3 });
  });
});

describe("many hits at once on a brand-new key (as far as one connection can interleave them)", () => {
  it("every call succeeds, every call sees its own count, and the stored count is exact", async () => {
    const { hit } = await import("@/server/rate-limit");
    const results = await Promise.all(Array.from({ length: 40 }, () => hit(db, { key: "image:user:burst", limit: 1000, windowSec: 60, now: T0 })));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(40);
  });

  it("the window still resets exactly once when it has passed (no double reset, no lost count)", async () => {
    const { hit } = await import("@/server/rate-limit");
    await hit(db, { key: "search:user:w", limit: 5, windowSec: 60, now: T0 });
    await hit(db, { key: "search:user:w", limit: 5, windowSec: 60, now: T0 + 1000 });
    const later = await Promise.all(Array.from({ length: 6 }, () => hit(db, { key: "search:user:w", limit: 5, windowSec: 60, now: T0 + 61_000 })));
    expect(later.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]); // one reset to 1, then 5 more
    expect(later.filter((r) => !r.allowed)).toHaveLength(1); // the sixth is over the limit of 5
  });
});

describe("a unique violation is retried once, anything else becomes LimiterUnavailableError", () => {
  const trigger = async (body: string) => {
    await db.execute(sql.raw(`create or replace function zz_boom() returns trigger language plpgsql as $$ begin ${body} end $$`));
    await db.execute(sql`create trigger zz_boom before insert on rate_limit for each row execute function zz_boom()`);
  };

  it("one lost creation race (23505) is retried and succeeds", async () => {
    // a sequence survives the failed statement's rollback (a flag row would not), so only the FIRST insert fails
    await db.execute(sql`drop sequence if exists zz_seq`);
    await db.execute(sql`create sequence zz_seq`);
    await trigger(`if nextval('zz_seq') = 1 then raise exception 'simulated lost race' using errcode = '23505'; end if; return new;`);
    const { hit } = await import("@/server/rate-limit");
    const r = await hit(db, { key: "image:ip:retry", limit: 10, windowSec: 60, now: T0 });
    expect(r).toMatchObject({ allowed: true, count: 1 });
    expect(await rows()).toHaveLength(1);
  });

  it("a unique violation that persists is LimiterUnavailableError, never an answer", async () => {
    await trigger(`raise exception 'simulated' using errcode = '23505';`);
    const { hit, LimiterUnavailableError } = await import("@/server/rate-limit");
    const failure = await hit(db, { key: "image:ip:persist", limit: 10, windowSec: 60, now: T0 }).catch((e) => e);
    expect(failure).toBeInstanceOf(LimiterUnavailableError);
    expect((failure as Error).cause).toBeDefined();
  });

  it("any other database error is LimiterUnavailableError at once (no retry, no result)", async () => {
    let attempts = 0;
    const flaky = {
      insert: () => {
        attempts++;
        throw Object.assign(new Error("connection terminated"), { code: "57P01" });
      },
    } as unknown as AppDb;
    const { hit, LimiterUnavailableError } = await import("@/server/rate-limit");
    await expect(hit(flaky, { key: "search:ip:x", limit: 10, windowSec: 60, now: T0 })).rejects.toBeInstanceOf(LimiterUnavailableError);
    expect(attempts).toBe(1);
  });

  it("a unique violation wrapped in drizzle's 'Failed query' error is still recognised through its cause", async () => {
    let attempts = 0;
    const wrapped = {
      insert: () => {
        attempts++;
        throw Object.assign(new Error("Failed query: insert ..."), { cause: Object.assign(new Error("duplicate key"), { code: "23505" }) });
      },
    } as unknown as AppDb;
    const { hit, LimiterUnavailableError } = await import("@/server/rate-limit");
    await expect(hit(wrapped, { key: "search:ip:y", limit: 10, windowSec: 60, now: T0 })).rejects.toBeInstanceOf(LimiterUnavailableError);
    expect(attempts).toBe(2); // tried, recognised the violation, retried once
  });
});
