/**
 * Fake credentials for tests, built from a repeated character on purpose: they have to be long enough for the code under test (a session
 * secret of 32+ characters, a cron secret of 16+), but must never look like a real key to a secret scanner (gitleaks flags
 * high-entropy literals next to words like SECRET or KEY). Nothing here is, or was ever, a real credential.
 */
export const FAKE_AUTH_SECRET = "s".repeat(40);
export const FAKE_CRON_SECRET = "c".repeat(24);
export const FAKE_E2E_CRON_SECRET = "e".repeat(24);
export const FAKE_TOKEN = "t".repeat(12);
