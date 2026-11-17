import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseConfigError, describeTarget, evaluateGuard, parseDbUrl, planGuard, resolveDatabase } from "@/lib/database-target";
import { e2eDatabaseUrl } from "../helpers/e2e-db";

// Fake, obviously-not-real values. The password is distinctive so a leak would be caught.
const PW = "s3cr3t-Pa55w0rd";
const PROD = `postgresql://prod_owner:${PW}@ep-prod-1234-pooler.eu-central-1.aws.neon.tech/proddb?sslmode=require`;
const DEV = `postgresql://dev_owner:${PW}@ep-dev-5678-pooler.eu-central-1.aws.neon.tech/devdb?sslmode=require`;

describe("which database a process uses", () => {
  it("production runtime: DATABASE_URL, even if DEV_DATABASE_URL is set", () => {
    const t = resolveDatabase({ NODE_ENV: "production", DATABASE_URL: PROD, DEV_DATABASE_URL: DEV });
    expect(t).toMatchObject({ source: "DATABASE_URL", host: "ep-prod-1234-pooler.eu-central-1.aws.neon.tech", database: "proddb", isProduction: true });
  });

  it("development and test: DEV_DATABASE_URL, whether or not DATABASE_URL is also present", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      for (const DATABASE_URL of [PROD, undefined]) {
        const t = resolveDatabase({ NODE_ENV, DATABASE_URL, DEV_DATABASE_URL: DEV });
        expect(t, `${NODE_ENV} / prod var ${DATABASE_URL ? "set" : "unset"}`).toMatchObject({ source: "DEV_DATABASE_URL", database: "devdb", isProduction: false, devPointsAtProduction: false, pooled: true });
      }
    }
  });

  it("development and test with NO DEV_DATABASE_URL REFUSE: there is no fallback to DATABASE_URL", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      for (const dev of [undefined, "", "   "]) {
        expect(() => resolveDatabase({ NODE_ENV, DATABASE_URL: PROD, DEV_DATABASE_URL: dev }), `${NODE_ENV} / ${JSON.stringify(dev)}`).toThrow(/^DEV_DATABASE_URL is not set\./);
      }
    }
    // the message says what to do, and never contains a value
    let message = "";
    try {
      resolveDatabase({ NODE_ENV: "development", DATABASE_URL: PROD });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("never use DATABASE_URL");
    expect(message).not.toContain(PW);
    expect(message).not.toContain("prod_owner");
  });

  it("production runtime without DATABASE_URL refuses, naming the variable", () => {
    expect(() => resolveDatabase({ NODE_ENV: "production", DEV_DATABASE_URL: DEV })).toThrow("DATABASE_URL is not set (production runtime).");
  });

  it("a DEV_DATABASE_URL that points at the production server is still treated as production", () => {
    const sameServerOtherDb = PROD.replace("/proddb", "/other");
    const t = resolveDatabase({ NODE_ENV: "development", DATABASE_URL: PROD, DEV_DATABASE_URL: sameServerOtherDb });
    expect(t).toMatchObject({ source: "DEV_DATABASE_URL", isProduction: true, devPointsAtProduction: true });
  });

  it("explains a malformed value without echoing it (the doubled '=' typo)", () => {
    for (const bad of [`=${DEV}`, "not a url", "mysql://u:p@h/db", "postgresql:///nohost"]) {
      let message = "";
      try {
        parseDbUrl("DEV_DATABASE_URL", bad);
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseConfigError);
        message = (e as Error).message;
      }
      expect(message, bad).toMatch(/^DEV_DATABASE_URL /);
      expect(message).not.toContain(PW);
      expect(message).not.toContain("dev_owner");
    }
    expect(() => parseDbUrl("DEV_DATABASE_URL", `=${DEV}`)).toThrow(/remove the extra '='/);
  });

  it("labels the target with an optional branch name", () => {
    const t = resolveDatabase({ NODE_ENV: "development", DEV_DATABASE_URL: DEV, DEV_DATABASE_BRANCH: "dev", DATABASE_BRANCH: "production" });
    expect(t.branchLabel).toBe("dev");
    expect(resolveDatabase({ NODE_ENV: "production", DATABASE_URL: PROD, DATABASE_BRANCH: "production" }).branchLabel).toBe("production");
    expect(resolveDatabase({ NODE_ENV: "development", DEV_DATABASE_URL: DEV }).branchLabel).toBeNull();
  });
});

describe("what is printed before touching a database", () => {
  it("shows host, database and variable: never the user, the password or the connection string", () => {
    const text = describeTarget(resolveDatabase({ NODE_ENV: "development", DEV_DATABASE_URL: DEV, DEV_DATABASE_BRANCH: "dev" })).join("\n");
    expect(text).toContain("ep-dev-5678-pooler.eu-central-1.aws.neon.tech");
    expect(text).toContain("devdb");
    expect(text).toContain("DEV_DATABASE_URL");
    expect(text).toContain("branch   : dev");
    expect(text).toContain("development");
    for (const secret of [PW, "dev_owner", "postgresql://", "sslmode"]) expect(text).not.toContain(secret);
  });

  it("calls production by its name, and tells you how to name an unknown branch", () => {
    const text = describeTarget(resolveDatabase({ NODE_ENV: "production", DATABASE_URL: PROD })).join("\n");
    expect(text).toContain("PRODUCTION");
    expect(text).toContain("DATABASE_BRANCH");
    expect(text).not.toContain(PW);
  });
});

describe("how a script chooses its target (planGuard)", () => {
  const migrate = { purpose: "Apply database migrations", allowProduction: true };
  const smoke = { purpose: "Real-API smoke test", allowProduction: false };

  it("without --production it is always the dev database", () => {
    expect(planGuard({}, [], migrate).nodeEnv).toBe("development");
    expect(planGuard({ NODE_ENV: "development" }, ["--verbose"], smoke).nodeEnv).toBe("development");
  });

  it("--production selects production, but only for commands that may touch it", () => {
    expect(planGuard({}, ["--production"], migrate).nodeEnv).toBe("production");
    const refused = planGuard({}, ["--production"], smoke);
    expect(refused.nodeEnv).toBeNull();
    expect(refused.refusal).toContain("never touches production");
  });

  it("a command run with NODE_ENV=production counts as a production run too", () => {
    expect(planGuard({ NODE_ENV: "production" }, [], migrate).nodeEnv).toBe("production"); // then evaluateGuard demands the flag
    expect(planGuard({ NODE_ENV: "production" }, [], smoke).nodeEnv).toBeNull();
  });
});

describe("the safety guard", () => {
  const dev = resolveDatabase({ NODE_ENV: "development", DEV_DATABASE_URL: DEV });
  const prod = resolveDatabase({ NODE_ENV: "production", DATABASE_URL: PROD });

  it("lets anything run against the dev database", () => {
    expect(evaluateGuard(dev, { purpose: "Apply database migrations", allowProduction: true, argv: [] }).allowed).toBe(true);
    expect(evaluateGuard(dev, { purpose: "Real-API smoke test", allowProduction: false, argv: [] }).allowed).toBe(true);
  });

  it("refuses a migration against production unless --production is given", () => {
    const refused = evaluateGuard(prod, { purpose: "Apply database migrations", allowProduction: true, argv: [] });
    expect(refused.allowed).toBe(false);
    expect(refused.message).toContain("--production");
    expect(refused.message).toContain("DATABASE_URL");

    const confirmed = evaluateGuard(prod, { purpose: "Apply database migrations", allowProduction: true, argv: ["--production"] });
    expect(confirmed.allowed).toBe(true);
    expect(confirmed.message).toContain("PRODUCTION"); // and it says so loudly
  });

  it("NEVER lets e2e, walkthroughs or smoke tests touch production, flag or not", () => {
    for (const argv of [[], ["--production"]]) {
      const d = evaluateGuard(prod, { purpose: "Real-API smoke test", allowProduction: false, argv });
      expect(d.allowed, JSON.stringify(argv)).toBe(false);
      expect(d.message).toContain("never touches production");
    }
  });

  it("refuses when the dev variable secretly points at production", () => {
    const sneaky = resolveDatabase({ NODE_ENV: "development", DATABASE_URL: PROD, DEV_DATABASE_URL: PROD.replace("/proddb", "/other") });
    for (const argv of [[], ["--production"]]) expect(evaluateGuard(sneaky, { purpose: "x", allowProduction: true, argv }).allowed).toBe(false);
  });

  it("messages never contain a secret", () => {
    for (const t of [dev, prod]) {
      for (const argv of [[], ["--production"]]) {
        const d = evaluateGuard(t, { purpose: "Apply database migrations", allowProduction: true, argv });
        expect(d.message).not.toContain(PW);
        expect(d.message).not.toContain("postgresql://");
      }
    }
  });
});

describe("e2e database helper: only the dev database, never DATABASE_URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("REFUSES (does not skip, does not fall back) when DEV_DATABASE_URL is not set, even though DATABASE_URL is", () => {
    vi.stubEnv("DATABASE_URL", PROD);
    vi.stubEnv("DEV_DATABASE_URL", " "); // blank = unset (an empty string cannot be set on Windows)
    expect(() => e2eDatabaseUrl()).toThrow(/e2e refuses to run: DEV_DATABASE_URL is not set/);
  });

  it("returns the dev database, with or without DATABASE_URL present", () => {
    vi.stubEnv("DATABASE_URL", PROD);
    vi.stubEnv("DEV_DATABASE_URL", DEV);
    expect(e2eDatabaseUrl()).toBe(DEV);
    vi.stubEnv("DATABASE_URL", " ");
    expect(e2eDatabaseUrl()).toBe(DEV);
  });

  it("throws if the dev variable points at production, and explains a malformed one without echoing it", () => {
    vi.stubEnv("DATABASE_URL", PROD);
    vi.stubEnv("DEV_DATABASE_URL", PROD.replace("/proddb", "/other"));
    expect(() => e2eDatabaseUrl()).toThrow(/refuses to run/);
    vi.stubEnv("DEV_DATABASE_URL", `=${DEV}`);
    let message = "";
    try {
      e2eDatabaseUrl();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/DEV_DATABASE_URL is not a valid URL/);
    expect(message).not.toContain(PW);
  });
});
