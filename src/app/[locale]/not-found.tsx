import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** The 404 for every address under a locale (see [...rest]/page.tsx). Rendered inside the locale layout, so it speaks the person's language. */
export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="container x-page">
      <section className="x-empty">
        <h1 className="t-h2">{t("title")}</h1>
        <p>{t("text")}</p>
        <Link className="btn btn--outline" href="/">
          {t("home")}
        </Link>
      </section>
    </div>
  );
}
