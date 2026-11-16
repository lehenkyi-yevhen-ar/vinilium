import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { user, userItems } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { getItem, MAX_ITEMS_PER_USER, removeItem, setItemList } from "@/server/lists/items";
import { createTestDb } from "../helpers/pglite";

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const mkUser = (id: string) =>
  db.insert(user).values({ id, name: id, email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });

beforeEach(async () => {
  await db.delete(userItems);
  await db.delete(user);
  await mkUser("u1");
  await mkUser("u2");
});

describe("one list per pressing", () => {
  it("adds to a list, is idempotent, and MOVES (one row) when added to the other list", async () => {
    const a = await setItemList(db, "u1", 951004, "wishlist");
    expect(a).toMatchObject({ ok: true, result: "added", item: { releaseId: 951004, list: "wishlist" } });

    const again = await setItemList(db, "u1", 951004, "wishlist");
    expect(again).toMatchObject({ ok: true, result: "unchanged" });

    const moved = await setItemList(db, "u1", 951004, "collection");
    expect(moved).toMatchObject({ ok: true, result: "moved", item: { list: "collection" } });

    const rows = await db.select().from(userItems).where(eq(userItems.userId, "u1"));
    expect(rows).toHaveLength(1); // never on both lists
    expect(rows[0].list).toBe("collection");
  });

  it("keeps the added_at of the first add when moving", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    await setItemList(db, "u1", 1, "wishlist", t1);
    const moved = await setItemList(db, "u1", 1, "collection", new Date("2026-02-01T00:00:00Z"));
    expect(moved.ok && moved.item.addedAt.toISOString()).toBe(t1.toISOString());
  });

  it("is per user", async () => {
    await setItemList(db, "u1", 5, "wishlist");
    await setItemList(db, "u2", 5, "collection");
    expect((await getItem(db, "u1", 5))?.list).toBe("wishlist");
    expect((await getItem(db, "u2", 5))?.list).toBe("collection");
  });

  it("survives two requests racing to add the same pressing", async () => {
    const results = await Promise.all([setItemList(db, "u1", 77, "wishlist"), setItemList(db, "u1", 77, "wishlist"), setItemList(db, "u1", 77, "collection")]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.select().from(userItems).where(eq(userItems.userId, "u1"))).toHaveLength(1);
  });

  it("the database itself refuses a second row or an unknown list name", async () => {
    await setItemList(db, "u1", 9, "wishlist");
    await expect(db.insert(userItems).values({ userId: "u1", discogsReleaseId: 9, list: "collection" })).rejects.toThrow();
    await expect(db.insert(userItems).values({ userId: "u1", discogsReleaseId: 10, list: "favourites" })).rejects.toThrow();
  });
});

describe("remove, limits and cascade", () => {
  it("removes an item and reports whether anything was removed", async () => {
    await setItemList(db, "u1", 3, "wishlist");
    expect(await removeItem(db, "u1", 3)).toBe(true);
    expect(await removeItem(db, "u1", 3)).toBe(false);
    expect(await getItem(db, "u1", 3)).toBeNull();
  });

  it("refuses new items beyond the per-user cap but still allows moving existing ones", async () => {
    await db.insert(userItems).values(Array.from({ length: MAX_ITEMS_PER_USER }, (_, i) => ({ userId: "u1", discogsReleaseId: i + 1, list: "wishlist" })));
    expect(await setItemList(db, "u1", 999_999, "wishlist")).toEqual({ ok: false, error: "limit_reached" });
    expect(await setItemList(db, "u1", 1, "collection")).toMatchObject({ ok: true, result: "moved" });
  });

  it("deleting the account deletes the list rows (ON DELETE CASCADE)", async () => {
    await setItemList(db, "u1", 1, "wishlist");
    await setItemList(db, "u1", 2, "collection");
    await setItemList(db, "u2", 1, "wishlist");
    await db.delete(user).where(eq(user.id, "u1"));
    const left = await db.select().from(userItems);
    expect(left.map((r) => r.userId)).toEqual(["u2"]);
  });

  it("stores only an ID and the user's own fields: no Discogs content columns", async () => {
    const cols = Object.keys(getTableColumns(userItems)).sort();
    expect(cols).toEqual(["addedAt", "conditionMedia", "conditionSleeve", "discogsReleaseId", "id", "list", "notes", "updatedAt", "userId"]);
  });
});
