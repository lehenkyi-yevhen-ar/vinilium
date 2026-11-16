import { expect, test as setup } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";

export const STORAGE_STATE = "tests/.auth/user.json";
const PASSWORD = "E2e-Password-123";

/**
 * Search and images require sign-in, so the Discogs and finder tests run as a real signed-in user: this creates one
 * through the real sign-up endpoint, marks the email verified directly in the database (a test has no mailbox), signs
 * in through the real endpoint and saves the session cookie. The teardown deletes the user (their rows cascade).
 */
setup("create a verified e2e user and sign in", async ({ request, baseURL }) => {
  setup.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): the e2e user and the session live in Postgres.");

  const origin = baseURL!;
  const email = `e2e-${Date.now().toString(36)}@example.test`;

  const up = await request.post("/api/auth/sign-up/email", { data: { name: "E2E User", email, password: PASSWORD, locale: "en" }, headers: { origin } });
  expect(up.ok(), "sign-up").toBe(true);

  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: e2eDatabaseUrl()! });
  try {
    await pool.query('update "user" set email_verified = true where email = $1', [email]);
  } finally {
    await pool.end();
  }

  const inn = await request.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD }, headers: { origin } });
  expect(inn.ok(), "sign-in").toBe(true);
  await request.storageState({ path: STORAGE_STATE });
});
