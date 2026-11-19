import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CodeQL's js/incomplete-url-substring-sanitization flags `x.startsWith(<url or host>)`, `.includes`, `.endsWith` and `.indexOf` where the
 * argument is a URL or host (literal OR a constant that holds one). Such a check is wrong for a security decision ("http://discogs.test.evil.example"
 * starts with "http://discogs.test"), and it kept slipping into test helpers: compare parsed values instead, `new URL(x).origin` / `.hostname`
 * against the exact expected one. This walks src, scripts and tests and fails on any such call.
 */
const ROOT = join(__dirname, "..", "..");
// a URL, or a host name that ENDS in a known TLD (so a file name such as "x.test.ts" is not one); an optional leading dot covers ".neon.tech"
const URLISH = /^(https?:\/\/)|^\.?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|test|tech|org|app|io|net|dev|me)(?=$|[/:?#])/i;
const METHODS = "(?:startsWith|endsWith|includes|indexOf|lastIndexOf)";
// groups: 1 the method, 2 the quote, 3 the literal. Allowed: `host.endsWith(".example.com")` on an already parsed hostname (a dot-boundary suffix check).
const LITERAL_ARG = new RegExp(String.raw`\.(${METHODS})\(\s*(["'` + "`" + String.raw`])([^"'` + "`" + String.raw`]*)\2`, "g");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "fixtures"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every call that checks a URL-valued literal or constant with a substring method: "file:line: text". */
function substringUrlChecks(source: string): string[] {
  const found: string[] = [];
  const consts: string[] = [];
  for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(["'`])([^"'`\n$]*)\2/g)) if (URLISH.test(m[3])) consts.push(m[1]);
  source.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(LITERAL_ARG)) if (URLISH.test(m[3]) && !(m[1] === "endsWith" && m[3].startsWith("."))) found.push(`${i + 1}: ${line.trim()}`);
    for (const name of consts) {
      const n = name.replace(/\$/g, String.raw`\$`);
      if (new RegExp(String.raw`\.${METHODS}\(\s*${n}\b`).test(line) || new RegExp(String.raw`\.${METHODS}\(\s*` + "`" + String.raw`\$\{${n}\}`).test(line)) found.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return found;
}

describe("no substring check on a URL or host", () => {
  it("the detector catches the shapes CodeQL flags (and not path checks)", () => {
    expect(substringUrlChecks(`expect(u.startsWith("https://i.discogs.com/")).toBe(true);`)).toHaveLength(1);
    expect(substringUrlChecks(`const BASE = "http://discogs.test";\nexpect(u.startsWith(BASE)).toBe(true);`)).toHaveLength(1);
    expect(substringUrlChecks(`const B = "http://x.test";\nu.startsWith(\`\${B}/api\`);`)).toHaveLength(1);
    expect(substringUrlChecks(`if (host.endsWith("neon.tech")) return;`)).toHaveLength(1);
    expect(substringUrlChecks(`if (host.endsWith(".neon.tech")) return;`)).toHaveLength(0); // dot boundary on a parsed hostname
    expect(substringUrlChecks(`if (host.startsWith(".neon.tech")) return;`)).toHaveLength(1);
    expect(substringUrlChecks(`p.startsWith("/lists"); v.startsWith("//"); name.endsWith("ci-supply-chain.test.ts");`)).toHaveLength(0);
    expect(substringUrlChecks(`const BASE = "http://discogs.test";\nexpect(new URL(u).origin).toBe(new URL(BASE).origin);`)).toHaveLength(0);
  });

  it("src, scripts and tests contain none", () => {
    const offenders: string[] = [];
    for (const dir of ["src", "scripts", "tests"]) {
      for (const file of sources(join(ROOT, dir))) {
        // this file's own examples are the detector's test data
        if (file.endsWith("url-substring-guard.test.ts")) continue;
        for (const hit of substringUrlChecks(readFileSync(file, "utf8"))) offenders.push(`${relative(ROOT, file).replaceAll("\\", "/")}:${hit}`);
      }
    }
    expect(offenders, "compare the parsed origin or hostname exactly instead of a string prefix or suffix").toEqual([]);
  });
});
