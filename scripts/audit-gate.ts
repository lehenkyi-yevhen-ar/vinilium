/**
 * `npm run audit:prod`: `npm audit --omit=dev --json`, then the gate in scripts/lib/audit-gate.ts. Fails on any high or critical advisory that is
 * not on the reviewed, expiring allowlist (.audit-allowlist.json); prints allowed ones as warnings. Never runs `npm audit fix`.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { advisoriesFrom, evaluate, report } from "./lib/audit-gate";

const root = path.resolve(__dirname, "..");
const github = process.env.GITHUB_ACTIONS === "true";

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 32 * 1024 * 1024 });
let json: unknown;
try {
  json = JSON.parse(run.stdout);
} catch {
  console.error("audit-gate: `npm audit --json` did not return JSON (offline, or the registry refused). Output (first 400 characters):");
  console.error(String(run.stdout || run.stderr).slice(0, 400));
  process.exit(2);
}
if ((json as { error?: unknown }).error) {
  console.error("audit-gate: npm audit reported an error:", JSON.stringify((json as { error: unknown }).error).slice(0, 400));
  process.exit(2);
}

let allowlist: unknown = [];
try {
  allowlist = JSON.parse(readFileSync(path.join(root, ".audit-allowlist.json"), "utf8"));
} catch (e) {
  console.error("audit-gate: cannot read .audit-allowlist.json:", e instanceof Error ? e.message : e);
  process.exit(2);
}

const result = evaluate(advisoriesFrom(json), allowlist);
const { lines, warnings, errors } = report(result);
const meta = (json as { metadata?: { vulnerabilities?: Record<string, number> } }).metadata?.vulnerabilities;
console.log(`audit-gate: npm audit --omit=dev found ${meta ? JSON.stringify(meta) : "no summary"}`);
for (const l of lines) console.log("  " + l);
for (const w of warnings) console.log(github ? `::warning title=Allowed advisory::${w}` : `WARNING  ${w}`);
for (const e of errors) console.log(github ? `::error title=Audit gate::${e}` : `ERROR    ${e}`);
if (github && process.env.GITHUB_STEP_SUMMARY) {
  const out = ["### npm audit gate", result.ok ? "No new high or critical advisory." : "**Failed**", ...errors.map((e) => `- :x: ${e}`), ...warnings.map((w) => `- :warning: ${w}`)];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
}
process.exit(result.ok ? 0 : 1);
