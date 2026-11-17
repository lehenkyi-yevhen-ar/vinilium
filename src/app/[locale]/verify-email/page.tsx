import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { emailPasswordEnabled } from "@/lib/auth-flags";
import { googleEnabled } from "@/lib/env";
import { EmailPasswordOff } from "@/components/auth/EmailPasswordOff";
import { EmailNotArrived } from "@/components/auth/EmailNotArrived";
import { ResendVerification } from "@/components/auth/ResendVerification";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-email">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("verifyTitle") };
}

/** Read per request: AUTH_EMAIL_PASSWORD_ENABLED must take effect after a redeploy without a rebuild. */
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ params, searchParams }: PageProps<"/[locale]/verify-email">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });
  if (!emailPasswordEnabled()) {
    return (
      <AuthCard title={t("verifyTitle")}>
        <EmailPasswordOff googleEnabled={googleEnabled()} />
      </AuthCard>
    );
  }

  const email = z.email().max(254).safeParse(sp.email);

  return (
    <AuthCard
      title={t("verifyTitle")}
      lead={email.success ? t("verifyLead", { email: email.data }) : undefined}
      footer={
        <Link className="link" href="/sign-in">
          {t("backToSignIn")}
        </Link>
      }
    >
      {email.success ? <ResendVerification email={email.data} /> : <EmailNotArrived />}
    </AuthCard>
  );
}
