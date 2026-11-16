"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./classes";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  help?: ReactNode;
  /** Error text: replaces the help, turns on the error state and aria-invalid. */
  error?: string;
  /** Marks the field optional. Required fields are not marked. */
  optionalLabel?: string;
  /** Trailing control inside the input (e.g. a show-password button). */
  trailing?: ReactNode;
  wrapperClassName?: string;
}

/**
 * `.field` > `.field__label` + `.input` + `.field__help`. The label is always above the field and the
 * error text says how to fix the problem (a word, never colour alone).
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, help, error, optionalLabel, trailing, id, className, wrapperClassName, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  const hasHelp = Boolean(error || help);

  return (
    <div className={cx("field", error && "is-error", wrapperClassName)}>
      <label className="field__label" htmlFor={inputId}>
        {label}
        {optionalLabel ? <span className="opt"> · {optionalLabel}</span> : null}
      </label>
      <div className="x-input-row">
        <input
          ref={ref}
          id={inputId}
          className={cx("input", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasHelp ? helpId : undefined}
          {...rest}
        />
        {trailing ? <div className="x-input-trailing">{trailing}</div> : null}
      </div>
      {hasHelp ? (
        <div className="field__help" id={helpId} role={error ? "alert" : undefined}>
          {error ?? help}
        </div>
      ) : null}
    </div>
  );
});
