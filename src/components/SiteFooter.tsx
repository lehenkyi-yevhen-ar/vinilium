import { useTranslations } from "next-intl";
import { site } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { DiscogsAttribution } from "./DiscogsAttribution";

export function SiteFooter() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__about">
          <strong className="navbar__logo">{site.name}</strong>
          <p>{t("tagline")}</p>
        </div>
        <div className="x-footer-notes">
          <DiscogsAttribution />
          {/* Wording is prescribed by the Discogs API Terms of Use (section "Discogs Intellectual Property"): keep it verbatim, in English. */}
          <span lang="en">{t("discogsNotice")}</span>
        </div>
        <nav className="x-footer-links" aria-label={t("linksLabel")}>
          <Link className="link link--quiet" href="/contact">
            {t("contact")}
          </Link>
        </nav>
        <div className="footer__legal">
          <span>
            © {year} {site.name}
          </span>
          <span>{t("fontsCredit")}</span>
          <span>{t("designSystem")}</span>
        </div>
      </div>
    </footer>
  );
}
