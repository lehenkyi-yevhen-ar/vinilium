import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The CI files are code too. These checks keep the supply-chain rules from eroding: every GitHub Action pinned to a full commit SHA with
 * its version in a comment, every container image pinned by digest, every workflow with an explicit `permissions:`, Dependabot with a
 * cooldown of at least 14 days, and no secret anywhere in the CI files. Plain text checks (no YAML library is a dependency).
 */

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOWS = path.join(ROOT, ".github/workflows");
const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const read = (f: string) => readFileSync(path.join(WORKFLOWS, f), "utf8");

describe("GitHub workflows", () => {
  it("exist: CI, CodeQL and the secret scan", () => {
    expect(files).toEqual(expect.arrayContaining(["ci.yml", "codeql.yml", "secret-scan.yml"]));
  });

  for (const f of files) {
    describe(f, () => {
      const text = read(f);

      it("pins every action to a full 40-character commit SHA, with the version in a comment", () => {
        const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
        expect(uses.length).toBeGreaterThan(0);
        for (const [, ref, rest] of uses) {
          if (ref.startsWith("./")) continue;
          expect(ref, `${f}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
          expect(rest, `${f}: ${ref} needs a "# vX.Y.Z" comment`).toMatch(/#\s*v\d+(\.\d+)*/);
        }
      });

      it("pins every service container image by digest", () => {
        for (const [, image] of text.matchAll(/^\s*image:\s*(\S+)/gm)) expect(image, `${f}: ${image}`).toMatch(/@sha256:[0-9a-f]{64}$/);
      });

      it("declares minimal permissions at the top level (and never write-all)", () => {
        expect(text).toMatch(/^permissions:/m);
        expect(text).not.toMatch(/permissions:\s*write-all/);
        expect(text).not.toMatch(/^\s*pull_request_target:/m); // runs with secrets on code from forks
      });

      it("does not persist the checkout token and holds no secret", () => {
        const lines = text.split(/\r?\n/);
        lines.forEach((line, i) => {
          if (/uses:\s*actions\/checkout@/.test(line)) expect(lines.slice(i + 1, i + 4).join("\n"), `${f}: checkout must not persist the token`).toMatch(/persist-credentials:\s*false/);
        });
        expect(text).not.toMatch(/\bsecrets\.(?!GITHUB_TOKEN\b)/); // only the automatic token; the e2e job needs none
        expect(text).not.toMatch(/(AKIA[0-9A-Z]{16}|-----BEGIN|xkeysib-|GOCSPX-|ghp_[A-Za-z0-9]{20})/);
      });
    });
  }

  it("the e2e job needs no secrets and never points at a real database or API", () => {
    const ci = read("ci.yml");
    const e2e = ci.slice(ci.indexOf("  e2e:"));
    expect(e2e).not.toMatch(/secrets\./);
    expect(e2e).toContain("DEV_DATABASE_URL: postgresql://postgres:postgres@postgres:5432/");
    expect(e2e).not.toMatch(/\bDATABASE_URL:\s*(?!postgresql:\/\/postgres:postgres@postgres)/m);
    expect(e2e).not.toMatch(/neon\.tech|api\.discogs\.com|api\.brevo\.com/);
    expect(e2e).toMatch(/upload-artifact/);
    expect(e2e).toMatch(/if:\s*failure\(\)/);
  });
});

describe(".github/dependabot.yml", () => {
  const text = readFileSync(path.join(ROOT, ".github/dependabot.yml"), "utf8");

  it("updates npm and GitHub Actions weekly, grouped, with a cooldown of at least 14 days", () => {
    for (const eco of ["npm", "github-actions"]) expect(text).toContain(`package-ecosystem: ${eco}`);
    expect([...text.matchAll(/interval:\s*(\w+)/g)].map((m) => m[1])).toEqual(["weekly", "weekly"]);
    const days = [...text.matchAll(/default-days:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(days).toHaveLength(2);
    for (const d of days) expect(d).toBeGreaterThanOrEqual(14);
    expect([...text.matchAll(/update-types:\s*\[minor, patch\]/g)]).toHaveLength(2);
  });
});

describe("SECURITY.md and CONTRIBUTING.md", () => {
  it("name the contact variable, never an address", () => {
    const security = readFileSync(path.join(ROOT, "SECURITY.md"), "utf8");
    expect(security).toContain("NEXT_PUBLIC_CONTACT_EMAIL");
    for (const f of ["SECURITY.md", "CONTRIBUTING.md"]) {
      const text = readFileSync(path.join(ROOT, f), "utf8");
      expect(text, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });
});
