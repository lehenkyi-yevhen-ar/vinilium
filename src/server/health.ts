import "server-only";
import { sql } from "drizzle-orm";
import pkg from "../../package.json";
import type { AppDb } from "@/server/db/types";

/**
 * What /api/health reports, for an uptime monitor: the app version and whether the database answers. Nothing else: no environment, no
 * secret, no person, no Discogs call (a monitor must never spend the shared Discogs budget). The database check is a `select 1`, bounded
 * by a timeout, and its result is remembered for a short while so that a monitor (or an attacker) polling it cannot turn it into a steady
 * stream of queries, nor keep a scale-to-zero database awake more than necessary.
 */

export const HEALTH_CACHE_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 3_000;

export interface Health {
  status: "ok" | "degraded";
  version: string;
  db: "up" | "down";
}

let remembered: { at: number; up: boolean } | null = null;
export const resetHealthMemory = () => {
  remembered = null;
};

export async function checkHealth(db: Pick<AppDb, "execute">, opts: { now?: number; timeoutMs?: number } = {}): Promise<Health> {
  const now = opts.now ?? Date.now();
  let up: boolean;
  if (remembered && now - remembered.at < HEALTH_CACHE_MS) {
    up = remembered.up;
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), opts.timeoutMs ?? HEALTH_TIMEOUT_MS);
        }),
      ]);
      up = true;
    } catch {
      up = false; // the reason is deliberately not reported or logged: it could carry connection details
    } finally {
      clearTimeout(timer);
    }
    remembered = { at: now, up };
  }
  return { status: up ? "ok" : "degraded", version: pkg.version, db: up ? "up" : "down" };
}
