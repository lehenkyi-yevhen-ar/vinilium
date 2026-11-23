import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StatusMessage } from "@/ds/StatusMessage";
import { ConsentNote } from "./ConsentNote";
import { GoogleButton } from "./GoogleButton";

/**
 * What the sign-in, sign-up, forgot-password, reset-password and verify-email screens show when AUTH_EMAIL_PASSWORD_ENABLED is
 * off: a plain message and the Google button (or, with no Google configured, an honest "not available" and a way to reach us).
 */
export function EmailPasswordOff({ googleEnabled, next }: { googleEnabled: boolean; next?: string | null }) {
  const t = useTranslations("auth");
  return googleEnabled ? (
    <div className="x-form" data-testid="email-password-off">
      <StatusMessage tone="info">{t("emailPasswordOffText")}</StatusMessage>
      <GoogleButton next={next} />
      <ConsentNote google />
    </div>
  ) : (
    <div className="x-form" data-testid="email-password-off">
      <StatusMessage tone="warning">
        {t("emailPasswordOffNoGoogle")}{" "}
        <Link className="link" href="/contact">
          {t("emailNotArrivedLink")}
        </Link>
      </StatusMessage>
    </div>
  );
}
