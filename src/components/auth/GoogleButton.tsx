"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";

export function GoogleButton({ next }: { next?: string | null }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    // Better Auth redirects the browser to Google; on return it lands on callbackURL.
    await authClient.signIn.social({ provider: "google", callbackURL: `/${locale}${next ?? ""}` });
    setPending(false);
  }

  return (
    <Button variant="outline" block loading={pending} onClick={onClick}>
      {t("continueWithGoogle")}
    </Button>
  );
}
