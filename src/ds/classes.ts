export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "accent" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Class list for .btn (shared by <Button> and <ButtonLink>). */
export function buttonClass(o: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  round?: boolean;
  block?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const { variant = "primary", size = "md", icon, round, block, loading, className } = o;
  return cx(
    "btn",
    `btn--${variant}`,
    size !== "md" && `btn--${size}`,
    icon && "btn--icon",
    round && "btn--round",
    block && "btn--block",
    loading && "is-loading",
    className,
  );
}
