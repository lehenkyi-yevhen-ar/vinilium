import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // The real package throws outside React Server Components.
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // At most 4 worker processes. Measured on a 16-thread machine (docs/autonomous-progress.md, block A): every worker's imports go
    // through Vite's single transform thread, so with the default (cores - 1) workers the first `import("@/server/auth")`
    // took ~13 s on an idle machine and 30 s+ when the machine was busy, which hit the old 30 s test timeout; once a worker even
    // died with a V8 abort while many PGlite (WASM) instances started at once. With 4 the same import takes ~1-3 s and the whole
    // run costs about 3 s more.
    maxWorkers: 4,
    // Generous timeouts as a backstop for a loaded CI runner: the first import of heavy modules (better-auth, PGlite) is slow.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
