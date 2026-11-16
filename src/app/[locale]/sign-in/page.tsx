import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { googleEnabled } from "@/lib/env";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignInForm } from "@/components/auth/SignInForm";
import { getSession, safeNextPath } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signInTitle") };
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const next = safeNextPath(sp.next);

  if (await getSession()) redirect({ href: next ?? "/", locale });

  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <AuthCard
      title={t("signInTitle")}
      lead={t("signInLead")}
      footer={
        <>
          <span>{t("noAccount")}</span>
          <Link className="link" href="/sign-up">
            {t("signUpLink")}
          </Link>
        </>
      }
    >
      <SignInForm googleEnabled={googleEnabled()} next={next} resetDone={sp.reset === "1"} />
    </AuthCard>
  );
}
