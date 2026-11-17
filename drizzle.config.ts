import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { resolveDatabase } from "./src/lib/database-target";

// Next.js keeps secrets in .env.local; fall back to .env.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// drizzle-kit connects to whatever this file says, with no safety questions asked. So: the DEV database, or the exact URL a
// guarded script (scripts/db-*.ts) has confirmed and handed over. A bare `npx drizzle-kit migrate` can therefore only ever
// reach the dev database; with no DEV_DATABASE_URL it gets an address that cannot connect.
const BLOCKED = "postgresql://blocked.invalid/blocked";
let url = process.env.DRIZZLE_DATABASE_URL || BLOCKED;
if (url === BLOCKED) {
  try {
    url = resolveDatabase({ ...process.env, NODE_ENV: "development" }).url;
  } catch (e) {
    console.warn(`[drizzle.config] ${e instanceof Error ? e.message : "no database configured"}`);
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
