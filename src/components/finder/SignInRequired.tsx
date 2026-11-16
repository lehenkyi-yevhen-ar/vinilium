import { useTranslations } from "next-intl";
import { ButtonLink } from "@/ds/ButtonLink";
import { LockIcon } from "@/ds/icons";
import { StatusMessage } from "@/ds/StatusMessage";

/**
 * Search is for signed-in users (the Discogs Terms forbid handing the Content to third parties, and the API budget is
 * shared). Public pages stay public; the search screens show this instead of results.
 */
export function SignInRequired({ next = "/search", expired, compact }: { next?: string; expired?: boolean; compact?: boolean }) {
  const t = useTranslations("signInRequired");
  const actions = (
    <>
      <ButtonLink href={{ pathname: "/sign-in", query: { next } }} size="sm">
        {t("signIn")}
      </ButtonLink>
      <ButtonLink href="/sign-up" size="sm" variant="outline">
        {t("signUp")}
      </ButtonLink>
    </>
  );

  if (compact) {
    return (
      <StatusMessage tone="info" title={t("title")} actions={actions}>
        {expired ? t("expired") : t("text")}
      </StatusMessage>
    );
  }
  return (
    <div className="container x-page">
      <div className="x-narrow">
        <div className="x-card x-signin-required">
          <LockIcon className="x-signin-required__icon" />
          <h1>{t("title")}</h1>
          <p className="x-lead">{expired ? t("expired") : t("text")}</p>
          <div className="x-actions">{actions}</div>
        </div>
      </div>
    </div>
  );
}
