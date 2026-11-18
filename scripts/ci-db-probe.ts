/**
 * Stage-by-stage check of the CI database path, so a failure names its stage instead of ending in "Failed query":
 *   1. the proxy answers HTTP on its port,
 *   2. a websocket to ws://<NEON_WS_PROXY>?address=<db host>:<db port> opens,
 *   3. Postgres answers an SSLRequest through it.
 * Reads NEON_WS_PROXY and DEV_DATABASE_URL (only the host and port of the URL are used, and never printed with credentials).
 * Retries for about 40 seconds (the service containers may still be starting); exits 1 with a clear message otherwise.
 */
import { buildProbeUrl, interpretSslReply, SSL_REQUEST, stageMessage } from "./lib/ws-probe";

const proxy = process.env.NEON_WS_PROXY ?? "";
const dbUrl = process.env.DEV_DATABASE_URL ?? "";
const TRIES = Number(process.env.PROBE_TRIES ?? 20);
const WAIT_MS = Number(process.env.PROBE_WAIT_MS ?? 2000);

function fail(message: string): never {
  console.error(`::error title=CI database path::${message}`);
  console.error(message);
  process.exit(1);
}

async function http(): Promise<string | null> {
  try {
    const res = await fetch(`http://${proxy.replace(/\/v1$/, "")}/v1`, { signal: AbortSignal.timeout(3000) });
    await res.arrayBuffer().catch(() => {});
    return null; // any HTTP answer (the proxy answers 400 to a plain GET) means it is listening
  } catch (e) {
    return `no HTTP answer from the proxy at ${proxy} (${e instanceof Error ? e.name + ": " + e.message : String(e)})`;
  }
}

function websocket(url: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let opened = false;
    let done = false;
    const finish = (r: { ok: boolean; message: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(r);
    };
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => finish({ ok: false, message: opened ? "Postgres did not answer within 5 seconds" : "the websocket did not open within 5 seconds" }), 5000);
    ws.addEventListener("open", () => {
      opened = true;
      ws.send(SSL_REQUEST);
    });
    ws.addEventListener("message", (m) => finish(interpretSslReply(new Uint8Array(m.data as ArrayBuffer))));
    ws.addEventListener("error", () => finish({ ok: false, message: stageMessage({ opened }) }));
    ws.addEventListener("close", (e) => finish({ ok: false, message: stageMessage({ opened, closeCode: e.code }) }));
  });
}

async function main() {
  if (!proxy) fail("NEON_WS_PROXY is not set: this check is only for the CI job that uses the websocket proxy.");
  let host: string;
  let port: string;
  try {
    const u = new URL(dbUrl);
    host = u.hostname;
    port = u.port || "5432";
  } catch {
    return fail("DEV_DATABASE_URL is not a valid URL.");
  }
  const url = buildProbeUrl(proxy, host, port);
  console.log(`probe: proxy ${proxy}, database host ${host}:${port}`);

  let last = "";
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const httpProblem = await http();
    if (httpProblem) last = `stage 1 (proxy HTTP): ${httpProblem}`;
    else {
      const r = await websocket(url);
      if (r.ok) {
        console.log(`probe ok (attempt ${attempt}): ${r.message}`);
        return;
      }
      last = `stage 2/3 (websocket to Postgres): ${r.message}`;
    }
    console.log(`probe attempt ${attempt}/${TRIES} failed: ${last}`);
    if (attempt < TRIES) await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  fail(`The database is not reachable through the websocket proxy. Last result: ${last}`);
}

void main();
