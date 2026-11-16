import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Builds and serves the app with throwaway env values. These smoke tests never touch a database:
  // they cover routing, i18n, design-system wiring and client-side validation. The full
  // search -> add-to-list flow (milestone 5) will run against a mocked Discogs server and a test database.
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:1/none",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
    },
  },
});
