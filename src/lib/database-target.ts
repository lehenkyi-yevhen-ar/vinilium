/**
 * Which database a process talks to, and whether that is allowed. Pure (no I/O, no server-only import), so the app, the
 * scripts, drizzle.config.ts, Playwright and the unit tests all share ONE rule.
 *
 *   production runtime (NODE_ENV=production) : DATABASE_URL
 *   development and test                      : DEV_DATABASE_URL, and ONLY that. If it is not set the process refuses to
 *                                               start or run: there is NO fallback to DATABASE_URL.
 *
 * DATABASE_URL is, by definition, the PRODUCTION database, and a development or test process can never reach it by accident.
 * A deliberate production run (a migration) passes DATABASE_URL for that one command plus --production (see planGuard).
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

/** Choose the database for this process. `env.NODE_ENV` decides production vs development/test. No fallback. */
export function resolveDatabase(env: Env): DbTarget {
  const production = env.NODE_ENV === "production";
  const prodUrl = clean(env.DATABASE_URL);
  const devUrl = clean(env.DEV_DATABASE_URL);

  const source: DbSource = production ? "DATABASE_URL" : "DEV_DATABASE_URL";
  const url = production ? prodUrl : devUrl;
  if (!url) {
    throw new DatabaseConfigError(
      production
        ? "DATABASE_URL is not set (production runtime)."
        : "DEV_DATABASE_URL is not set. Development and tests never use DATABASE_URL (production): add the connection string of your Neon dev branch as DEV_DATABASE_URL in .env.local.",
    );
  }
  const parsed = parseDbUrl(source, url);
  const prodHost = prodUrl ? safeHost(prodUrl) : null;
  const sameServer = prodHost !== null && prodHost === parsed.host;

  return {
    url,
    source,
    ...parsed,
    branchLabel: clean(production ? env.DATABASE_BRANCH : env.DEV_DATABASE_BRANCH) ?? null,
    // Production when it is the production variable, or when the dev variable points at the production server.
    isProduction: production || sameServer,
    devPointsAtProduction: !production && sameServer,
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

export interface GuardPlan {
  /** NODE_ENV to resolve the database with, or null when the command must refuse right away. */
  nodeEnv: "development" | "production" | null;
  refusal?: string;
}

/**
 * How a script picks its target from its arguments. Without `--production` it is ALWAYS the dev database. With it, and only
 * if the command allows production at all, it is the production database: DATABASE_URL, which a local .env.local does not
 * contain, so it has to be passed for that one command.
 */
export function planGuard(env: Env, argv: readonly string[], opts: { purpose: string; allowProduction: boolean }): GuardPlan {
  const wantsProduction = argv.includes("--production") || env.NODE_ENV === "production";
  if (!wantsProduction) return { nodeEnv: "development" };
  if (!opts.allowProduction) {
    return { nodeEnv: null, refusal: `Refusing to run "${opts.purpose}" against the PRODUCTION database. This command never touches production, with or without a flag.` };
  }
  return { nodeEnv: "production" };
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
        (target.source === "DATABASE_URL" ? "Use DEV_DATABASE_URL (your dev branch) instead." : "Fix DEV_DATABASE_URL: it points at production."),
    };
  }
  if (!opts.argv.includes("--production")) {
    return {
      allowed: false,
      message:
        `Refusing to run "${opts.purpose}" against the PRODUCTION database without --production.\n` +
        "To really target production, pass --production AND DATABASE_URL for that one command (see the README).",
    };
  }
  return { allowed: true, message: `!!! --production given: "${opts.purpose}" will run against the PRODUCTION database. !!!` };
}
