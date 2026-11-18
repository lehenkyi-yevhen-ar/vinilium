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
    expect((cfg.wsProxy as () => string)()).toBe("localhost:5433/v1");
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
