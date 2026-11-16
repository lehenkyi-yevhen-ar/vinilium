import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, unmodified design-system files and generated migrations.
    "public/ds/**",
    "vendor/**",
    "drizzle/**",
  ]),
  {
    // `_name` marks a deliberately unused parameter (e.g. to type a mock's call arguments).
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  {
    // The Ліс design system is served as static files from /public/ds on purpose (vendored, unmodified).
    files: ["src/app/[[]locale]/layout.tsx", "src/app/global-not-found.tsx"],
    rules: { "@next/next/no-css-tags": "off" },
  },
]);

export default eslintConfig;
