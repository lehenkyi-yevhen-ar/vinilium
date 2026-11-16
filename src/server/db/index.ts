import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { databaseTarget } from "./target";
import * as schema from "./schema";

/**
 * Neon serverless driver over WebSockets (Pool). We need a Pool rather than the HTTP driver
 * because Better Auth and our list operations use transactions. Node 22+ has a global
 * WebSocket, so no `ws` polyfill is required on Vercel.
 *
 * Created lazily and cached on globalThis so dev hot-reloads don't leak pools.
 */
const g = globalThis as unknown as { __vinilium_db?: ReturnType<typeof create> };

function create() {
  const pool = new Pool({ connectionString: databaseTarget().url });
  return drizzle(pool, { schema });
}

export function getDb() {
  return (g.__vinilium_db ??= create());
}

export type Db = ReturnType<typeof getDb>;
export { schema };
