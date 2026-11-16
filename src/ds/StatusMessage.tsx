import type { ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, ClockIcon, ErrorIcon, InfoIcon } from "./icons";
import { cx } from "./classes";

export type StatusTone = "info" | "success" | "warning" | "error" | "throttled";

const icons = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertIcon,
  error: ErrorIcon,
  throttled: ClockIcon,
} as const;

/**
 * NOT part of the Ліс system (it has no inline alert), so this is built from its tokens in
 * ds-extensions.css. Status is conveyed by an icon and a visible title, never by colour alone.
 */
export function StatusMessage({
  tone = "info",
  title,
  children,
  actions,
  className,
}: {
  tone?: StatusTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = icons[tone];
  return (
    <div className={cx("x-status", `x-status--${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="x-status__icon" />
      <div className="x-status__body">
        {title ? <p className="x-status__title">{title}</p> : null}
        {children ? <div className="x-status__text">{children}</div> : null}
        {actions ? <div className="x-status__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
