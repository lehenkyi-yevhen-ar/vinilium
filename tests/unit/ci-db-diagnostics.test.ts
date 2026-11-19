import { describe, expect, it } from "vitest";
import { describeDbError, isMissingRelation, redact } from "../../scripts/lib/db-error";
import { buildProbeUrl, interpretSslReply, SSL_REQUEST, stageMessage } from "../../scripts/lib/ws-probe";

/** The CI database diagnostics: the real cause behind drizzle's "Failed query" wrapper, redacted, and the proxy probe's stage messages. */

describe("describeDbError", () => {
  it("prints the whole cause chain, so the reason behind 'Failed query' is visible", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { name: "Error", code: "ECONNREFUSED", errno: -111, syscall: "connect", address: "127.0.0.1", port: 5433 });
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', { cause: root });
    wrapped.name = "DrizzleQueryError";
    const lines = describeDbError(wrapped);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^DrizzleQueryError: Failed query: CREATE SCHEMA/);
    expect(lines[0]).not.toMatch(/params/); // the first line of the message only
    expect(lines[1]).toMatch(/code=ECONNREFUSED errno=-111 syscall=connect address=127\.0\.0\.1 port=5433: connect ECONNREFUSED/);
  });

  it("redacts connection strings, passwords and tokens anywhere in the chain", () => {
    const e = new Error("failed for postgresql://user:hunter2@db.example/vinilium with password=hunter2 and Bearer abc.def", {
      cause: new Error("token: s3cr3t"),
    });
    const text = describeDbError(e).join("\n");
    expect(text).not.toMatch(/hunter2|s3cr3t|abc\.def|user:/);
    expect(text).toMatch(/<redacted/);
  });

  it("survives odd values, cycles and long chains", () => {
    expect(describeDbError("plain string")).toEqual(["plain string"]);
    expect(describeDbError(undefined)).toEqual([]);
    const a: { cause?: unknown; message: string } = { message: "a" };
    a.cause = a;
    expect(describeDbError(a)).toHaveLength(1);
    let deep: Error = new Error("x");
    for (let i = 0; i < 20; i++) deep = new Error(`e${i}`, { cause: deep });
    expect(describeDbError(deep).length).toBeLessThanOrEqual(6);
  });

  it("redact is idempotent", () => {
    const once = redact("postgres://a:b@c/d");
    expect(redact(once)).toBe(once);
  });
});

describe("isMissingRelation: the only errors that mean 'no migrations table yet'", () => {
  it("recognises undefined_table and invalid_schema_name, also inside wrappers", () => {
    expect(isMissingRelation({ code: "42P01" })).toBe(true);
    expect(isMissingRelation({ code: "3F000" })).toBe(true);
    expect(isMissingRelation(new Error("wrapped", { cause: { code: "42P01" } }))).toBe(true);
  });
  it("does NOT treat a refused connection, a bad password or a timeout as 'nothing applied'", () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "28P01", "28000", "57P03", "08006"]) expect(isMissingRelation({ code }), code).toBe(false);
    expect(isMissingRelation(new Error("boom"))).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
  });
});

describe("ws-probe helpers", () => {
  it("builds the address the Neon driver uses: ws://<proxy>?address=<host>:<port>", () => {
    expect(buildProbeUrl("localhost:5433/v1", "postgres", 5432)).toBe("ws://localhost:5433/v1?address=postgres%3A5432");
    for (const bad of ["http://localhost:5433/v1", "localhost:5433", "localhost/v1", "a b:1/v1", ""]) expect(() => buildProbeUrl(bad, "h", 1), bad).toThrow();
  });

  it("an SSLRequest is the 8 bytes Postgres expects, and 'N' or 'S' prove it is Postgres on the other end", () => {
    expect([...SSL_REQUEST]).toEqual([0, 0, 0, 8, 4, 210, 22, 47]);
    expect(interpretSslReply(new Uint8Array([0x4e])).ok).toBe(true);
    expect(interpretSslReply(new Uint8Array([0x53])).ok).toBe(true);
    expect(interpretSslReply(new Uint8Array([0x45, 0, 0])).ok).toBe(false);
    expect(interpretSslReply(new Uint8Array([0x48, 0x54])).message).toMatch(/not a Postgres server/);
    expect(interpretSslReply(new Uint8Array([])).ok).toBe(false);
  });

  it("names the failing stage", () => {
    expect(stageMessage({ opened: false })).toMatch(/could not be opened.*proxy is not running/);
    expect(stageMessage({ opened: true, closeCode: 1006 })).toMatch(/opened and then closed \(code 1006\).*cannot reach the database host/);
  });
});

describe("describeDbError: a failed websocket is a bare ErrorEvent", () => {
  it("shows the event's type, the address it tried and the nested error", () => {
    const event = { type: "error", message: "", target: { url: "ws://localhost:5433/v1?address=postgres%3A5432" }, error: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { code: "ECONNREFUSED" }) };
    const lines = describeDbError(new Error("Failed query: CREATE SCHEMA", { cause: event }));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/type=error websocket=ws:\/\/localhost:5433\/v1\?…/);
    expect(lines[1]).toMatch(/no message/);
    expect(lines[2]).toMatch(/code=ECONNREFUSED/);
  });
});
