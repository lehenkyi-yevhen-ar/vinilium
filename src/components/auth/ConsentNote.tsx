import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * "By creating an account you agree to the terms and have read the privacy policy", with links. Shown wherever an account can be
 * created: the sign-up form, and under the Google button (a first Google sign-in creates an account too, with no other notice).
 * `google` uses the conditional wording ("If signing in with Google creates a new account for you ...").
 */
export function ConsentNote({ google = false }: { google?: boolean }) {
  const consent = useTranslations("signUpConsent");
  return (
    <p className="x-note">
      {consent(google ? "consentPrefixGoogle" : "consentPrefix")}{" "}
      <Link className="link" href="/terms">
        {consent("consentTerms")}
      </Link>{" "}
      {consent("consentAnd")}{" "}
      <Link className="link" href="/privacy">
        {consent("consentPrivacy")}
      </Link>
      .
    </p>
  );
}
