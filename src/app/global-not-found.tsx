import type { Metadata } from "next";
import { site } from "@/config/site";
import { routing } from "@/i18n/routing";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";
import "./ds-extensions.css";

/**
 * 404 for every URL that does not match a route. Next.js renders this WITHOUT the app layout (our root
 * layout lives under /[locale], so a regular not-found.tsx can't be used), which means there is no
 * request locale here. The text comes from the message files and is shown in all three languages.
 */
export const metadata: Metadata = { title: `404 · ${site.name}` };

const messages = { uk, en, nb } as const;
const themeScript = `try{document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}catch(e){}`;

export default function GlobalNotFound() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="stylesheet" href="/ds/tokens.css" />
        <link rel="stylesheet" href="/ds/components/bundle.css" />
      </head>
      <body>
        <main className="x-main container x-page" id="main">
          {routing.locales.map((locale, i) => {
            const t = messages[locale].notFound;
            return (
              <section key={locale} lang={locale} className="x-empty">
                {/* One h1 per page; the other languages use h2. */}
                {i === 0 ? <h1 className="t-h2">{t.title}</h1> : <h2 className="t-h2">{t.title}</h2>}
                <p>{t.text}</p>
                {/* Plain anchor: this page renders outside the app's router and locale providers. */}
                <a className="btn btn--outline" href={`/${locale}`}>
                  {t.home}
                </a>
              </section>
            );
          })}
        </main>
      </body>
    </html>
  );
}
