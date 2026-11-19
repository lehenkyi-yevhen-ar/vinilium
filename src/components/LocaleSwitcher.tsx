"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { authClient } from "@/lib/auth-client";
import { setDropdownValue, useDS } from "@/ds/use-ds";
import { GlobeIcon } from "@/ds/icons";

/**
 * Language switcher built on the design system's dropdown (`.dd`). The locale lives in the URL;
 * for signed-in users it is also saved on their account so it is remembered across devices.
 * NOTE: DS.init(scope) only wires DESCENDANTS of scope, so the ref sits on a wrapper, not on .dd itself.
 *   variant="menu"   compact globe button for the navbar
 *   variant="select" labelled select for the account page
 */
export function LocaleSwitcher({
  signedIn,
  variant = "menu",
}: {
  signedIn: boolean;
  variant?: "menu" | "select";
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("nav");
  const tl = useTranslations("locales");
  const pathname = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useDS(ref);
  // The menu highlights the CURRENT language when it opens (the design system reads data-value once, so tell it when it changes).
  useEffect(() => setDropdownValue(ref.current, locale), [locale]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<{ value: string }>).detail.value as Locale;
      if (!routing.locales.includes(next) || next === locale) return;
      if (signedIn) {
        // Fire and forget: the URL is the source of truth for this request.
        void authClient.updateUser({ locale: next }).catch(() => {});
      }
      router.replace(`${pathname}${window.location.search}`, { locale: next });
    };
    el.addEventListener("dd:change", onChange);
    return () => el.removeEventListener("dd:change", onChange);
  }, [locale, pathname, router, signedIn]);

  const options = routing.locales.map((l) => (
    <div key={l} className="dd__opt" data-value={l} data-label={tl(l)} lang={l} aria-current={l === locale ? "true" : undefined}>
      {tl(l)}
    </div>
  ));

  if (variant === "select") {
    return (
      <div className="x-contents" ref={ref}>
        <div className="dd" data-dd data-value={locale}>
          {/* The accessible name must CONTAIN the visible text (WCAG 2.5.3 Label in Name): voice control says "click English". */}
          <button type="button" className="select dd__trigger" aria-label={`${t("language")}: ${tl(locale)}`}>
            <span className="dd__value">{tl(locale)}</span>
          </button>
          <div className="dd__menu glass-strong">{options}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="x-contents" ref={ref}>
      {/* data-value: the design system highlights (and scrolls to) the CURRENT language when the menu opens, not the first row. */}
      <div className="dd dd--right" data-dd="menu" data-value={locale}>
        {/* Visible text is the short code ("EN"): the accessible name starts with it (WCAG 2.5.3 Label in Name). */}
        <button type="button" className="btn btn--ghost dd__trigger" aria-label={`${locale.toUpperCase()}, ${t("language")}: ${tl(locale)}`}>
          <GlobeIcon />
          <span aria-hidden="true">{locale.toUpperCase()}</span>
        </button>
        <div className="dd__menu glass-strong">{options}</div>
      </div>
    </div>
  );
}
