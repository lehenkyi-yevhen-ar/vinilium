import { describe, expect, it } from "vitest";
import { applyLocalNeonProxy, type NeonConfigLike } from "@/lib/neon-local";

describe("applyLocalNeonProxy (CI only: a plain Postgres behind Neon's wsproxy)", () => {
  const url = "postgresql://postgres:postgres@postgres:5432/vinilium_e2e";

  it("does nothing unless NEON_WS_PROXY is set", () => {
    const cfg: NeonConfigLike = {};
    expect(applyLocalNeonProxy(cfg, {}, url)).toBe(false);
    expect(applyLocalNeonProxy(cfg, { NEON_WS_PROXY: "  " }, url)).toBe(false);
    expect(cfg).toEqual({});
  });

  it("routes a non-Neon host through the proxy, over plain ws", () => {
    const cfg: NeonConfigLike = {};
    expect(applyLocalNeonProxy(cfg, { NEON_WS_PROXY: "localhost:5433/v1" }, url)).toBe(true);
    // a string, so the driver appends ?address=<host>:<port> (a function would have to add it itself; without it the proxy refuses)
    expect(cfg.wsProxy).toBe("localhost:5433/v1");
    expect(cfg).toMatchObject({ useSecureWebSocket: false, pipelineTLS: false, pipelineConnect: false });
  });

  it("NEVER applies to a real Neon host, so a production or dev-branch connection cannot be rerouted", () => {
    for (const host of ["ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech", "x.neon.tech", "NEON.TECH"]) {
      const cfg: NeonConfigLike = {};
      expect(applyLocalNeonProxy(cfg, { NEON_WS_PROXY: "localhost:5433/v1" }, `postgresql://u:p@${host}/db`), host).toBe(false);
      expect(cfg).toEqual({});
    }
  });

  it("ignores a malformed proxy value or connection string", () => {
    for (const bad of ["http://evil.example/v1", "localhost:5433", "localhost:5433/v2", "a b:1/v1", "localhost:5433/v1?x=1"]) {
      expect(applyLocalNeonProxy({}, { NEON_WS_PROXY: bad }, url), bad).toBe(false);
    }
    expect(applyLocalNeonProxy({}, { NEON_WS_PROXY: "localhost:5433/v1" }, "not a url")).toBe(false);
  });
});

describe("the address the Neon driver really asks the proxy for (regression: the CI e2e job failed here)", () => {
  it("is /v1?address=<host>:<port>: wsproxy refuses a request without the target address", async () => {
    const http = await import("node:http");
    const { neonConfig, Pool } = await import("@neondatabase/serverless");
    const seen: string[] = [];
    const server = http.createServer((_q, r) => {
      r.statusCode = 400;
      r.end();
    });
    server.on("upgrade", (req, socket) => {
      seen.push(req.url ?? "");
      socket.destroy(); // record the request, then refuse it
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const saved = { wsProxy: neonConfig.wsProxy, secure: neonConfig.useSecureWebSocket, tls: neonConfig.pipelineTLS, pipe: neonConfig.pipelineConnect };
    try {
      expect(applyLocalNeonProxy(neonConfig, { NEON_WS_PROXY: `127.0.0.1:${port}/v1` }, "postgresql://u:p@postgres:5432/db")).toBe(true);
      const pool = new Pool({ connectionString: "postgresql://u:p@postgres:5432/db" });
      pool.on("error", () => {});
      await pool.query("select 1").catch(() => {});
      await pool.end().catch(() => {});
      expect(seen[0]).toBe("/v1?address=postgres:5432");
    } finally {
      Object.assign(neonConfig, { wsProxy: saved.wsProxy, useSecureWebSocket: saved.secure, pipelineTLS: saved.tls, pipelineConnect: saved.pipe });
      server.close();
    }
  });
});
