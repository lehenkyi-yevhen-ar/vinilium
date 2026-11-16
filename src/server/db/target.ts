import "server-only";
import { resolveDatabase, type DbTarget } from "@/lib/database-target";

let cached: DbTarget | undefined;

/**
 * The database this process uses: DATABASE_URL (production) when NODE_ENV=production, otherwise DEV_DATABASE_URL if set.
 * Throws a readable error (naming the variable, never its value) if it is missing or malformed.
 */
export function databaseTarget(): DbTarget {
  if (cached) return cached;
  const target = resolveDatabase(process.env);
  if (target.isProduction && process.env.NODE_ENV !== "production") {
    // Not an error (it used to be the only way), but a local server writing to production deserves noise.
    console.warn(
      "[db] WARNING: this is NOT a production runtime but it is using the PRODUCTION database (DATABASE_URL). " +
        "Set DEV_DATABASE_URL in .env.local to use your dev branch.",
    );
  }
  cached = target;
  return target;
}
