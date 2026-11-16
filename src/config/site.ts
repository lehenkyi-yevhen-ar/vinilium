/**
 * Branding. Every value here is a PLACEHOLDER until you set the env vars
 * (see .env.example and the README "Placeholders" section).
 */
export const site = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "Vinilium",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
