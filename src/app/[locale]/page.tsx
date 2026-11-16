import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { ButtonLink } from "@/ds/ButtonLink";
import { StatusMessage } from "@/ds/StatusMessage";
import { getSession } from "@/server/auth/session";

export default async function HomePage({ params, searchParams }: PageProps<"/[locale]">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "home" });
  const account = await getTranslations({ locale, namespace: "account" });
  const session = await getSession();

  return (
    <div className="container x-page">
      {sp.deleted === "1" ? <StatusMessage tone="success">{account("deleted")}</StatusMessage> : null}

      <section className="x-hero" aria-labelledby="hero-title">
        <p className="t-eyebrow">{t("eyebrow")}</p>
        <h1 id="hero-title">{t("title")}</h1>
        <p className="x-lead">{session ? t("welcomeBack", { name: session.user.name }) : t("lead")}</p>
        <div className="x-actions">
          {session ? (
            <>
              <ButtonLink href="/search">{t("ctaSearch")}</ButtonLink>
              <ButtonLink href="/account" variant="outline">
                {t("ctaAccount")}
              </ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink href="/sign-up">{t("ctaSignUp")}</ButtonLink>
              <ButtonLink href="/sign-in" variant="outline">
                {t("ctaSignIn")}
              </ButtonLink>
            </>
          )}
        </div>
      </section>

      <section className="x-steps" aria-label={t("eyebrow")}>
        {(["step1", "step2", "step3"] as const).map((k) => (
          <div key={k} className="x-card">
            <h2>{t(`${k}Title`)}</h2>
            <p>{t(`${k}Text`)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
