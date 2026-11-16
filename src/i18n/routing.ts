import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["uk", "en", "nb"],
  defaultLocale: "en",
  // The locale is always in the URL (/uk/..., /en/..., /nb/...).
  localePrefix: "always",
  // next-intl remembers the last locale in a cookie for anonymous visitors;
  // signed-in users also get it stored on their account (user.locale).
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" },
});

export type Locale = (typeof routing.locales)[number];
