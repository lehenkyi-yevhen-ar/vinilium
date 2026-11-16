import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next.js keeps secrets in .env.local; fall back to .env.
config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
