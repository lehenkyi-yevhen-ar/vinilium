import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { resolveDatabase } from "./src/lib/database-target";

// Next.js keeps secrets in .env.local; fall back to .env.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

// drizzle-kit connects to whatever this file says, with no safety questions asked. So: the dev database by default, and the
// production host only when a guarded script (scripts/db-*.ts) has confirmed it with --production. A bare
// `npx drizzle-kit migrate` therefore cannot reach production: it gets an address that cannot connect.
const BLOCKED = "postgresql://blocked.invalid/blocked";
let url = BLOCKED;
try {
  const target = resolveDatabase({ ...process.env, NODE_ENV: "development" });
  if (!target.isProduction || process.env.DRIZZLE_TARGET_CONFIRMED === target.host) url = target.url;
  else console.warn("[drizzle.config] production is not confirmed: use `npm run db:migrate -- --production`. Connecting is blocked.");
} catch (e) {
  console.warn(`[drizzle.config] ${e instanceof Error ? e.message : "no database configured"}`);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
