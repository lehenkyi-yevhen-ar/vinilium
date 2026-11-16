import { config } from "dotenv";
import { DatabaseConfigError, resolveDatabase } from "../../src/lib/database-target";

/**
 * The database the e2e run may use. ONLY DEV_DATABASE_URL: e2e creates and deletes users, sessions and cache rows, so it
 * never falls back to DATABASE_URL (production). Returns null (the Discogs / finder tests then skip, loudly) when it is not
 * set, and throws if it somehow resolves to the production server.
 */
export function e2eDatabaseUrl(): string | null {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DEV_DATABASE_URL?.trim()) return null;
  try {
    const target = resolveDatabase({ ...process.env, NODE_ENV: "test" });
    if (target.isProduction) {
      throw new Error("e2e refuses to run: DEV_DATABASE_URL points at the same server as DATABASE_URL (production). Fix DEV_DATABASE_URL.");
    }
    return target.url;
  } catch (e) {
    if (e instanceof DatabaseConfigError) throw new Error(`e2e cannot start: ${e.message}`);
    throw e;
  }
}
