import { getTranslations } from "next-intl/server";
import { site } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { ButtonLink } from "@/ds/ButtonLink";
import { UserIcon } from "@/ds/icons";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { SignOutButton } from "./SignOutButton";

export async function SiteHeader({ signedIn, userName }: { signedIn: boolean; userName?: string }) {
  const t = await getTranslations("nav");

  return (
    <header className="site-header">
      <div className="container">
        <nav className="navbar glass" aria-label={t("primary")}>
          <Link href="/" className="navbar__logo">
            {site.name}
          </Link>
          <div className="navbar__actions pill-group">
            <LocaleSwitcher signedIn={signedIn} />
            {signedIn ? (
              <>
                <ButtonLink href="/account" variant="ghost" className="x-hide-mobile">
                  <UserIcon />
                  <span>{userName ?? t("account")}</span>
                </ButtonLink>
                <span className="x-hide-mobile">
                  <SignOutButton />
                </span>
              </>
            ) : (
              <>
                <ButtonLink href="/sign-in" variant="ghost" className="x-hide-mobile">
                  {t("signIn")}
                </ButtonLink>
                <ButtonLink href="/sign-up" variant="outline" className="x-hide-mobile">
                  {t("signUp")}
                </ButtonLink>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
