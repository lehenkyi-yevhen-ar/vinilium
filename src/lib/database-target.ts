/**
 * Which database a process talks to, and whether that is allowed. Pure (no I/O, no server-only import), so the app, the
 * scripts, drizzle.config.ts, Playwright and the unit tests all share ONE rule.
 *
 *   production runtime (NODE_ENV=production) : DATABASE_URL
 *   development and test                      : DEV_DATABASE_URL if it is set, otherwise DATABASE_URL
 *
 * DATABASE_URL is, by definition, the PRODUCTION database. Falling back to it in development is kept for convenience,
 * but it is treated as production by every guard, and the app warns loudly.
 *
 * Nothing in this file ever puts a connection string, user name or password into a message or return value that is meant
 * to be printed (`host` and `database` are the only parts shown, by design).
 */

export type DbSource = "DEV_DATABASE_URL" | "DATABASE_URL";

export interface DbTarget {
  /** The full connection string. Pass to a driver; NEVER print. */
  url: string;
  source: DbSource;
  host: string;
  database: string;
  pooled: boolean;
  /** Human label from DEV_DATABASE_BRANCH / DATABASE_BRANCH (optional), e.g. "dev" or "production". */
  branchLabel: string | null;
  /** True when this is (or points at the same server as) DATABASE_URL: the production database. */
  isProduction: boolean;
  /** DEV_DATABASE_URL is set but points at the same server as DATABASE_URL. */
  devPointsAtProduction: boolean;
}

/** Thrown for a missing or malformed variable. The message names the VARIABLE, never its value. */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

export function parseDbUrl(name: string, raw: string): { host: string; database: string; pooled: boolean } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // The hint covers the usual typo (a doubled "=") without echoing any of the value.
    const hint = raw.startsWith("=") ? " It starts with '=': remove the extra '='." : "";
    throw new DatabaseConfigError(`${name} is not a valid URL.${hint}`);
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new DatabaseConfigError(`${name} must start with postgresql://`);
  if (!u.hostname) throw new DatabaseConfigError(`${name} has no host.`);
  return { host: u.hostname.toLowerCase(), database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "(default)", pooled: u.hostname.includes("-pooler") };
}

/** Choose the database for this process. `env.NODE_ENV` decides production vs development/test. */
export function resolveDatabase(env: Env): DbTarget {
  const production = env.NODE_ENV === "production";
  const prodUrl = clean(env.DATABASE_URL);
  const devUrl = clean(env.DEV_DATABASE_URL);

  const source: DbSource = !production && devUrl ? "DEV_DATABASE_URL" : "DATABASE_URL";
  const url = source === "DEV_DATABASE_URL" ? devUrl : prodUrl;
  if (!url) {
    throw new DatabaseConfigError(
      source === "DATABASE_URL" ? "DATABASE_URL is not set." : "DEV_DATABASE_URL is not set.",
    );
  }
  const parsed = parseDbUrl(source, url);
  const prodHost = prodUrl ? safeHost(prodUrl) : null;
  const sameServer = prodHost !== null && prodHost === parsed.host;

  return {
    url,
    source,
    ...parsed,
    branchLabel: clean(source === "DEV_DATABASE_URL" ? env.DEV_DATABASE_BRANCH : env.DATABASE_BRANCH) ?? null,
    isProduction: source === "DATABASE_URL" || sameServer,
    devPointsAtProduction: source === "DEV_DATABASE_URL" && sameServer,
  };
}

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Lines to print before touching a database. Host and database name only: never the user, password or full string. */
export function describeTarget(t: DbTarget, detectedBranch?: string | null): string[] {
  const label = t.isProduction ? "PRODUCTION" : "development";
  return [
    `Database target: ${label}`,
    `  variable : ${t.source}`,
    `  host     : ${t.host}${t.pooled ? " (pooled)" : ""}`,
    `  database : ${t.database}`,
    `  branch   : ${t.branchLabel ?? detectedBranch ?? "unknown (set " + (t.source === "DEV_DATABASE_URL" ? "DEV_DATABASE_BRANCH" : "DATABASE_BRANCH") + " to show a name)"}`,
  ];
}

export interface GuardDecision {
  allowed: boolean;
  /** Printed when not allowed (or as a banner when production was explicitly confirmed). */
  message: string;
}

/**
 * The safety rule. A script that changes data states its `purpose`:
 *  - `allowProduction: true`  -> production needs the explicit `--production` flag (migrations, studio).
 *  - `allowProduction: false` -> production is NEVER allowed, flag or not (e2e, walkthroughs, smoke tests, anything that
 *    creates or deletes test data).
 */
export function evaluateGuard(target: DbTarget, opts: { purpose: string; allowProduction: boolean; argv: readonly string[] }): GuardDecision {
  if (target.devPointsAtProduction) {
    return {
      allowed: false,
      message: `Refusing to run "${opts.purpose}": DEV_DATABASE_URL points at the same server as DATABASE_URL (production). Fix DEV_DATABASE_URL.`,
    };
  }
  if (!target.isProduction) return { allowed: true, message: "" };

  if (!opts.allowProduction) {
    return {
      allowed: false,
      message:
        `Refusing to run "${opts.purpose}" against the PRODUCTION database. This command never touches production, with or without a flag.\n` +
        (target.source === "DATABASE_URL" ? "Set DEV_DATABASE_URL (your dev branch) in .env.local and try again." : ""),
    };
  }
  if (!opts.argv.includes("--production")) {
    return {
      allowed: false,
      message:
        `Refusing to run "${opts.purpose}" against the PRODUCTION database without --production.\n` +
        (target.source === "DATABASE_URL" ? "Did you mean the dev branch? Set DEV_DATABASE_URL in .env.local.\n" : "") +
        "To really target production, pass --production (e.g. npm run db:migrate -- --production).",
    };
  }
  return { allowed: true, message: `!!! --production given: "${opts.purpose}" will run against the PRODUCTION database. !!!` };
}
