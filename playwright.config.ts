import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { e2eDatabaseUrl } from "./tests/helpers/e2e-db";
import { FAKE_E2E_CRON_SECRET } from "./tests/helpers/fake-secrets";

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
// Firefox and WebKit: always on a developer machine (as before); on CI only when asked for, because the job installs Chromium alone.
const extraBrowsers = !process.env.CI || process.env.E2E_EXTRA_BROWSERS === "1";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // PROJECT GRAPH. Only "setup" (the sign-in) is a real dependency: every project that needs the shared session depends on it and on nothing else, so
  // a failure in one project never hides the tests of another (before, 419 tests "did not run" behind one failing finder test). The signed-out shell
  // projects and limiter-concurrency (own users) need no dependency at all.
  // ONE WORKER, deliberately: the projects run one after the other, in the order they are listed below, because they still share state that is not
  // isolated per project: the mock Discogs server (its throttle switch and request log are global: "the next 3 API calls answer 429"), the Discogs token
  // bucket row of the mock origin, and the signed-in e2e user with its list rows (library, keyboard, phone-menus and a11y rewrite them). Each project
  // does have its own client address (x-forwarded-for from 203.0.113.0/24) so the per-IP limiters never collide, but that alone is not enough to run
  // them side by side. Making them truly parallel needs a mock instance, an app server and a user per lane; not done (see docs/operations.md, 18d).
  // No maxFailures and no retries: every project runs to its end, whatever the others did.
  workers: 1,
  // CI keeps an HTML report plus a trace and a screenshot of every failure (uploaded as an artifact by the workflow); no retries, so a
  // flaky test is seen, not hidden.
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results/results.json" }]] : [["list"]],
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  globalTeardown: "./tests/e2e/global-teardown.ts",
  projects: [
    // Creates a verified e2e user and saves its session cookie (search and images need sign-in).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Anonymous visitors: shell, contact page, "sign in to search".
    { name: "desktop", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: /shell\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    // The same signed-out smoke tests in the other two engines (browsers installed with `npx playwright install firefox webkit`). Run them
    // on their own: `npx playwright test --no-deps --project=firefox --project=webkit`. The CI job installs Chromium only, so on CI these two
    // projects exist only when E2E_EXTRA_BROWSERS=1 (the first PR run listed them and failed 26 tests with "Executable doesn't exist").
    ...(extraBrowsers
      ? [
          { name: "firefox", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", testMatch: /shell\.spec\.ts/, use: { ...devices["Desktop Safari"] } },
        ]
      : []),
    // The Discogs and lists APIs, signed in, against the MOCKED Discogs server. Serial: one limiter, one mock.
    {
      name: "discogs",
      testMatch: /discogs\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
    // The finder UI (track -> artist -> album -> pressing -> release card).
    {
      name: "finder-desktop",
      testMatch: /finder\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.201" } },
    },
    {
      name: "finder-mobile",
      testMatch: /finder\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.202" } },
    },
    // Back links, browser Back and reload through every finder step (state lives in the URL): desktop, then 390 px wide.
    {
      name: "finder-nav-desktop",
      testMatch: /(finder-nav|search-help)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.203" } },
    },
    {
      name: "finder-nav-390",
      testMatch: /(finder-nav|search-help)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.204" } },
    },
    // Phone menus (language switcher, theme switcher, modals): every test builds its own phone-sized contexts.
    {
      name: "phone-menus",
      testMatch: /phone-menus.*\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // The theme switcher on every screen: desktop, then 390 px wide. Builds its own contexts.
    {
      name: "theme-desktop",
      testMatch: /theme\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "theme-390",
      testMatch: /theme\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    // The Wishlist / Collection screens (milestone 4). After the finder, one after the other: the same mock and Discogs bucket.
    {
      name: "library-desktop",
      testMatch: /library\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.211" } },
    },
    {
      name: "library-mobile",
      testMatch: /library\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.212" } },
    },
    // Accessibility audit (axe) in the light and dark themes (the theme follows the OS colour scheme) and on a phone; after the library
    // projects because they share the mock server and the Discogs bucket.
    {
      name: "a11y-light",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], colorScheme: "light", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.213" } },
    },
    {
      name: "a11y-dark",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.214" } },
    },
    {
      name: "a11y-phone",
      testMatch: /a11y\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Pixel 7"], colorScheme: "light", storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.215" } },
    },
    // Keyboard behaviour (focus order, skip link, dialogs, toggles), desktop.
    {
      name: "keyboard",
      testMatch: /keyboard\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.216" } },
    },
    // Email + password switches and the invite-only allowlist: this spec starts two extra servers (same build, other env).
    {
      name: "auth-modes",
      testMatch: /auth-modes\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // The Content-Security-Policy in a real browser: zero violations on every page and language, a nonce on every inline script.
    // Run the whole suite with CSP_MODE=enforce to prove an enforcing policy breaks nothing (docs/operations.md, section 10).
    {
      name: "csp",
      testMatch: /csp\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // The Discogs attribution rule on every page that shows Discogs data, three languages (a crawler-style check).
    {
      name: "attribution",
      testMatch: /attribution\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // Accessibility beyond axe: reflow at 320 and 640 px, text spacing, forced colours, reduced motion, 44 px targets, visible focus.
    {
      name: "a11y-extra",
      testMatch: /a11y-extra\.spec\.ts/,
      dependencies: ["setup"],
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    // Our limiter under real concurrency (fresh users and addresses, bursts of parallel requests): see the spec's header.
    {
      name: "limiter-concurrency",
      testMatch: /limiter-concurrency\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
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
        // CI only (empty = off): the Postgres service container is reached through Neon's wsproxy. See src/lib/neon-local.ts.
        NEON_WS_PROXY: process.env.NEON_WS_PROXY ?? "",
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
        BETTER_AUTH_URL: `http://localhost:${PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
        NEXT_PUBLIC_APP_NAME: "Vinilium",
        // "report-only" (the default) or "enforce": the Content-Security-Policy mode under test (src/proxy.ts).
        CSP_MODE: process.env.CSP_MODE ?? "report-only",
        // Fake public contact details (inlined at build time) so the contact page tests are deterministic.
        NEXT_PUBLIC_CONTACT_EMAIL: "contact@example.test",
        NEXT_PUBLIC_CONTACT_TELEGRAM: "@example_contact",
        // Discogs points at the mock with FAKE credentials, so a real key can never reach the real API from a test.
        DISCOGS_API_BASE: `http://localhost:${MOCK_PORT}`,
        // Email goes to the mock Brevo (same mock server): the sign-up, verification and reset flows run for real against it.
        EMAIL_PROVIDER: "brevo",
        BREVO_API_KEY: "test-brevo-key",
        BREVO_API_BASE: `http://localhost:${MOCK_PORT}/brevo`,
        EMAIL_FROM: "sender@example.test",
        EMAIL_FROM_NAME: "Vinilium",
        DISCOGS_CONSUMER_KEY: "test-key",
        DISCOGS_CONSUMER_SECRET: "test-secret",
        DISCOGS_TOKEN: "",
        DISCOGS_CACHE_TTL_SECONDS: "300",
        CRON_SECRET: FAKE_E2E_CRON_SECRET,
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
