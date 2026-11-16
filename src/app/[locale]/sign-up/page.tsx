import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { googleEnabled } from "@/lib/env";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signUpTitle") };
}

export default async function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const locale = await resolveLocale(params);
  if (await getSession()) redirect({ href: "/", locale });

  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <AuthCard
      title={t("signUpTitle")}
      lead={t("signUpLead")}
      footer={
        <>
          <span>{t("haveAccount")}</span>
          <Link className="link" href="/sign-in">
            {t("signInLink")}
          </Link>
        </>
      }
    >
      <SignUpForm googleEnabled={googleEnabled()} />
    </AuthCard>
  );
}
