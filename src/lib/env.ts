import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  RESEND_API_KEY: optional(z.string()),
  EMAIL_FROM: z.string().default("Vinilium <onboarding@resend.dev>"),
  APP_CONTACT: z.string().default("https://example.com/contact"),
  // Discogs credentials, all optional here: either a personal token or an app key + secret pair.
  // Resolution (and the "pair wins over token" rule) lives in src/server/discogs/credentials.ts.
  DISCOGS_TOKEN: optional(z.string()),
  DISCOGS_CONSUMER_KEY: optional(z.string()),
  DISCOGS_CONSUMER_SECRET: optional(z.string()),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated server env. Lazy on purpose: `next build` and unit tests must not need
 * secrets just to import a module. Throws a readable error on first real use.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
