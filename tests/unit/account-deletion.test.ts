import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { isForeignKeyViolation } from "@/server/db/errors";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * Deleting an account: every row that belongs to the person goes with it, and a request that was already in flight when it happened is
 * answered with "signed out", never with a crash or an orphan row.
 */

let db: AppDb;
let close: () => Promise<void>;
const getSession = vi.fn();
vi.mock("@/server/db", async () => ({ getDb: () => db, schema: await import("@/server/db/schema") }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(schema.user);
  await db.delete(schema.rateLimit);
  getSession.mockReset();
});

const now = new Date();
async function person(id: string) {
  await db.insert(schema.user).values({ id, name: `Person ${id}`, email: `${id}@example.test` });
  await db.insert(schema.session).values({ id: `s-${id}`, token: `t-${id}`, userId: id, expiresAt: new Date(now.getTime() + 3_600_000), updatedAt: now, ipAddress: "198.51.100.1", userAgent: "test" });
  await db.insert(schema.account).values({ id: `a-${id}`, accountId: id, providerId: "credential", userId: id, password: "hash", updatedAt: now });
  await db.insert(schema.userItems).values([
    { userId: id, discogsReleaseId: 1, list: "wishlist", notes: "n" },
    { userId: id, discogsReleaseId: 2, list: "collection", conditionMedia: "NM" },
  ]);
}
const rowsOf = async (id: string) => ({
  user: (await db.select().from(schema.user).where(eq(schema.user.id, id))).length,
  session: (await db.select().from(schema.session).where(eq(schema.session.userId, id))).length,
  account: (await db.select().from(schema.account).where(eq(schema.account.userId, id))).length,
  items: (await db.select().from(schema.userItems).where(eq(schema.userItems.userId, id))).length,
});

describe("deleting a user", () => {
  it("removes the user, sessions, accounts and every list item, and nobody else's", async () => {
    await person("gone");
    await person("stays");
    expect(await rowsOf("gone")).toEqual({ user: 1, session: 1, account: 1, items: 2 });
    await db.delete(schema.user).where(eq(schema.user.id, "gone"));
    expect(await rowsOf("gone")).toEqual({ user: 0, session: 0, account: 0, items: 0 });
    expect(await rowsOf("stays")).toEqual({ user: 1, session: 1, account: 1, items: 2 });
  });

  it("deleting twice is harmless", async () => {
    await person("twice");
    await db.delete(schema.user).where(eq(schema.user.id, "twice"));
    await expect(db.delete(schema.user).where(eq(schema.user.id, "twice"))).resolves.toBeDefined();
  });
});

describe("a request that was already in flight when the account was deleted", () => {
  const ctx = { params: Promise.resolve({ releaseId: "555" }) };
  const put = async () => {
    const { PUT } = await import("@/app/api/lists/items/[releaseId]/route");
    return PUT(new Request("http://localhost/api/lists/items/555", { method: "PUT", headers: { cookie: "better-auth.session_token=abc", origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ list: "wishlist" }) }), ctx);
  };

  it("recognises a foreign-key violation inside driver and ORM wrappers, and nothing else", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation(new Error("x", { cause: { cause: { code: "23503" } } }))).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
  });

  it("a write for a user whose row has just been deleted is answered 401, writes nothing, and does not crash", async () => {
    getSession.mockResolvedValue({ user: { id: "ghost" } }); // the session lookup succeeded before the deletion
    const res = await put();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(await db.select().from(schema.userItems)).toHaveLength(0);
  });

  it("twenty writes racing a deletion all end as 200 or 401, and no row of the deleted person survives", async () => {
    await person("racer");
    getSession.mockResolvedValue({ user: { id: "racer" } });
    const { PUT } = await import("@/app/api/lists/items/[releaseId]/route");
    const write = (n: number) =>
      PUT(new Request(`http://localhost/api/lists/items/${900 + n}`, { method: "PUT", headers: { cookie: "better-auth.session_token=abc", origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ list: "collection" }) }), { params: Promise.resolve({ releaseId: String(900 + n) }) });
    const results = await Promise.all([...Array.from({ length: 10 }, (_, n) => write(n)), db.delete(schema.user).where(eq(schema.user.id, "racer")), ...Array.from({ length: 10 }, (_, n) => write(10 + n))]);
    for (const r of results) if (r instanceof Response) expect([200, 401], `status ${r.status}`).toContain(r.status);
    expect(await rowsOf("racer")).toEqual({ user: 0, session: 0, account: 0, items: 0 });
  });
});
