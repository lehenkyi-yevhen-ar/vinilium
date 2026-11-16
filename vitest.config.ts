import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The real package throws outside React Server Components.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  // Generous timeouts: with many files in parallel, the first import of heavy modules (better-auth, PGlite) is slow.
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
});
