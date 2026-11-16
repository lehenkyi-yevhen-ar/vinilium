import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type Locale } from "./routing";

/**
 * Awaits the route's `locale` param, narrows it to a supported locale (404 otherwise) and makes it the
 * request locale, so server components that call useTranslations()/Link without an explicit locale
 * (header, footer, not-found) render in the right language. Layouts and pages render in parallel,
 * so every one of them must call this (or setRequestLocale) itself.
 */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
