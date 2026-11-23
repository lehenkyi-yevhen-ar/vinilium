/**
 * Production smoke test. YOU run it (the agent never does): anonymous, read-only HTTP checks of the deployed site. No sign-in, no account,
 * no email, no secret, no environment file. About 30 GET requests and at most 10 POSTs to the sign-in endpoint with an address that cannot exist,
 * to see the limiter answer 429 (it leaves one limiter counter row that expires within a minute; see scripts/lib/smoke-prod.ts).
 *
 *   npx tsx scripts/smoke-prod.ts                                   the production site, report-only CSP expected or not: just reported
 *   npx tsx scripts/smoke-prod.ts --expect-csp report-only          fail unless the CSP is in report-only mode
 *   npx tsx scripts/smoke-prod.ts --expect-csp enforce --expect-hsts   after the rollout in docs/LAUNCH.md
 *   npx tsx scripts/smoke-prod.ts --base http://localhost:3000      a local production build
 *   npx tsx scripts/smoke-prod.ts --no-rate-limit-check             skip the (at most 10) sign-in POSTs
 *   --allow-other-host                                              test an address other than production/localhost
 *
 * Exit code 0 = every check passed (warnings and info lines do not fail it), 1 = at least one check failed, 2 = bad arguments.
 */
import { DEFAULT_BASE, formatReport, parseBase, runSmoke, SmokeTargetError } from "./lib/smoke-prod";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  let base: string;
  try {
    base = parseBase(arg("--base") ?? DEFAULT_BASE, has("--allow-other-host"));
  } catch (e) {
    console.error(e instanceof SmokeTargetError ? e.message : "bad --base");
    process.exit(2);
  }
  const csp = arg("--expect-csp");
  if (csp !== undefined && csp !== "enforce" && csp !== "report-only") {
    console.error('--expect-csp must be "enforce" or "report-only"');
    process.exit(2);
  }
  const report = await runSmoke({
    base,
    expectCsp: csp,
    expectHsts: has("--expect-hsts"),
    rateLimitCheck: !has("--no-rate-limit-check"),
  });
  console.log(formatReport(base, report));
  process.exit(report.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "smoke test crashed");
  process.exit(1);
});
