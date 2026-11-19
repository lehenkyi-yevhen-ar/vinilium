import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { routing } from "@/i18n/routing";
import { THEME_SCRIPT_PATH } from "@/lib/theme";
import { DSScript } from "@/ds/DSScript";
import { getSession } from "@/server/auth/session";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TabBar } from "@/components/TabBar";
import "../ds-extensions.css";

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(site.url),
    title: { default: site.name, template: `%s · ${site.name}` },
    description: t("description"),
    // The app is not for search engines: a page opts in with publicMetadata() (home, contact, privacy, terms).
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "common" });
  const session = await getSession();
  const signedIn = Boolean(session);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark light" />
        {/* The person's colour theme, applied BEFORE the first paint (a small same-origin file, so the CSP needs no hash or nonce for it; see
            lib/theme.ts and app/theme-init.js). It sits above the stylesheets on purpose. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- on purpose: it must block rendering, or the page flashes the wrong theme */}
        <script src={THEME_SCRIPT_PATH} />
        {/* Ліс design system, vendored unmodified in /public/ds */}
        <link rel="preload" href="/ds/fonts/KyivTypeSans-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/ds/tokens.css" precedence="ds" />
        <link rel="stylesheet" href="/ds/components/bundle.css" precedence="ds" />
      </head>
      <body>
        <NextIntlClientProvider>
          <a className="x-skip" href="#main">
            {t("skipToContent")}
          </a>
          <SiteHeader signedIn={signedIn} userName={session?.user.name} />
          <main id="main" className="x-main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
          <TabBar signedIn={signedIn} />
          <DSScript />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
