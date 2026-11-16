import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./classes";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: one per screen · accent: promo only · danger: irreversible, always inside a confirm Modal. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon button. `aria-label` is required. */
  icon?: boolean;
  round?: boolean;
  block?: boolean;
  loading?: boolean;
}

/** Wrapper over the design system's `.btn` classes (same markup as upstream DS.Button). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, round, block, loading, className, type = "button", disabled, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, icon, round, block, loading, className })}
      disabled={disabled || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    />
  );
});
