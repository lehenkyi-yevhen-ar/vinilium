import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Shown next to every "we sent you an email" message. A failed send is logged on the server, not announced to the person: saying
 * "we could not email you" would tell a stranger that an address has an account. This note is the same for everyone.
 */
export function EmailNotArrived() {
  const t = useTranslations("auth");
  return (
    <p className="x-note" data-testid="email-not-arrived">
      {t("emailNotArrived")}{" "}
      <Link className="link" href="/contact">
        {t("emailNotArrivedLink")}
      </Link>
    </p>
  );
}
