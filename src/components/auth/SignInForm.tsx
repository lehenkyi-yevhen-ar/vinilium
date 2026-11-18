"use client";

import "@/lib/zod-jitless"; // first: see the file (no `Function("")` probe under the CSP)

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Link, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { Field } from "@/ds/Field";
import { StatusMessage } from "@/ds/StatusMessage";
import { EmailNotArrived } from "./EmailNotArrived";
import { GoogleButton } from "./GoogleButton";
import { PasswordField } from "./PasswordField";
import { fieldErrors, useAuthError } from "./use-auth-error";

export function SignInForm({ googleEnabled, next, resetDone }: { googleEnabled: boolean; next: string | null; resetDone?: boolean }) {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const authError = useAuthError();

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Signing in with an unverified address sends a fresh verification email: that screen gets the "nothing arrived?" note too.
  const [mailSent, setMailSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setMailSent(false);

    const schema = z.object({
      email: z.string().trim().min(1, t("validation.emailRequired")).pipe(z.email(t("validation.emailInvalid"))),
      password: z.string().min(1, t("validation.passwordRequired")),
    });
    const parsed = schema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { data, error } = await authClient.signIn.email(parsed.data);
    if (error || !data) {
      setPending(false);
      setMailSent(error?.code === "EMAIL_NOT_VERIFIED");
      return setFormError(authError(error));
    }

    // Honour the language saved on the account.
    const saved = (data.user as { locale?: string }).locale as Locale | undefined;
    const target = saved && routing.locales.includes(saved) ? saved : locale;
    router.replace(next ?? "/", { locale: target });
    router.refresh();
  }

  return (
    <form className="x-form" onSubmit={onSubmit} noValidate>
      {resetDone ? <StatusMessage tone="success">{t("resetDone")}</StatusMessage> : null}
      {formError ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      {mailSent ? <EmailNotArrived /> : null}
      <Field name="email" type="email" label={t("email")} autoComplete="email" inputMode="email" error={errors.email} />
      <PasswordField name="password" label={t("password")} autoComplete="current-password" error={errors.password} />
      <Link className="link x-link-block" href="/forgot-password">
        {t("forgotPassword")}
      </Link>
      <Button type="submit" block loading={pending}>
        {t("signInSubmit")}
      </Button>
      {googleEnabled ? (
        <>
          <div className="x-divider" role="separator" aria-label={c("or")}>
            {c("or")}
          </div>
          <GoogleButton next={next} />
        </>
      ) : null}
    </form>
  );
}
