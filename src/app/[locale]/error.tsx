"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/ds/Button";
import { ButtonLink } from "@/ds/ButtonLink";

/**
 * The page for an unexpected error under a locale: it renders inside the layout (header, footer, the person's language and theme).
 * It shows no error text, stack or digest: the details are in the server log, and an error message can carry things a visitor must not see.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  const n = useTranslations("notFound");
  return (
    <div className="container x-page">
      <section className="x-empty" role="alert">
        <h1 className="t-h2">{t("title")}</h1>
        <p>{t("text")}</p>
        <div className="x-actions">
          <Button onClick={() => reset()}>{t("retry")}</Button>
          <ButtonLink href="/" variant="outline">
            {n("home")}
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
