"use client";

import "@/lib/zod-jitless"; // first: see the file (no `Function("")` probe under the CSP)

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { StatusMessage } from "@/ds/StatusMessage";
import { PasswordField } from "./PasswordField";
import { fieldErrors, useAuthError } from "./use-auth-error";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const authError = useAuthError();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const schema = z.object({
      newPassword: z.string().min(8, t("validation.passwordShort")).max(128, t("errors.PASSWORD_TOO_LONG")),
    });
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: parsed.data.newPassword, token });
    if (error) {
      setPending(false);
      return setFormError(authError(error));
    }
    router.replace({ pathname: "/sign-in", query: { reset: "1" } });
  }

  return (
    <form className="x-form" onSubmit={onSubmit} noValidate>
      {formError ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      <PasswordField name="newPassword" label={t("newPassword")} help={t("passwordHelp")} autoComplete="new-password" error={errors.newPassword} />
      <Button type="submit" block loading={pending}>
        {t("resetSubmit")}
      </Button>
    </form>
  );
}
