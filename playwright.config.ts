import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Local runs pick the database up from .env.local; CI passes DATABASE_URL (a throwaway Neon branch).
loadEnv({ path: ".env.local", quiet: true });

const PORT = 3200;
const MOCK_PORT = 3201;
const FAKE_DB = "postgresql://user:pass@127.0.0.1:1/none";
const hasDb = Boolean(process.env.DATABASE_URL);
// The Discogs flow needs a real Postgres (cache, token bucket, limiter). Without one its tests skip, loudly.
process.env.E2E_HAS_DB = hasDb ? "1" : "";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  globalTeardown: "./tests/e2e/global-teardown.ts",
  projects: [
    { name: "desktop", testIgnore: /discogs\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testIgnore: /discogs\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    // API-level flow against the MOCKED Discogs server; serial because the tests share one limiter and one mock.
    { name: "discogs", testMatch: /discogs\.spec\.ts/, fullyParallel: false, workers: 1, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      // Fake Discogs: no real token is ever needed.
      command: "npx tsx tests/mocks/discogs-mock.ts",
      url: `http://localhost:${MOCK_PORT}/__health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_PORT: String(MOCK_PORT) },
    },
    {
      // Builds and serves the app. The smoke tests (shell.spec.ts) never touch the database; the Discogs tests do.
      command: `npm run build && npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}/en`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: hasDb ? process.env.DATABASE_URL! : FAKE_DB,
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
        BETTER_AUTH_URL: `http://localhost:${PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
        NEXT_PUBLIC_APP_NAME: "Vinilium",
        // Fake public contact details (inlined at build time) so the contact page tests are deterministic.
        NEXT_PUBLIC_CONTACT_EMAIL: "contact@example.test",
        NEXT_PUBLIC_CONTACT_TELEGRAM: "@example_contact",
        // Discogs points at the mock with FAKE credentials, so a real key can never reach the real API from a test.
        DISCOGS_API_BASE: `http://localhost:${MOCK_PORT}`,
        DISCOGS_CONSUMER_KEY: "test-key",
        DISCOGS_CONSUMER_SECRET: "test-secret",
        DISCOGS_TOKEN: "",
        DISCOGS_CACHE_TTL_SECONDS: "300",
        CRON_SECRET: "e2e-cron-secret-0123456789",
        // Small ceilings so the limiter can be exercised quickly; tests isolate themselves with X-Forwarded-For.
        RL_SEARCH_IP_PER_MIN: "8",
        RL_IMAGE_IP_PER_MIN: "12",
      },
    },
  ],
});
