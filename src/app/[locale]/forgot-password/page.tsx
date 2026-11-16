import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("forgotTitle") };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <AuthCard
      title={t("forgotTitle")}
      lead={t("forgotLead")}
      footer={
        <Link className="link" href="/sign-in">
          {t("backToSignIn")}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
