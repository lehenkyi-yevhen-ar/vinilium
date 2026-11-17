import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { emailPasswordEnabled } from "@/lib/auth-flags";
import { googleEnabled } from "@/lib/env";
import { EmailPasswordOff } from "@/components/auth/EmailPasswordOff";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot-password">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("forgotTitle") };
}

/** Read per request: AUTH_EMAIL_PASSWORD_ENABLED must take effect after a redeploy without a rebuild. */
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });

  if (!emailPasswordEnabled()) {
    return (
      <AuthCard title={t("forgotTitle")}>
        <EmailPasswordOff googleEnabled={googleEnabled()} />
      </AuthCard>
    );
  }

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
