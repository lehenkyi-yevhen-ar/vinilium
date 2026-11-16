import "server-only";
import { and, count, eq } from "drizzle-orm";
import { userItems } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";

/**
 * A user's own list data. Holds only the Discogs release ID plus the user's own fields: no Discogs content,
 * so nothing here is subject to the 6-hour rule. ONE LIST PER PRESSING: a release is either on the wishlist
 * or in the collection (UNIQUE user_id + discogs_release_id), so "Move" is a single UPDATE.
 */

export const LISTS = ["wishlist", "collection"] as const;
export type ListName = (typeof LISTS)[number];
export const isListName = (v: unknown): v is ListName => typeof v === "string" && (LISTS as readonly string[]).includes(v);

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
      const [moved] = await tx
        .update(userItems)
        .set({ list, updatedAt: now })
        .where(eq(userItems.id, existing.id))
        .returning();
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
