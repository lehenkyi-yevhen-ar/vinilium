import { useTranslations } from "next-intl";
import { cx } from "@/ds/classes";

/**
 * "Data provided by Discogs." with a link to the matching discogs.com page (API Terms of Use: the notice must sit
 * directly next to the data and the link must NOT use nofollow or anything else that withholds ranking credit).
 * Render this directly next to EVERY block of Discogs data (search results, release card, lists),
 * not only in the footer. Pass the specific page (release, master, artist) as `href` when known.
 */
export function DiscogsAttribution({
  href = "https://www.discogs.com",
  className,
}: {
  href?: string;
  className?: string;
}) {
  const t = useTranslations("footer");
  return (
    <p className={cx("x-source", className)}>
      <a className="link link--quiet" href={href} target="_blank" rel="noopener noreferrer">
        {t("dataProvidedBy")}
      </a>
    </p>
  );
}
