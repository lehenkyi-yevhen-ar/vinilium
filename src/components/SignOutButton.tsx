"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { LogOutIcon } from "@/ds/icons";

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <Button variant="ghost" icon={iconOnly} loading={pending} onClick={onClick} aria-label={iconOnly ? t("signOut") : undefined}>
      <LogOutIcon />
      {iconOnly ? null : t("signOut")}
    </Button>
  );
}
