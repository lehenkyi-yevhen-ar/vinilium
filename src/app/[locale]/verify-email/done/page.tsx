import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { ButtonLink } from "@/ds/ButtonLink";
import { StatusMessage } from "@/ds/StatusMessage";
import { getSession } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify-email/done">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("verifyTitle") };
}

/** Landing page after the user clicks the link in the verification email. */
export default async function VerifyEmailDonePage({ params, searchParams }: PageProps<"/[locale]/verify-email/done">) {
  const locale = await resolveLocale(params);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "auth" });
  const common = await getTranslations({ locale, namespace: "common" });
  const failed = Boolean(sp.error);
  // After a successful verification Better Auth signs the user in, so they can continue straight on.
  const continueToApp = !failed && Boolean(await getSession());

  return (
    <AuthCard title={t("verifyTitle")}>
      <div className="x-form">
        {failed ? (
          <StatusMessage tone="error">{t("verifyFailed")}</StatusMessage>
        ) : (
          <StatusMessage tone="success">{t("verifyDone")}</StatusMessage>
        )}
        <ButtonLink href={continueToApp ? "/account" : "/sign-in"} block>
          {continueToApp ? common("continue") : t("signInSubmit")}
        </ButtonLink>
      </div>
    </AuthCard>
  );
}
