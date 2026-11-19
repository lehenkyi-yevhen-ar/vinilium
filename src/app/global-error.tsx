"use client";

import { routing } from "@/i18n/routing";
import { THEME_SCRIPT_PATH } from "@/lib/theme";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";
import "./ds-extensions.css";

/**
 * The last resort: an error in the root layout itself (so there is no header, no locale provider and no translations). Plain HTML in all
 * three languages, like the global 404. It shows no error text. Next.js renders it only in production; in development you see the overlay.
 */
const messages = { uk, en, nb } as const;

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark light" />
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- on purpose: it must block rendering, or the page flashes the wrong theme */}
        <script src={THEME_SCRIPT_PATH} />
        {/* eslint-disable-next-line @next/next/no-css-tags -- this page renders outside the app's layout, so the design system's files are linked by hand (as in global-not-found) */}
        <link rel="stylesheet" href="/ds/tokens.css" />
        {/* eslint-disable-next-line @next/next/no-css-tags -- see above */}
        <link rel="stylesheet" href="/ds/components/bundle.css" />
      </head>
      <body>
        <main className="x-main container x-page" id="main">
          {routing.locales.map((locale, i) => {
            const t = messages[locale].errorPage;
            return (
              <section key={locale} lang={locale} className="x-empty" role={i === 0 ? "alert" : undefined}>
                {i === 0 ? <h1 className="t-h2">{t.title}</h1> : <h2 className="t-h2">{t.title}</h2>}
                <p>{t.text}</p>
                <button type="button" className="btn btn--outline" onClick={() => reset()}>
                  {t.retry}
                </button>
              </section>
            );
          })}
        </main>
      </body>
    </html>
  );
}
