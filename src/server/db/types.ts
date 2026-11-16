import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Any Drizzle Postgres database over our schema: the Neon driver in the app, PGlite in unit tests. */
export type AppDb = PgDatabase<any, typeof schema>; // eslint-disable-line @typescript-eslint/no-explicit-any
