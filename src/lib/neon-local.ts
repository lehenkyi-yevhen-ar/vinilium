/**
 * Lets the Neon serverless driver (WebSockets) talk to a PLAIN Postgres through Neon's open-source `wsproxy`, which is how the
 * secret-free CI e2e job gets a database without a Neon account (a Postgres service container plus the proxy container).
 *
 * It is inert unless `NEON_WS_PROXY` is set (host:port/v1, for example `localhost:5433/v1`), and it NEVER applies to a real Neon
 * host (`*.neon.tech`), so it cannot redirect a production or dev-branch connection. Pure: it only edits the config object it is
 * given, so it is unit-tested without a database.
 */

export interface NeonConfigLike {
  wsProxy?: unknown;
  useSecureWebSocket?: boolean;
  pipelineTLS?: boolean;
  pipelineConnect?: unknown;
}

const PROXY = /^[a-z0-9.-]+:\d{1,5}\/v1$/i;

/** True when the proxy settings were applied. */
export function applyLocalNeonProxy(config: NeonConfigLike, env: Record<string, string | undefined>, connectionString: string): boolean {
  const proxy = env.NEON_WS_PROXY?.trim();
  if (!proxy || !PROXY.test(proxy)) return false;
  let host: string;
  try {
    host = new URL(connectionString).hostname.toLowerCase();
  } catch {
    return false;
  }
  // A real Neon database is never rerouted. A trailing dot ("x.neon.tech.") names the same host, so it is removed before the comparison.
  let decoded: string;
  try {
    decoded = decodeURIComponent(host); // an opaque host keeps "%2e" as typed; some clients decode it
  } catch {
    return false; // not decodable: not something to guess about
  }
  const bare = decoded.replace(/\.+$/, "");
  if (bare === "neon.tech" || bare.endsWith(".neon.tech")) return false;
  // A STRING: the driver appends ?address=<host>:<port> to it (its CONFIG.md). A function form must build that query itself; the first version
  // returned the bare proxy from a function, so wsproxy never got a target address and refused every connection (the CI e2e failure).
  config.wsProxy = proxy;
  config.useSecureWebSocket = false;
  config.pipelineTLS = false;
  config.pipelineConnect = false;
  return true;
}
