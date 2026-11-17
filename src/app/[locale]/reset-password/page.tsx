import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { emailPasswordEnabled } from "@/lib/auth-flags";
import { googleEnabled } from "@/lib/env";
import { EmailPasswordOff } from "@/components/auth/EmailPasswordOff";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { StatusMessage } from "@/ds/StatusMessage";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("resetTitle") };
}

const tokenSchema = z.string().min(8).max(256);

/** Read per request: AUTH_EMAIL_PASSWORD_ENABLED must take effect after a redeploy without a rebuild. */
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ params, searchParams }: PageProps<"/[locale]/reset-password">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });

  if (!emailPasswordEnabled()) {
    return (
      <AuthCard title={t("resetTitle")}>
        <EmailPasswordOff googleEnabled={googleEnabled()} />
      </AuthCard>
    );
  }

  // Better Auth redirects here with ?token=... on success, or ?error=INVALID_TOKEN.
  const token = tokenSchema.safeParse(sp.token);
  const valid = token.success && !sp.error;

  return (
    <AuthCard
      title={t("resetTitle")}
      footer={
        <Link className="link" href={valid ? "/sign-in" : "/forgot-password"}>
          {valid ? t("backToSignIn") : t("forgotTitle")}
        </Link>
      }
    >
      {valid ? <ResetPasswordForm token={token.data} /> : <StatusMessage tone="error">{t("resetInvalid")}</StatusMessage>}
    </AuthCard>
  );
}
