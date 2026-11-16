"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/ds/Button";
import { StatusMessage } from "@/ds/StatusMessage";
import { PasswordField } from "./auth/PasswordField";
import { useAuthError } from "./auth/use-auth-error";
import { XIcon } from "@/ds/icons";
import { useDS } from "@/ds/use-ds";

const MODAL_ID = "delete-account-modal";
const FORM_ID = "delete-account-form";

/** Danger zone: a destructive action always sits behind a confirmation modal (design system rule). */
export function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("account");
  const c = useTranslations("common");
  const router = useRouter();
  const authError = useAuthError();
  const root = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDS(root);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const password = hasPassword ? String(new FormData(e.currentTarget).get("password") ?? "") : undefined;
    if (hasPassword && !password) return setError(authError({ code: "INVALID_PASSWORD" }));

    setPending(true);
    // Deletes the user; sessions, accounts and (later) list items go with it via ON DELETE CASCADE.
    const { error } = await authClient.deleteUser(password ? { password } : {});
    if (error) {
      setPending(false);
      return setError(authError(error));
    }
    router.replace({ pathname: "/", query: { deleted: "1" } });
    router.refresh();
  }

  return (
    <div ref={root}>
      <Button variant="outline" onClick={(e) => window.DS?.modal(MODAL_ID).open(e.currentTarget)}>
        {t("dangerButton")}
      </Button>

      <div className="modal" id={MODAL_ID} data-role="alertdialog">
        <div className="modal__overlay" />
        <div className="modal__dialog">
          <div className="modal__head">
            <h3 className="modal__title">{t("confirmTitle")}</h3>
            <button type="button" className="modal__close btn btn--ghost btn--icon btn--sm" data-close aria-label={c("cancel")}>
              <XIcon />
            </button>
          </div>
          <div className="modal__body">
            <p>{t("confirmText")}</p>
            <form id={FORM_ID} className="x-form" onSubmit={onSubmit} noValidate>
              {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
              {hasPassword ? (
                <PasswordField name="password" label={t("confirmPasswordLabel")} autoComplete="current-password" />
              ) : null}
            </form>
          </div>
          <div className="modal__foot">
            <button type="button" className="btn btn--secondary" data-close autoFocus>
              {t("keepAccount")}
            </button>
            <Button type="submit" form={FORM_ID} variant="danger" loading={pending}>
              {t("confirmDelete")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
