"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { Field } from "@/ds/Field";
import { StatusMessage } from "@/ds/StatusMessage";
import { EmailNotArrived } from "./EmailNotArrived";
import { fieldErrors, useAuthError } from "./use-auth-error";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const authError = useAuthError();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const schema = z.object({
      email: z.string().trim().min(1, t("validation.emailRequired")).pipe(z.email(t("validation.emailInvalid"))),
    });
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: `/${locale}/reset-password`,
    });
    setPending(false);
    // Same answer whether or not the account exists (no account enumeration). Only real failures
    // such as rate limiting are shown.
    if (error && error.status === 429) return setFormError(authError(error));
    setSent(true);
  }

  if (sent) {
    return (
      <div className="x-form">
        <StatusMessage tone="success">{t("forgotSent")}</StatusMessage>
        <EmailNotArrived />
      </div>
    );
  }

  return (
    <form className="x-form" onSubmit={onSubmit} noValidate>
      {formError ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      <Field name="email" type="email" label={t("email")} autoComplete="email" inputMode="email" error={errors.email} />
      <Button type="submit" block loading={pending}>
        {t("forgotSubmit")}
      </Button>
    </form>
  );
}
