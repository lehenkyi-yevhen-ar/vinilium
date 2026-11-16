import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";

/**
 * A fresh in-memory Postgres with the REAL migration files applied (so the SQL we ship is what the tests run).
 * No network, no secrets.
 */
export async function createTestDb(): Promise<{ db: AppDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return { db: db as unknown as AppDb, close: () => client.close() };
}
