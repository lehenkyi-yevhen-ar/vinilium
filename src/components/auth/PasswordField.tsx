"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useState } from "react";
import { Button } from "@/ds/Button";
import { Field, type FieldProps } from "@/ds/Field";
import { EyeIcon, EyeOffIcon } from "@/ds/icons";

/** Password input with a show/hide toggle (44px target, labelled, keyboard accessible). */
export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, "type" | "trailing">>(function PasswordField(props, ref) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);

  return (
    <Field
      ref={ref}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      spellCheck={false}
      trailing={
        <Button
          variant="ghost"
          icon
          size="sm"
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      }
      {...props}
    />
  );
});
