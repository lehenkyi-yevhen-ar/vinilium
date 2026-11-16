import "server-only";

export type DiscogsAuthMode = "key-secret" | "token";

export interface DiscogsAuth {
  mode: DiscogsAuthMode;
  /** Value for the `Authorization` request header. A credential: never log it or send it to the browser. */
  header: string;
}

interface DiscogsEnv {
  DISCOGS_TOKEN?: string;
  DISCOGS_CONSUMER_KEY?: string;
  DISCOGS_CONSUMER_SECRET?: string;
}

const clean = (v: string | undefined) => v?.trim() || undefined;

/**
 * Picks the Discogs credentials from the environment.
 *
 * - `DISCOGS_CONSUMER_KEY` + `DISCOGS_CONSUMER_SECRET` (both set) win:
 *     `Authorization: Discogs key=<key>, secret=<secret>`
 * - otherwise `DISCOGS_TOKEN`:
 *     `Authorization: Discogs token=<token>`
 * - a half-set key/secret pair is ignored when a token exists, and is an error when it is all we have
 *   (a lone key would silently produce unauthenticated, heavily rate-limited requests).
 * - nothing set -> `null`; the caller decides whether that is fatal.
 */
export function resolveDiscogsAuth(env: DiscogsEnv = process.env as DiscogsEnv): DiscogsAuth | null {
  const key = clean(env.DISCOGS_CONSUMER_KEY);
  const secret = clean(env.DISCOGS_CONSUMER_SECRET);
  const token = clean(env.DISCOGS_TOKEN);

  if (key && secret) return { mode: "key-secret", header: `Discogs key=${key}, secret=${secret}` };
  if (token) return { mode: "token", header: `Discogs token=${token}` };
  if (key || secret) {
    throw new Error(
      "Discogs credentials are incomplete: set both DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET, or set DISCOGS_TOKEN.",
    );
  }
  return null;
}
