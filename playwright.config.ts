import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { e2eDatabaseUrl } from "./tests/helpers/e2e-db";

// Local runs pick DEV_DATABASE_URL up from .env.local; CI passes it too (a throwaway Neon branch). e2e NEVER uses DATABASE_URL
// (production): it creates and deletes users and cache rows. See tests/helpers/e2e-db.ts.
loadEnv({ path: ".env.local", quiet: true });
const e2eDbUrl = e2eDatabaseUrl();

const STORAGE_STATE = "tests/.auth/user.json";
const PORT = 3200;
const MOCK_PORT = 3201;
const hasDb = true; // e2eDatabaseUrl() throws when there is no dev database, so a run that gets here has one
// The Discogs flow needs a real Postgres (cache, token bucket, limiter). Without one its tests skip, loudly.
process.env.E2E_HAS_DB = hasDb ? "1" : "";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  globalTeardown: "./tests/e2e/global-teardown.ts",
  projects: [
    // Creates a verified e2e user and saves its session cookie (search and images need sign-in).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Anonymous visitors: shell, contact page, "sign in to search".
    { name: "desktop", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /shell\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    // The Discogs and lists APIs, signed in, against the MOCKED Discogs server. Serial: one limiter, one mock.
    {
      name: "discogs",
      testMatch: /discogs\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    // The finder UI (track -> artist -> album -> pressing -> release card). Runs after the API project and one
    // after the other, because they share the mock server and the Discogs throttle bucket.
    {
      name: "finder-desktop",
      testMatch: /finder\.spec\.ts/,
      dependencies: ["discogs"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.201" } },
    },
    {
      name: "finder-mobile",
      testMatch: /finder\.spec\.ts/,
      dependencies: ["finder-desktop"],
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.202" } },
    },
    // The Wishlist / Collection screens (milestone 4). After the finder, one after the other: the same mock and Discogs bucket.
    {
      name: "library-desktop",
      testMatch: /library\.spec\.ts/,
      dependencies: ["finder-mobile"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.211" } },
    },
    {
      name: "library-mobile",
      testMatch: /library\.spec\.ts/,
      dependencies: ["library-desktop"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.212" } },
    },
    // Accessibility audit (axe) in the light and dark themes (the theme follows the OS colour scheme) and on a phone; after the library
    // projects because they share the mock server and the Discogs bucket.
    {
      name: "a11y-light",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["library-mobile"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], colorScheme: "light", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.213" } },
    },
    {
      name: "a11y-dark",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["a11y-light"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.214" } },
    },
    {
      name: "a11y-phone",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["a11y-dark"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Pixel 7"], colorScheme: "light", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.215" } },
    },
    // Keyboard behaviour (focus order, skip link, dialogs, toggles), desktop.
    {
      name: "keyboard",
      testMatch: /keyboard\.spec\.ts/,
      dependencies: ["a11y-phone"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.216" } },
    },
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
        // The server runs in production mode, so it reads DATABASE_URL: hand it the DEV database under that name, and blank the
        // real variables so nothing in .env.local can leak through.
        DATABASE_URL: e2eDbUrl,
        DEV_DATABASE_URL: "",
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
        // Per-IP limit is exercised by one test (its own X-Forwarded-For); the per-user limit is lifted because every
        // e2e project shares one signed-in user.
        RL_SEARCH_IP_PER_MIN: "60",
        RL_SEARCH_USER_PER_MIN: "1000",
        RL_IMAGE_USER_PER_MIN: "5000",
        // Likewise the per-person cold-fetch allowance (default 24/min): every project shares one signed-in user, and several tests
        // cold-load whole pages. The cap itself is covered by tests/unit/cold-fetch-cap.test.ts.
        RL_COLD_USER_PER_MIN: "5000",
      },
    },
  ],
});
