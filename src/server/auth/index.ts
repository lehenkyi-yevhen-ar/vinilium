import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { googleEnabled, serverEnv } from "@/lib/env";
import { getDb, schema } from "@/server/db";
import { stripOAuthTokens } from "./oauth-tokens";
import { normalizeLocale, queueAuthEmail } from "@/server/email";

/**
 * Better Auth re-sends the verification email when an unverified user tries to sign in, with
 * `callbackURL=/` (passing a callbackURL on sign-in would make the client hard-redirect after every
 * successful sign-in). Point such links at the user's localized "email verified" page instead.
 */
export function localizeVerificationUrl(url: string, locale: unknown): string {
  const u = new URL(url);
  if (u.searchParams.get("callbackURL") === "/") {
    u.searchParams.set("callbackURL", `/${normalizeLocale(locale)}/verify-email/done`);
  }
  return u.toString();
}

function create() {
  const env = serverEnv();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Sessions live in Postgres (session table), not in a stateless cookie.
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        // Queued, not awaited: no timing difference that would reveal whether an account exists.
        queueAuthEmail({
          kind: "reset",
          to: user.email,
          name: user.name,
          locale: (user as { locale?: string }).locale,
          url,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        queueAuthEmail({
          kind: "verify",
          to: user.email,
          name: user.name,
          locale: (user as { locale?: string }).locale,
          url: localizeVerificationUrl(url, (user as { locale?: string }).locale),
        });
      },
    },

    socialProviders: googleEnabled()
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        }
      : {},

    user: {
      additionalFields: {
        // Remembered UI language. Validated in the hooks below.
        locale: { type: "string", required: false, defaultValue: "en", input: true },
      },
      // Deleting a user cascades to sessions, accounts and (later) wishlist/collection rows
      // through ON DELETE CASCADE foreign keys.
      deleteUser: { enabled: true },
    },

    databaseHooks: {
      // Google tokens are never stored: we only use the basic profile (see oauth-tokens.ts).
      account: {
        create: { before: async (a) => ({ data: stripOAuthTokens(a as Record<string, unknown>) as typeof a }) },
        update: { before: async (a) => ({ data: stripOAuthTokens(a as Record<string, unknown>) as typeof a }) },
      },
      user: {
        create: {
          before: async (u) => ({ data: { ...u, locale: normalizeLocale((u as { locale?: unknown }).locale) } }),
        },
        update: {
          before: async (data) => {
            const d = data as { locale?: unknown };
            return d.locale === undefined ? { data } : { data: { ...data, locale: normalizeLocale(d.locale) } };
          },
        },
      },
    },

    // Rate limiting for the auth endpoints, stored in Postgres so it works across serverless instances.
    rateLimit: {
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },

    // Must be last: lets Server Actions set cookies.
    plugins: [nextCookies()],
  });
}

const g = globalThis as unknown as { __vinilium_auth?: ReturnType<typeof create> };

export function getAuth() {
  return (g.__vinilium_auth ??= create());
}
