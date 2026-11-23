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
    // fail fast with a named stage BEFORE the migration, and show what failed
    expect(e2e.indexOf("scripts/ci-db-probe.ts")).toBeGreaterThan(-1);
    expect(e2e.indexOf("scripts/ci-db-probe.ts")).toBeLessThan(e2e.indexOf("npm run db:migrate"));
    expect(e2e).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(e2e).toMatch(/docker logs/);
    expect(e2e).toMatch(/NEON_WS_PROXY: 127\.0\.0\.1:5433\/v1/);
    expect(e2e).toMatch(/if:\s*failure\(\)/);
  });
});

describe("gitleaks configuration", () => {
  const toml = readFileSync(path.join(ROOT, ".gitleaks.toml"), "utf8");
  const ignore = readFileSync(path.join(ROOT, ".gitleaksignore"), "utf8");
  const scan = readFileSync(path.join(WORKFLOWS, "secret-scan.yml"), "utf8");

  it("extends the default rules and ignores nothing by path, rule or pattern", () => {
    expect(toml).toMatch(/useDefault\s*=\s*true/);
    const active = toml.split(/\r?\n/).filter((l) => !l.trim().startsWith("#"));
    expect(active.join("\n")).not.toMatch(/\[allowlist|\[\[allowlists|paths\s*=|regexes\s*=|stopwords|commits\s*=/);
  });

  it("every exception is one exact fingerprint (full 40-character commit, path, rule, line), with its reason above it", () => {
    const entries = ignore.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e, e).toMatch(/^[0-9a-f]{40}:[^:*?\s]+:[a-z0-9-]+:\d+$/);
    expect(ignore.split(/\r?\n/).filter((l) => l.startsWith("#")).length).toBeGreaterThan(3);
  });

  it("the workflow uses the config, scans the whole history outside pull requests, and verifies the binary it downloads", () => {
    expect(scan).toContain("GITLEAKS_CONFIG: .gitleaks.toml");
    expect(scan).toContain("--config .gitleaks.toml");
    expect(scan).toMatch(/fetch-depth:\s*0/);
    expect(scan).toMatch(/full-history:[\s\S]*?github\.event_name != 'pull_request'/);
    expect(scan).toMatch(/GITLEAKS_SHA256:\s*[0-9a-f]{64}/);
    expect(scan).toMatch(/sha256sum --check --strict/);
  });
});

describe("no fixture looks like a real key (gitleaks flags high-entropy literals next to SECRET, KEY, TOKEN)", () => {
  it("the secrets used by the tests come from tests/helpers/fake-secrets.ts, built from repeated characters", () => {
    const fake = readFileSync(path.join(ROOT, "tests/helpers/fake-secrets.ts"), "utf8");
    expect(fake).toMatch(/repeat\(/);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !full.endsWith("ci-supply-chain.test.ts")) {
          const text = readFileSync(full, "utf8");
          for (const m of text.matchAll(/(SECRET|API_KEY|TOKEN)[A-Z_]*["']?\s*[:=]\s*["']([^"']{16,})["']/g)) {
            const value = m[2];
            // a value that says FAKE is a deliberately key-shaped fake used to test redaction (tests/unit/email-providers.test.ts)
            if (new Set(value).size >= 10 && !/\s|\$\{|FAKE/.test(value)) offenders.push(`${path.relative(ROOT, full)}: ${m[1]}…`);
          }
        }
      }
    };
    walk(path.join(ROOT, "tests"));
    expect(offenders).toEqual([]);
  });
});

describe(".github/dependabot.yml", () => {
  const text = readFileSync(path.join(ROOT, ".github/dependabot.yml"), "utf8");

  it("updates npm and GitHub Actions monthly, grouped, with a cooldown of at least 14 days", () => {
    for (const eco of ["npm", "github-actions"]) expect(text).toContain(`package-ecosystem: ${eco}`);
    expect([...text.matchAll(/interval:\s*(\w+)/g)].map((m) => m[1])).toEqual(["monthly", "monthly"]);
    const days = [...text.matchAll(/default-days:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(days).toHaveLength(2);
    for (const d of days) expect(d).toBeGreaterThanOrEqual(14);
    expect([...text.matchAll(/update-types:\s*\[minor, patch\]/g)]).toHaveLength(2);
  });

  it("keeps a major update out of every group and limits the open pull requests", () => {
    // A group lists only [minor, patch]: a major is never grouped, so it can never ride along with a routine bump.
    // (the `ignore` entry for @types/node writes its update-types quoted, "version-update:semver-major": that is not a group.)
    expect(text).not.toMatch(/update-types:\s*\[[^"\]]*major/);
    expect([...text.matchAll(/^\s+update-types:\s*\[[^"\]]*\]/gm)]).toHaveLength(2);
    const limits = [...text.matchAll(/open-pull-requests-limit:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(limits).toHaveLength(2);
    for (const n of limits) expect(n).toBeLessThanOrEqual(3);
  });

  it("holds @types/node on the Node.js major we run (a major bump of the types is a separate, explained change)", () => {
    expect(text).toMatch(/dependency-name:\s*"@types\/node"\s+update-types:\s*\["version-update:semver-major"\]/);
  });

  it("keeps the labels and the commit-message prefixes", () => {
    expect([...text.matchAll(/prefix:\s*"(\w+)"/g)].map((m) => m[1])).toEqual(["deps", "ci"]);
    expect([...text.matchAll(/labels:\s*\[(\w+)\]/g)].map((m) => m[1])).toEqual(["dependencies", "dependencies"]);
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
