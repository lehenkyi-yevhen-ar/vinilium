import { useTranslations } from "next-intl";
import { site } from "@/config/site";
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
          <span>{t("discogsNotice", { appName: site.name })}</span>
        </div>
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
