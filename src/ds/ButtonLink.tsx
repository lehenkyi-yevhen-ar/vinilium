import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./classes";

type Props = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  round?: boolean;
  block?: boolean;
};

/** A locale-aware link that looks like a `.btn` (navigation, not an action). */
export function ButtonLink({ variant, size, icon, round, block, className, ...rest }: Props) {
  return <Link className={buttonClass({ variant, size, icon, round, block, className })} {...rest} />;
}
