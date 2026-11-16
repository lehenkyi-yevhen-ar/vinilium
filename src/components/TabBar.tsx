"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { HomeIcon, UserIcon } from "@/ds/icons";

/** Mobile bottom navigation (shown up to 640px by the design system). Sections are added per milestone. */
export function TabBar({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const items = [
    { href: "/", label: t("home"), icon: <HomeIcon />, match: (p: string) => p === "/" },
    signedIn
      ? { href: "/account", label: t("account"), icon: <UserIcon />, match: (p: string) => p.startsWith("/account") }
      : { href: "/sign-in", label: t("signIn"), icon: <UserIcon />, match: (p: string) => p.startsWith("/sign-") || p.startsWith("/forgot") },
  ];

  return (
    <nav className="tabbar tabbar--mobile glass" aria-label={t("primary")}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="tabbar__item" aria-current={item.match(pathname) ? "page" : undefined}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
