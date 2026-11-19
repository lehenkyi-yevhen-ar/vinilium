import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { site } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/locale";
import { publicMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "contact" });
  return publicMetadata(locale, "/contact", { title: t("title"), description: t("lead") });
}

/** Public. The address and (optional) Telegram link come from NEXT_PUBLIC_CONTACT_* via `site.contact`. */
export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "contact" });
  const f = await getTranslations({ locale, namespace: "footer" });
  const { email, telegram } = site.contact;

  return (
    <div className="container x-page">
      <div className="x-narrow">
        <article className="x-card">
          <h1>{t("title")}</h1>
          <p className="x-lead">{t("lead")}</p>

          <section className="x-section" aria-labelledby="topics-h">
            <h2 id="topics-h">{t("topicsTitle")}</h2>
            <ul className="x-list">
              <li>{t("topicQuestions")}</li>
              <li>{t("topicBugs")}</li>
              <li>{t("topicPrivacy")}</li>
            </ul>
            <p className="x-note">
              {t("selfService")}{" "}
              <Link className="link" href="/account">
                {t("accountLink")}
              </Link>
            </p>
          </section>

          <section className="x-section" aria-labelledby="reach-h">
            <h2 id="reach-h">{t("reachTitle")}</h2>
            {email || telegram ? (
              <ul className="x-list x-list--plain x-contact">
                {email ? (
                  <li>
                    <span className="x-contact__label">{t("emailLabel")}</span>
                    <a className="link" href={`mailto:${email}`}>
                      {email}
                    </a>
                  </li>
                ) : null}
                {telegram ? (
                  <li>
                    <span className="x-contact__label">{t("telegramLabel")}</span>
                    <a className="link" href={telegram.url} target="_blank" rel="noopener noreferrer">
                      {telegram.label}
                    </a>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="x-note">{t("notConfigured")}</p>
            )}
          </section>

          <section className="x-section" aria-labelledby="discogs-h">
            <h2 id="discogs-h">{t("discogsTitle")}</h2>
            {/* The wording is prescribed by the Discogs API Terms of Use, so it stays verbatim (English) in every language. */}
            <p className="x-note" lang="en">
              {f("discogsNotice")}
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
