import { FAKE_AUTH_SECRET } from "./fake-secrets";
const MANAGED = [
  "DISCOGS_TOKEN",
  "DISCOGS_CONSUMER_KEY",
  "DISCOGS_CONSUMER_SECRET",
  "DISCOGS_API_BASE",
  "DISCOGS_CACHE_TTL_SECONDS",
  "CRON_SECRET",
  "RL_SEARCH_IP_PER_MIN",
  "RL_SEARCH_USER_PER_MIN",
  "RL_IMAGE_IP_PER_MIN",
  "RL_IMAGE_USER_PER_MIN",
  "APP_CONTACT",
  "NEXT_PUBLIC_APP_NAME",
];

/** Reset the env keys our server code reads to a known, fake baseline, then apply overrides. */
export function setEnv(overrides: Record<string, string> = {}) {
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://u:p@localhost/db",
    BETTER_AUTH_SECRET: FAKE_AUTH_SECRET,
    BETTER_AUTH_URL: "http://localhost:3000",
    DISCOGS_CONSUMER_KEY: "test-key",
    DISCOGS_CONSUMER_SECRET: "test-secret",
    APP_CONTACT: "https://vinilium.test/contact",
    NEXT_PUBLIC_APP_NAME: "Vinilium",
    ...overrides,
  });
}
