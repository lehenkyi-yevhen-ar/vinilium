import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  CONDITIONS,
  DEFAULT_PAGE_SIZE,
  isCondition,
  isListName,
  isPageSize,
  LISTS,
  NOTES_MAX,
  sortAllowed,
  type Condition,
  type ListName,
  type ListPageJson,
  type PageSize,
  type SortDir,
  type SortKey,
  type StoredItemJson,
} from "@/lib/lists/rules";
import { userItems } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";

/**
 * A user's own list data. Holds only the Discogs release ID plus the user's own fields: no Discogs content,
 * so nothing here is subject to the 6-hour rule. ONE LIST PER PRESSING: a release is either on the wishlist
 * or in the collection (UNIQUE user_id + discogs_release_id), so "Move" is a single UPDATE.
 */

export { LISTS, isListName, type ListName };

/** Guards against runaway scripts, not real collections. */
export const MAX_ITEMS_PER_USER = 10_000;

export interface ListItem {
  releaseId: number;
  list: ListName;
  addedAt: Date;
}

const toItem = (r: typeof userItems.$inferSelect): ListItem => ({
  releaseId: r.discogsReleaseId,
  list: r.list as ListName,
  addedAt: r.addedAt,
});

export const toStoredJson = (r: typeof userItems.$inferSelect): StoredItemJson => ({
  releaseId: r.discogsReleaseId,
  list: r.list as ListName,
  notes: r.notes,
  conditionMedia: isCondition(r.conditionMedia) ? r.conditionMedia : null,
  conditionSleeve: isCondition(r.conditionSleeve) ? r.conditionSleeve : null,
  addedAt: r.addedAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function getItem(db: AppDb, userId: string, releaseId: number): Promise<ListItem | null> {
  const [row] = await db
    .select()
    .from(userItems)
    .where(and(eq(userItems.userId, userId), eq(userItems.discogsReleaseId, releaseId)));
  return row ? toItem(row) : null;
}

export type SetResult =
  | { ok: true; result: "added" | "moved" | "unchanged"; item: ListItem }
  | { ok: false; error: "limit_reached" };

/** Put a pressing on a list. Already on the other list = move (one UPDATE); already on this list = no change. */
export async function setItemList(db: AppDb, userId: string, releaseId: number, list: ListName, now = new Date()): Promise<SetResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userItems)
      .where(and(eq(userItems.userId, userId), eq(userItems.discogsReleaseId, releaseId)))
      .for("update");

    if (existing) {
      if (existing.list === list) return { ok: true, result: "unchanged", item: toItem(existing) } as const;
      // Notes and condition stay with the item: moving to the Wishlist hides the condition (it is a Collection-only field)
      // but does not erase it, so a move back loses nothing.
      const [moved] = await tx.update(userItems).set({ list, updatedAt: now }).where(eq(userItems.id, existing.id)).returning();
      return { ok: true, result: "moved", item: toItem(moved) } as const;
    }

    const [{ n }] = await tx.select({ n: count() }).from(userItems).where(eq(userItems.userId, userId));
    if (n >= MAX_ITEMS_PER_USER) return { ok: false, error: "limit_reached" } as const;

    // ON CONFLICT covers two requests racing to add the same pressing.
    const [inserted] = await tx
      .insert(userItems)
      .values({ userId, discogsReleaseId: releaseId, list, addedAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [userItems.userId, userItems.discogsReleaseId], set: { list, updatedAt: now } })
      .returning();
    return { ok: true, result: "added", item: toItem(inserted) } as const;
  });
}

export async function removeItem(db: AppDb, userId: string, releaseId: number): Promise<boolean> {
  const rows = await db
    .delete(userItems)
    .where(and(eq(userItems.userId, userId), eq(userItems.discogsReleaseId, releaseId)))
    .returning({ id: userItems.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Editing the user's own fields

export interface ItemPatch {
  /** `null` or blank clears the notes. */
  notes?: string | null;
  conditionMedia?: Condition | null;
  conditionSleeve?: Condition | null;
}

export type UpdateResult =
  | { ok: true; item: StoredItemJson }
  | { ok: false; error: "not_found" | "condition_collection_only" | "notes_too_long" };

/** Control characters (except newline and tab) have no place in a note. */
export const cleanNotes = (value: string): string | null => {
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim();
  return s === "" ? null : s;
};

/** Edit notes (any list) and condition (Collection only). Returns the stored item as the screen shows it. */
export async function updateItem(db: AppDb, userId: string, releaseId: number, patch: ItemPatch, now = new Date()): Promise<UpdateResult> {
  const [existing] = await db
    .select()
    .from(userItems)
    .where(and(eq(userItems.userId, userId), eq(userItems.discogsReleaseId, releaseId)));
  if (!existing) return { ok: false, error: "not_found" };

  const set: Partial<typeof userItems.$inferInsert> = { updatedAt: now };
  if (patch.notes !== undefined) {
    const notes = patch.notes === null ? null : cleanNotes(patch.notes);
    if (notes !== null && notes.length > NOTES_MAX) return { ok: false, error: "notes_too_long" };
    set.notes = notes;
  }
  const touchesCondition = patch.conditionMedia !== undefined || patch.conditionSleeve !== undefined;
  if (touchesCondition) {
    if (existing.list !== "collection") return { ok: false, error: "condition_collection_only" };
    if (patch.conditionMedia !== undefined) set.conditionMedia = patch.conditionMedia;
    if (patch.conditionSleeve !== undefined) set.conditionSleeve = patch.conditionSleeve;
  }
  const [row] = await db.update(userItems).set(set).where(eq(userItems.id, existing.id)).returning();
  return { ok: true, item: toStoredJson(row) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Listing: pagination, sort and search, on STORED fields only

export interface ListQuery {
  list: ListName;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

/** `%` `_` and `\` in what the user typed are text, not wildcards. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Lower rank = better condition; no grade sorts after every grade. */
const conditionRank = (col: AnyColumn) =>
  sql<number>`case ${col} ${sql.join(
    CONDITIONS.map((c, i) => sql`when ${c} then ${i + 1}`),
    sql` `,
  )} else 99 end`;

export async function queryItems(db: AppDb, userId: string, query: ListQuery): Promise<ListPageJson> {
  const pageSize: PageSize = isPageSize(query.pageSize) ? query.pageSize : DEFAULT_PAGE_SIZE;
  const q = (query.q ?? "").trim().slice(0, 100);
  const sort: SortKey = query.sort && sortAllowed(query.list, query.sort) ? query.sort : "added";
  const dir: SortDir = query.dir === "asc" ? "asc" : "desc";

  const mine = and(eq(userItems.userId, userId), eq(userItems.list, query.list));
  const search: SQL | undefined = q
    ? or(
        ilike(userItems.notes, `%${escapeLike(q)}%`),
        // typing a grade ("vg+", "NM") finds items graded that, on media or sleeve (Collection items only carry grades)
        ...(isCondition(q.toUpperCase()) ? [eq(userItems.conditionMedia, q.toUpperCase()), eq(userItems.conditionSleeve, q.toUpperCase())] : []),
      )
    : undefined;
  const where = and(mine, search);

  const [{ n: total }] = await db.select({ n: count() }).from(userItems).where(where);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pages);

  const order =
    sort === "notes"
      ? [dir === "asc" ? sql`lower(${userItems.notes}) asc nulls last` : sql`lower(${userItems.notes}) desc nulls last`]
      : sort === "condition"
        ? // "asc" = best first
          [
            dir === "asc" ? asc(conditionRank(userItems.conditionMedia)) : desc(conditionRank(userItems.conditionMedia)),
            dir === "asc" ? asc(conditionRank(userItems.conditionSleeve)) : desc(conditionRank(userItems.conditionSleeve)),
          ]
        : [dir === "asc" ? asc(userItems.addedAt) : desc(userItems.addedAt)];

  const rows = await db
    .select()
    .from(userItems)
    .where(where)
    .orderBy(...order, desc(userItems.id)) // a stable tiebreak, so pages never repeat or skip an item
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRows = await db
    .select({ list: userItems.list, n: count() })
    .from(userItems)
    .where(eq(userItems.userId, userId))
    .groupBy(userItems.list);
  const counts = { wishlist: 0, collection: 0 } as Record<ListName, number>;
  for (const c of countRows) if (isListName(c.list)) counts[c.list] = c.n;

  return { list: query.list, items: rows.map(toStoredJson), total, page, pages, pageSize, counts, q, sort, dir };
}

/** Everything the user has stored, oldest first: for the export. */
export async function allItems(db: AppDb, userId: string): Promise<StoredItemJson[]> {
  const rows = await db.select().from(userItems).where(eq(userItems.userId, userId)).orderBy(asc(userItems.addedAt), asc(userItems.id));
  return rows.map(toStoredJson);
}
