"use client";

import "@/lib/zod-jitless"; // first: see the file (no `Function("")` probe under the CSP)

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { Field } from "@/ds/Field";
import { StatusMessage } from "@/ds/StatusMessage";
import { GoogleButton } from "./GoogleButton";
import { PasswordField } from "./PasswordField";
import { fieldErrors, useAuthError } from "./use-auth-error";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const consent = useTranslations("signUpConsent");
  const locale = useLocale();
  const router = useRouter();
  const authError = useAuthError();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const schema = z.object({
      name: z.string().trim().min(1, t("validation.nameRequired")).max(80),
      email: z.string().trim().min(1, t("validation.emailRequired")).pipe(z.email(t("validation.emailInvalid"))),
      password: z.string().min(8, t("validation.passwordShort")).max(128, t("errors.PASSWORD_TOO_LONG")),
    });
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { error } = await authClient.signUp.email({
      ...parsed.data,
      locale,
      // After the user clicks the link in the email they land here, already signed in.
      callbackURL: `/${locale}/verify-email/done`,
    });
    if (error) {
      setPending(false);
      return setFormError(authError(error));
    }
    router.replace({ pathname: "/verify-email", query: { email: parsed.data.email } });
  }

  return (
    <form className="x-form" onSubmit={onSubmit} noValidate>
      {formError ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      <Field name="name" label={t("name")} autoComplete="name" error={errors.name} />
      <Field name="email" type="email" label={t("email")} autoComplete="email" inputMode="email" error={errors.email} />
      <PasswordField name="password" label={t("password")} help={t("passwordHelp")} autoComplete="new-password" error={errors.password} />
      <p className="x-note">
        {consent("consentPrefix")}{" "}
        <Link className="link" href="/terms">
          {consent("consentTerms")}
        </Link>{" "}
        {consent("consentAnd")}{" "}
        <Link className="link" href="/privacy">
          {consent("consentPrivacy")}
        </Link>
        .
      </p>
      <Button type="submit" block loading={pending}>
        {t("signUpSubmit")}
      </Button>
      {googleEnabled ? (
        <>
          <div className="x-divider" role="separator" aria-label={c("or")}>
            {c("or")}
          </div>
          <GoogleButton />
        </>
      ) : null}
    </form>
  );
}
