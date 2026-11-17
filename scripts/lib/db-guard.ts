import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { describeTarget, DatabaseConfigError, evaluateGuard, planGuard, resolveDatabase, type DbTarget } from "../../src/lib/database-target";

/** Same files and order Next.js uses for local development. */
export function loadEnvFiles() {
  config({ path: ".env.local", quiet: true });
  config({ quiet: true });
}

/** Best effort: the Neon branch id, if the server exposes it. Failure is fine (a label can be set instead). */
async function detectBranch(target: DbTarget): Promise<string | null> {
  const pool = new Pool({ connectionString: target.url });
  try {
    const { rows } = await pool.query("select current_setting('neon.branch_id', true) as id");
    return rows[0]?.id ? `id ${rows[0].id}` : null;
  } catch {
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Run FIRST in any script that touches a database. Prints the target (host and database, never the password), then either
 * returns it or exits with a non-zero status. See evaluateGuard for the rule.
 */
export async function guardDatabase(opts: { purpose: string; allowProduction: boolean }): Promise<DbTarget> {
  loadEnvFiles();
  const plan = planGuard(process.env, process.argv.slice(2), opts);
  if (plan.nodeEnv === null) {
    console.error(`\n${plan.refusal}\n`);
    process.exit(1);
  }
  let target: DbTarget;
  try {
    target = resolveDatabase({ ...process.env, NODE_ENV: plan.nodeEnv });
  } catch (e) {
    console.error(`\n${e instanceof DatabaseConfigError ? e.message : "Could not choose a database."}\n`);
    process.exit(1);
  }
  console.log(`\n${opts.purpose}`);
  for (const line of describeTarget(target)) console.log(line);

  // Decide BEFORE connecting: a refused run must not touch the database at all, not even to read a setting.
  const decision = evaluateGuard(target, { ...opts, argv: process.argv.slice(2) });
  if (!decision.allowed) {
    console.error(`\n${decision.message}\n`);
    process.exit(1);
  }
  if (decision.message) console.warn(`\n${decision.message}\n`);

  // Allowed: if no label was configured, show the Neon branch id when the server exposes it.
  if (!target.branchLabel) {
    const detected = await detectBranch(target);
    if (detected) console.log(`  branch   : ${detected}`);
  }
  return target;
}
