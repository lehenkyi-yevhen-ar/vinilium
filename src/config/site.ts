/**
 * Branding. Every value here is a PLACEHOLDER until you set the env vars
 * (see .env.example and the README "Placeholders" section).
 */
import { parseContact } from "@/lib/contact";

export const site = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "Vinilium",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  /** Public contact details (contact page, privacy policy). NEXT_PUBLIC_* is inlined at build time. */
  contact: parseContact({
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
    telegram: process.env.NEXT_PUBLIC_CONTACT_TELEGRAM,
  }),
} as const;
