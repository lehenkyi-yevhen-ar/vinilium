/**
 * Turns a database error into text that can be printed in a CI log: the whole `cause` chain (drizzle wraps the real error in "Failed query: ...",
 * which says nothing about WHY), with name, code, errno, syscall, address and port where they exist, and every connection string, password and
 * key redacted. Never prints query parameters.
 */

const REDACTIONS: Array<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/\S+/gi, "<redacted-url>"],
  [/(password|passwd|pwd|secret|token|apikey|api-key)\s*[=:]\s*\S+/gi, "$1=<redacted>"],
  [/\bBearer\s+\S+/gi, "Bearer <redacted>"],
];

export function redact(text: string): string {
  return REDACTIONS.reduce((s, [re, to]) => s.replace(re, to), text);
}

/** One line per error in the chain, outermost first. */
export function describeDbError(error: unknown, maxDepth = 6): string[] {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let e: unknown = error;
  for (let depth = 0; e !== undefined && e !== null && depth < maxDepth && !seen.has(e); depth++) {
    seen.add(e);
    if (typeof e !== "object") {
      lines.push(`${"  ".repeat(depth)}${redact(String(e))}`);
      break;
    }
    // A failed websocket surfaces as an ErrorEvent (type "error", no message of its own): the reason is in `error`, and the address it tried is
    // on `target.url` (a ws:// address with no credentials in it).
    const x = e as { name?: unknown; message?: unknown; code?: unknown; errno?: unknown; syscall?: unknown; address?: unknown; port?: unknown; type?: unknown; cause?: unknown; error?: unknown; target?: { url?: unknown } };
    const wsUrl = typeof x.target?.url === "string" ? x.target.url : "";
    const parts: string[] = [String(x.name ?? "Error")];
    for (const k of ["code", "errno", "syscall", "address", "port", "type"] as const) if (x[k] !== undefined && x[k] !== null && x[k] !== "") parts.push(`${k}=${String(x[k])}`);
    // the message of the OUTERMOST error is the "Failed query: <sql>" wrapper: keep its first line only (the statement, never the params)
    const message = String(x.message ?? "").split("\n")[0].slice(0, 300);
    if (wsUrl) parts.push(`websocket=${wsUrl.replace(/\?.*$/, "?…")}`);
    lines.push(`${"  ".repeat(depth)}${redact(parts.join(" "))}: ${redact(message || "(no message: a bare event; see the lines below and the container logs)")}`);
    e = x.cause ?? x.error;
  }
  return lines;
}

/** Postgres "this object does not exist yet" errors: the only failures that mean "no migrations table", as opposed to "cannot connect". */
export function isMissingRelation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (code === "42P01" || code === "3F000") return true; // undefined_table, invalid_schema_name
  }
  return false;
}
