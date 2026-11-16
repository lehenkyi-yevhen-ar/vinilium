/** Drizzle Studio on the guarded target. `npm run db:studio` (dev) or `npm run db:studio -- --production`. */
import { spawn } from "node:child_process";
import { guardDatabase } from "./lib/db-guard";

guardDatabase({ purpose: "Open Drizzle Studio", allowProduction: true }).then((target) => {
  const child = spawn("npx", ["drizzle-kit", "studio"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DRIZZLE_TARGET_CONFIRMED: target.host },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
});
