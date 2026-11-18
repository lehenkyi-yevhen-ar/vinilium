import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { advisoriesFrom, evaluate, report, validateAllowlist, type AllowEntry } from "../../scripts/lib/audit-gate";

/** The audit gate: new high/critical advisories fail, reviewed ones pass with a warning, exceptions expire and cannot be blanket. */

const adv = (id: string, severity: string, name = "pkg") => ({ source: 1, name, title: `${id} title`, url: `https://github.com/advisories/${id}`, severity, range: "*" });
const reportOf = (...entries: Array<[string, ReturnType<typeof adv>[]]>) => ({
  vulnerabilities: Object.fromEntries(entries.map(([name, via]) => [name, { name, severity: via[0]?.severity, via }])),
});
const entry = (over: Partial<AllowEntry> = {}): AllowEntry => ({
  id: "GHSA-aaaa-bbbb-cccc",
  package: "pkg",
  justification: "No fixed version exists, and the code path is not reachable from a request in this app.",
  expires: "2026-12-31",
  reviewed: "2026-11-18",
  ...over,
});
const TODAY = "2026-11-18";

describe("advisoriesFrom (the JSON of npm audit)", () => {
  it("lists each advisory once, however many packages reach it, and ignores 'reached through' strings", () => {
    const a = advisoriesFrom(
      reportOf(["picomatch", [adv("GHSA-aaaa-bbbb-cccc", "high", "picomatch")]], ["vitest", [adv("GHSA-aaaa-bbbb-cccc", "high", "picomatch")]], ["esbuild", [adv("GHSA-dddd-eeee-ffff", "moderate", "esbuild")]]),
    );
    expect(a.map((x) => x.id)).toEqual(["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]); // highest severity first
    expect(advisoriesFrom({ vulnerabilities: { a: { via: ["picomatch"] } } })).toEqual([]);
    expect(advisoriesFrom(null)).toEqual([]);
    expect(advisoriesFrom({})).toEqual([]);
  });
});

describe("evaluate", () => {
  const high = advisoriesFrom(reportOf(["picomatch", [adv("GHSA-aaaa-bbbb-cccc", "high", "picomatch")]]));

  it("fails on a high advisory that is not on the allowlist", () => {
    const r = evaluate(high, [], { today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.failures.map((a) => a.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
    expect(report(r).errors[0]).toMatch(/not on the reviewed allowlist/);
  });

  it("fails on a NEW advisory even when another one is allowed", () => {
    const two = advisoriesFrom(reportOf(["a", [adv("GHSA-aaaa-bbbb-cccc", "high")]], ["b", [adv("GHSA-zzzz-yyyy-xxxx", "critical", "b")]]));
    const r = evaluate(two, [entry()], { today: TODAY });
    expect(r.ok).toBe(false);
    expect(r.failures.map((a) => a.id)).toEqual(["GHSA-zzzz-yyyy-xxxx"]);
    expect(r.allowed).toHaveLength(1);
  });

  it("passes on a reviewed, unexpired exception and prints it as a warning with its justification", () => {
    const r = evaluate(high, [entry()], { today: TODAY });
    expect(r.ok).toBe(true);
    const out = report(r);
    expect(out.errors).toEqual([]);
    expect(out.warnings[0]).toMatch(/allowed until 2026-12-31/);
    expect(out.warnings[0]).toMatch(/No fixed version exists/);
  });

  it("an exception expires: valid through its last day, failing the day after, and saying why", () => {
    expect(evaluate(high, [entry()], { today: "2026-12-31" }).ok).toBe(true);
    const r = evaluate(high, [entry()], { today: "2027-01-01" });
    expect(r.ok).toBe(false);
    expect(report(r).errors.join("\n")).toMatch(/expired on 2026-12-31/);
  });

  it("moderate and low advisories are listed but never fail the gate (the threshold is high)", () => {
    const mod = advisoriesFrom(reportOf(["esbuild", [adv("GHSA-dddd-eeee-ffff", "moderate", "esbuild")]]));
    const r = evaluate(mod, [], { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.below).toHaveLength(1);
    expect(evaluate(mod, [], { today: TODAY, threshold: "moderate" }).ok).toBe(false);
  });

  it("an allowlist entry that matches nothing is reported as stale (remove it), not silently kept", () => {
    const r = evaluate([], [entry()], { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.stale.map((e) => e.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
    expect(report(r).warnings[0]).toMatch(/matches no advisory/);
  });

  it("an entry for one advisory never covers another one in the same package", () => {
    const other = advisoriesFrom(reportOf(["picomatch", [adv("GHSA-zzzz-yyyy-xxxx", "high", "picomatch")]]));
    expect(evaluate(other, [entry({ package: "picomatch" })], { today: TODAY }).ok).toBe(false);
  });
});

describe("validateAllowlist: no blanket ignores, a reason, an expiry", () => {
  it.each([
    [{ ...entry(), id: "*" }, /single GHSA advisory id/],
    [{ ...entry(), id: "picomatch" }, /single GHSA advisory id/],
    [{ ...entry(), id: "GHSA-aaaa-bbbb-*" }, /single GHSA advisory id/],
    [{ ...entry(), justification: "ok" }, /justification is required/],
    [{ ...entry(), justification: undefined }, /justification is required/],
    [{ ...entry(), expires: "soon" }, /expires must be YYYY-MM-DD/],
    [{ ...entry(), expires: undefined }, /expires must be YYYY-MM-DD/],
    [{ ...entry(), reviewed: "yesterday" }, /reviewed must be YYYY-MM-DD/],
    [{ ...entry(), expires: "2026-01-01" }, /expires is before reviewed/],
    [{ ...entry(), package: "" }, /package is required/],
  ])("refuses %j", (bad, why) => {
    const r = validateAllowlist([bad]);
    expect(r.entries).toEqual([]);
    expect(r.invalid.join("\n")).toMatch(why);
    expect(evaluate([], [bad], { today: TODAY }).ok).toBe(false); // an invalid allowlist fails the gate, it is not skipped
  });

  it("refuses duplicates and anything that is not an array", () => {
    expect(validateAllowlist([entry(), entry()]).invalid.join()).toMatch(/duplicate/);
    expect(validateAllowlist({ id: "x" }).invalid.join()).toMatch(/must be a JSON array/);
  });
});

describe(".audit-allowlist.json (the real file)", () => {
  const file = JSON.parse(readFileSync(path.resolve(__dirname, "../../.audit-allowlist.json"), "utf8"));
  it("is valid: every entry one advisory, justified, reviewed, with an expiry", () => {
    const r = validateAllowlist(file);
    expect(r.invalid).toEqual([]);
    expect(r.entries.length).toBe(file.length);
    for (const e of r.entries) {
      const days = (Date.parse(e.expires) - Date.parse(e.reviewed)) / 86_400_000;
      expect(days, `${e.id}: an exception should not be valid for more than 90 days`).toBeLessThanOrEqual(90);
    }
  });

  it("package.json runs the gate, never `npm audit fix`", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.scripts["audit:prod"]).toBe("tsx scripts/audit-gate.ts");
    for (const [name, cmd] of Object.entries<string>(pkg.scripts)) expect(cmd, name).not.toMatch(/audit fix/);
  });
});
