import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { csvCell, EXPORT_COLUMNS, toCsv, toJson } from "@/lib/lists/export";
import { CONDITIONS, isCondition, isListName, NOTES_MAX, otherList, PAGE_SIZES, sortAllowed } from "@/lib/lists/rules";
import { user, userItems } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { allItems, queryItems, setItemList, toStoredJson, updateItem } from "@/server/lists/items";
import { createTestDb } from "../helpers/pglite";

/** Milestone 4: listing (pagination, sort, search), editing the user's own fields, export, cascade. All against embedded Postgres (PGlite). */

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

const day = (d: number) => new Date(Date.UTC(2026, 0, d));
type Seed = { id: number; list?: "wishlist" | "collection"; day: number; notes?: string | null; media?: string | null; sleeve?: string | null };
async function seed(userId: string, rows: Seed[]) {
  await db.insert(userItems).values(
    rows.map((r) => ({
      userId,
      discogsReleaseId: r.id,
      list: r.list ?? "wishlist",
      notes: r.notes ?? null,
      conditionMedia: r.media ?? null,
      conditionSleeve: r.sleeve ?? null,
      addedAt: day(r.day),
      updatedAt: day(r.day),
    })),
  );
}
const ids = (p: { items: Array<{ releaseId: number }> }) => p.items.map((i) => i.releaseId);

describe("queryItems: pagination", () => {
  it("pages at 12 by default and 24 on request, with totals and a stable order", async () => {
    await seed("u1", Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, day: i + 1 })));
    const p1 = await queryItems(db, "u1", { list: "wishlist" });
    expect(p1).toMatchObject({ page: 1, pages: 3, pageSize: 12, total: 30 });
    expect(p1.items).toHaveLength(12);
    expect(ids(p1)[0]).toBe(129); // newest first

    const p3 = await queryItems(db, "u1", { list: "wishlist", page: 3 });
    expect(p3.items).toHaveLength(6);

    const big = await queryItems(db, "u1", { list: "wishlist", pageSize: 24 });
    expect(big).toMatchObject({ pages: 2, pageSize: 24 });
    expect(big.items).toHaveLength(24);

    const seen = new Set([...ids(p1), ...ids(await queryItems(db, "u1", { list: "wishlist", page: 2 })), ...ids(p3)]);
    expect(seen.size).toBe(30); // no repeats, no skips
  });

  it("clamps a page beyond the last, ignores nonsense and unsupported page sizes", async () => {
    await seed("u1", Array.from({ length: 13 }, (_, i) => ({ id: i + 1, day: i + 1 })));
    expect((await queryItems(db, "u1", { list: "wishlist", page: 99 })).page).toBe(2);
    expect((await queryItems(db, "u1", { list: "wishlist", page: -4 })).page).toBe(1);
    expect((await queryItems(db, "u1", { list: "wishlist", page: Number.NaN })).page).toBe(1);
    expect((await queryItems(db, "u1", { list: "wishlist", pageSize: 500 })).pageSize).toBe(12);
  });

  it("an empty list is one empty page; counts cover both lists; users never see each other's items", async () => {
    await seed("u1", [{ id: 1, day: 1 }, { id: 2, day: 2, list: "collection" }, { id: 3, day: 3, list: "collection" }]);
    await seed("u2", [{ id: 9, day: 1 }]);
    const empty = await queryItems(db, "u2", { list: "collection" });
    expect(empty).toMatchObject({ total: 0, page: 1, pages: 1, items: [], counts: { wishlist: 1, collection: 0 } });
    const mine = await queryItems(db, "u1", { list: "collection" });
    expect(ids(mine).sort()).toEqual([2, 3]);
    expect(mine.counts).toEqual({ wishlist: 1, collection: 2 });
  });
});

describe("queryItems: sort", () => {
  it("sorts by added date, newest or oldest first", async () => {
    await seed("u1", [{ id: 1, day: 5 }, { id: 2, day: 1 }, { id: 3, day: 9 }]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", sort: "added", dir: "desc" }))).toEqual([3, 1, 2]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", sort: "added", dir: "asc" }))).toEqual([2, 1, 3]);
  });

  it("sorts by notes case-insensitively, items without notes last in both directions", async () => {
    await seed("u1", [
      { id: 1, day: 1, notes: "banana" },
      { id: 2, day: 2, notes: null },
      { id: 3, day: 3, notes: "Apple" },
      { id: 4, day: 4, notes: "cherry" },
    ]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", sort: "notes", dir: "asc" }))).toEqual([3, 1, 4, 2]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", sort: "notes", dir: "desc" }))).toEqual([4, 1, 3, 2]);
  });

  it("sorts the collection by condition (best first), media before sleeve, ungraded last; reversed for worst first", async () => {
    await seed("u1", [
      { id: 1, day: 1, list: "collection", media: "VG", sleeve: "VG" },
      { id: 2, day: 2, list: "collection", media: "NM", sleeve: "G" },
      { id: 3, day: 3, list: "collection", media: "NM", sleeve: "NM" },
      { id: 4, day: 4, list: "collection" },
      { id: 5, day: 5, list: "collection", media: "M", sleeve: "M" },
    ]);
    expect(ids(await queryItems(db, "u1", { list: "collection", sort: "condition", dir: "asc" }))).toEqual([5, 3, 2, 1, 4]);
    expect(ids(await queryItems(db, "u1", { list: "collection", sort: "condition", dir: "desc" }))).toEqual([4, 1, 2, 3, 5]);
  });

  it("a condition sort does not exist on the wishlist: it falls back to the added date", async () => {
    await seed("u1", [{ id: 1, day: 1 }, { id: 2, day: 2 }]);
    const p = await queryItems(db, "u1", { list: "wishlist", sort: "condition", dir: "asc" });
    expect(p.sort).toBe("added");
  });
});

describe("queryItems: search on stored fields only", () => {
  it("finds items by their notes, case-insensitively", async () => {
    await seed("u1", [{ id: 1, day: 1, notes: "Bought at the Berlin market" }, { id: 2, day: 2, notes: "gift" }, { id: 3, day: 3 }]);
    const hit = await queryItems(db, "u1", { list: "wishlist", q: "berlin" });
    expect(ids(hit)).toEqual([1]);
    expect(hit.total).toBe(1);
    expect(await queryItems(db, "u1", { list: "wishlist", q: "nothing like this" })).toMatchObject({ total: 0, items: [], q: "nothing like this" });
  });

  it("treats % _ and \\ as text, not wildcards", async () => {
    await seed("u1", [
      { id: 1, day: 1, notes: "100% mint" },
      { id: 2, day: 2, notes: "1000 mint" },
      { id: 3, day: 3, notes: "a_b" },
      { id: 4, day: 4, notes: "axb" },
      { id: 5, day: 5, notes: "back\\slash" },
    ]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", q: "%" }))).toEqual([1]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", q: "_" }))).toEqual([3]);
    expect(ids(await queryItems(db, "u1", { list: "wishlist", q: "\\" }))).toEqual([5]);
  });

  it("typing a grade finds collection items graded that, on media or sleeve", async () => {
    await seed("u1", [
      { id: 1, day: 1, list: "collection", media: "VG+", sleeve: "NM" },
      { id: 2, day: 2, list: "collection", media: "NM", sleeve: "VG+" },
      { id: 3, day: 3, list: "collection", media: "G" },
    ]);
    expect(ids(await queryItems(db, "u1", { list: "collection", q: "vg+" })).sort()).toEqual([1, 2]);
    expect(ids(await queryItems(db, "u1", { list: "collection", q: "g" }))).toEqual([3]);
  });

  it("search plus pagination: total and pages describe the filtered set; search never crosses users or lists", async () => {
    await seed("u1", Array.from({ length: 15 }, (_, i) => ({ id: i + 1, day: i + 1, notes: "keeper" })));
    await seed("u1", [{ id: 50, day: 1, list: "collection", notes: "keeper" }]);
    await seed("u2", [{ id: 60, day: 1, notes: "keeper" }]);
    const p = await queryItems(db, "u1", { list: "wishlist", q: "keeper", page: 2 });
    expect(p).toMatchObject({ total: 15, pages: 2, page: 2 });
    expect(p.items).toHaveLength(3);
  });
});

describe("updateItem", () => {
  it("edits the notes: trims, turns blank into null, strips control characters, normalises newlines", async () => {
    await seed("u1", [{ id: 1, day: 1 }]);
    expect(await updateItem(db, "u1", 1, { notes: "  first\r\nsecond\u0007  " })).toMatchObject({ ok: true, item: { notes: "first\nsecond" } });
    expect(await updateItem(db, "u1", 1, { notes: "   " })).toMatchObject({ ok: true, item: { notes: null } });
    expect(await updateItem(db, "u1", 1, { notes: null })).toMatchObject({ ok: true, item: { notes: null } });
  });

  it("refuses notes over the limit and leaves the stored value untouched", async () => {
    await seed("u1", [{ id: 1, day: 1, notes: "keep me" }]);
    expect(await updateItem(db, "u1", 1, { notes: "x".repeat(NOTES_MAX + 1) })).toEqual({ ok: false, error: "notes_too_long" });
    expect((await db.select().from(userItems))[0].notes).toBe("keep me");
    expect(await updateItem(db, "u1", 1, { notes: "x".repeat(NOTES_MAX) })).toMatchObject({ ok: true });
  });

  it("condition is a Collection-only field: refused on the wishlist, accepted in the collection", async () => {
    await seed("u1", [{ id: 1, day: 1 }, { id: 2, day: 2, list: "collection" }]);
    expect(await updateItem(db, "u1", 1, { conditionMedia: "NM" })).toEqual({ ok: false, error: "condition_collection_only" });
    expect(await updateItem(db, "u1", 2, { conditionMedia: "NM", conditionSleeve: "VG+" })).toMatchObject({
      ok: true,
      item: { conditionMedia: "NM", conditionSleeve: "VG+" },
    });
    expect(await updateItem(db, "u1", 1, { notes: "x" })).toMatchObject({ ok: true }); // notes are fine on the wishlist
    expect((await db.select().from(userItems).where(eq(userItems.discogsReleaseId, 1)))[0].conditionMedia).toBeNull();
  });

  it("clears a single grade with null and leaves the other alone", async () => {
    await seed("u1", [{ id: 2, day: 2, list: "collection", media: "NM", sleeve: "VG" }]);
    expect(await updateItem(db, "u1", 2, { conditionSleeve: null })).toMatchObject({ ok: true, item: { conditionMedia: "NM", conditionSleeve: null } });
  });

  it("never exposes a stored value that is not a grade", async () => {
    await seed("u1", [{ id: 2, day: 2, list: "collection", media: "mint-ish" }]);
    expect(toStoredJson((await db.select().from(userItems))[0]).conditionMedia).toBeNull();
  });

  it("another user's item, or one that does not exist, is not found and stays untouched", async () => {
    await seed("u2", [{ id: 1, day: 1 }]);
    expect(await updateItem(db, "u1", 1, { notes: "mine now" })).toEqual({ ok: false, error: "not_found" });
    expect(await updateItem(db, "u1", 404, { notes: "x" })).toEqual({ ok: false, error: "not_found" });
    expect((await db.select().from(userItems))[0].notes).toBeNull();
  });

  it("keeps the grades when the item is moved to the wishlist, and they are back after moving to the collection again", async () => {
    await seed("u1", [{ id: 2, day: 2, list: "collection", media: "NM", sleeve: "VG+" }]);
    await setItemList(db, "u1", 2, "wishlist");
    expect(toStoredJson((await db.select().from(userItems))[0])).toMatchObject({ list: "wishlist", conditionMedia: "NM", conditionSleeve: "VG+" });
    await setItemList(db, "u1", 2, "collection");
    expect(toStoredJson((await db.select().from(userItems))[0])).toMatchObject({ list: "collection", conditionMedia: "NM" });
  });
});

describe("export", () => {
  it("exports only the user's own fields, oldest first, and nobody else's rows", async () => {
    await seed("u1", [{ id: 2, day: 2, notes: "b" }, { id: 1, day: 1, list: "collection", media: "M", sleeve: "NM" }]);
    await seed("u2", [{ id: 3, day: 1, notes: "secret of another user" }]);
    const all = await allItems(db, "u1");
    expect(all.map((i) => i.releaseId)).toEqual([1, 2]);

    const csv = toCsv(all);
    expect(csv.split("\r\n")[0]).toBe("discogs_release_id,list,notes,condition_media,condition_sleeve,added_at,updated_at");
    expect(csv).not.toContain("another user");

    const json = JSON.parse(toJson(all, new Date("2026-02-01T00:00:00Z")));
    expect(json.exportedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(json.columns).toEqual([...EXPORT_COLUMNS]);
    for (const row of json.items) expect(Object.keys(row).sort()).toEqual([...EXPORT_COLUMNS].sort()); // a whitelist: no title, artist, cover ...
    expect(json.items[0]).toMatchObject({ discogs_release_id: 1, list: "collection", condition_media: "M" });
  });

  it("quotes commas, quotes and newlines (RFC 4180) and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const bad of ["+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell(951004)).toBe("951004"); // numbers are never prefixed
    expect(csvCell(null)).toBe("");
  });

  it("an empty list still exports a header row, and CSV rows end in CRLF", async () => {
    expect(toCsv([])).toBe("discogs_release_id,list,notes,condition_media,condition_sleeve,added_at,updated_at\r\n");
    await seed("u1", [{ id: 1, day: 1, notes: "a" }]);
    expect(toCsv(await allItems(db, "u1")).endsWith("\r\n")).toBe(true);
  });
});

describe("cascade, with the new fields", () => {
  it("deleting the account removes items with notes and grades too, and nothing of other users", async () => {
    await seed("u1", [{ id: 1, day: 1, list: "collection", notes: "n", media: "NM", sleeve: "NM" }]);
    await seed("u2", [{ id: 1, day: 1, notes: "keep" }]);
    await db.delete(user).where(eq(user.id, "u1"));
    const left = await db.select().from(userItems);
    expect(left).toHaveLength(1);
    expect(left[0].notes).toBe("keep");
  });
});

describe("shared rules", () => {
  it("knows its lists, grades, page sizes and sorts, and the condition sort is collection-only", () => {
    expect(isListName("wishlist") && isListName("collection") && !isListName("favourites")).toBe(true);
    expect(otherList("wishlist")).toBe("collection");
    expect(CONDITIONS[0]).toBe("M");
    expect(isCondition("VG+") && !isCondition("vg+") && !isCondition("Mint")).toBe(true);
    expect([...PAGE_SIZES]).toEqual([12, 24]);
    expect(sortAllowed("wishlist", "condition")).toBe(false);
    expect(sortAllowed("collection", "condition") && sortAllowed("wishlist", "notes")).toBe(true);
  });
});
