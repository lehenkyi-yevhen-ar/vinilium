import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CI e2e run of 2026-11-18 failed in the sign-in setup and the teardown (a bare ErrorEvent) because the test side built its database
 * pool from a DIFFERENT copy of `@neondatabase/serverless` than the one that had received the proxy setting (see tests/helpers/e2e-db.ts).
 * Locally the setting is inert, so nothing showed. These tests keep that from coming back, and keep the browser projects honest.
 */
const ROOT = join(__dirname, "..", "..");

describe("test-side database access", () => {
  it("no spec, setup or teardown builds its own pool or touches neonConfig: everything goes through e2ePool()", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(join(ROOT, "tests", "e2e")).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(ROOT, "tests", "e2e", file), "utf8");
      if (/@neondatabase\/serverless|new Pool\(|neonConfig/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("e2ePool() takes the config and the Pool from the same dynamic import", () => {
    const text = readFileSync(join(ROOT, "tests", "helpers", "e2e-db.ts"), "utf8");
    expect(text).toMatch(/const neon = await import\("@neondatabase\/serverless"\)/);
    expect(text).toMatch(/applyLocalNeonProxy\(neon\.neonConfig,/);
    expect(text).toMatch(/new neon\.Pool\(/);
    // no static import of the driver in the helper: that is the second copy
    expect(text).not.toMatch(/^import[^\n]*@neondatabase\/serverless/m);
  });
});

describe("playwright projects on CI", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.DEV_DATABASE_URL = "postgresql://u:p@localhost:5432/vinilium_e2e";
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  async function projectNames(env: Record<string, string | undefined>): Promise<string[]> {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const config = (await import("../../playwright.config")).default;
    return (config.projects ?? []).map((p) => p.name ?? "");
  }

  it("CI installs Chromium only: no firefox or webkit project unless E2E_EXTRA_BROWSERS=1", async () => {
    const names = await projectNames({ CI: "true", E2E_EXTRA_BROWSERS: undefined });
    expect(names).toContain("setup");
    expect(names).toContain("desktop");
    expect(names).not.toContain("firefox");
    expect(names).not.toContain("webkit");
  });

  it("on a developer machine both are still there, and CI can opt in", async () => {
    expect(await projectNames({ CI: undefined, E2E_EXTRA_BROWSERS: undefined })).toEqual(expect.arrayContaining(["firefox", "webkit"]));
    vi.resetModules();
    expect(await projectNames({ CI: "true", E2E_EXTRA_BROWSERS: "1" })).toEqual(expect.arrayContaining(["firefox", "webkit"]));
  });

  it("the project graph: only the sign-in setup is a dependency (one failing project never hides the others), run by one worker, no cut-off", async () => {
    for (const k of ["CI", "E2E_EXTRA_BROWSERS"]) delete process.env[k];
    const config = (await import("../../playwright.config")).default;
    const projects = config.projects ?? [];
    const names = projects.map((p) => p.name);
    expect(names[0]).toBe("setup"); // listed first: the order of the list is the order they run in
    for (const p of projects) {
      const deps = p.dependencies ?? [];
      expect(deps.every((d) => d === "setup"), `${p.name} depends on ${JSON.stringify(deps)}`).toBe(true);
    }
    // every project that reads the shared session depends on the setup that creates it
    for (const p of projects) {
      const uses = JSON.stringify(p.use ?? {});
      if (uses.includes("tests/.auth/user.json")) expect(p.dependencies, p.name).toContain("setup");
    }
    // the projects share the mock's throttle switch and log, the Discogs bucket and the e2e user's list rows, so they run one after the other
    expect(config.workers).toBe(1);
    expect(config.maxFailures ?? 0).toBe(0);
    expect(config.retries).toBe(0);
    // each project that has a fixed client address has its own (the per-IP limiters never collide)
    const addresses = projects.map((p) => (p.use?.extraHTTPHeaders as Record<string, string> | undefined)?.["x-forwarded-for"]).filter(Boolean);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});
