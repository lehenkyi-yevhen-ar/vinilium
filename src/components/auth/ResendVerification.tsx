"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { StatusMessage } from "@/ds/StatusMessage";
import { EmailNotArrived } from "./EmailNotArrived";
import { useAuthError } from "./use-auth-error";

export function ResendVerification({ email }: { email: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const authError = useAuthError();
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setState("pending");
    setError(null);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: `/${locale}/verify-email/done` });
    if (error) {
      setError(authError(error));
      return setState("idle");
    }
    setState("sent");
  }

  return (
    <div className="x-form">
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {state === "sent" ? <StatusMessage tone="success">{t("verifyResent")}</StatusMessage> : null}
      <EmailNotArrived />
      <Button variant="outline" block loading={state === "pending"} onClick={onClick}>
        {t("verifyResend")}
      </Button>
    </div>
  );
}
