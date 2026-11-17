import "server-only";
import { resolveDatabase, type DbTarget } from "@/lib/database-target";

let cached: DbTarget | undefined;

/**
 * The database this process uses: DATABASE_URL (production) when NODE_ENV=production, otherwise DEV_DATABASE_URL.
 * There is no fallback: a development or test process without DEV_DATABASE_URL refuses to run. Throws a readable error
 * (naming the variable, never its value) if it is missing or malformed.
 */
export function databaseTarget(): DbTarget {
  return (cached ??= resolveDatabase(process.env));
}
