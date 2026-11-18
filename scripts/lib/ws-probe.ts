/** Pure helpers for scripts/ci-db-probe.ts (the stage-by-stage check of the CI websocket proxy), so they can be unit-tested. */

/** What Neon's websocket driver connects to: ws://<proxy>?address=<host>:<port>. */
export function buildProbeUrl(proxy: string, host: string, port: number | string): string {
  if (!/^[a-z0-9.-]+:\d{1,5}\/v1$/i.test(proxy)) throw new Error("NEON_WS_PROXY must look like host:port/v1");
  return `ws://${proxy}?address=${encodeURIComponent(`${host}:${port}`)}`;
}

/** The first 8 bytes of a Postgres connection: an SSLRequest. Any Postgres answers it with one byte, 'S' (yes) or 'N' (no). */
export const SSL_REQUEST = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

export function interpretSslReply(bytes: Uint8Array): { ok: boolean; message: string } {
  if (bytes.length >= 1 && (bytes[0] === 0x4e || bytes[0] === 0x53)) {
    return { ok: true, message: `Postgres answered the SSL request with '${String.fromCharCode(bytes[0])}': the websocket reaches the database` };
  }
  if (bytes.length >= 1 && bytes[0] === 0x45) return { ok: false, message: "the server answered with a Postgres ErrorResponse: it is Postgres, but it refused the connection" };
  return { ok: false, message: `an unexpected first byte (0x${(bytes[0] ?? 0).toString(16)}): whatever answered is not a Postgres server` };
}

/** Maps what happened to the websocket to the stage that failed, in words a person can act on. */
export function stageMessage(event: { opened: boolean; closeCode?: number; error?: string }): string {
  if (!event.opened) {
    return `the websocket could not be opened${event.error ? ` (${event.error})` : ""}: the proxy is not running, not reachable on that port, or refused the address (check ALLOW_ADDR_REGEX and the service container log)`;
  }
  return `the websocket opened and then closed${event.closeCode !== undefined ? ` (code ${event.closeCode})` : ""} before Postgres answered: the proxy cannot reach the database host (service name, port or network)`;
}
