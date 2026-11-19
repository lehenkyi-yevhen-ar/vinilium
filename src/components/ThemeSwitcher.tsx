"use client";

import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { DEFAULT_THEME, parseTheme, resolveTheme, THEME_KEY, type Theme } from "@/lib/theme";
import { setDropdownValue, useDS } from "@/ds/use-ds";
import { MonitorIcon, MoonIcon, SunIcon } from "@/ds/icons";

/**
 * Colour theme switcher for the header, on every screen. It is the design system's own dropdown (`.dd`, a bottom sheet on phones)
 * with three choices: dark (the design system's default), light, and "system" (follow the device). The choice lives in ONE local
 * storage key (lib/theme.ts), never in a cookie, and is applied to <html data-theme> (the design system's mechanism). A tiny
 * script in <head> applies it before the first paint (see the layout); this component changes it afterwards.
 */
const listeners = new Set<() => void>();
/** What was chosen in this page's lifetime: covers a browser that blocks storage (the choice then lasts until the page is reloaded). */
let chosen: Theme | null = null;

function readStored(): Theme {
  if (chosen !== null) return chosen;
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME; // storage blocked: behave like a first visit
  }
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    chosen = null; // another tab changed it: it wins over what this page chose earlier
    apply(readStored());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
function apply(theme: Theme) {
  let light = false;
  try {
    light = window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    /* no matchMedia: treat the device as dark */
  }
  document.documentElement.dataset.theme = resolveTheme(theme, light);
}
function choose(theme: Theme) {
  chosen = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the theme still changes now, it just is not remembered */
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function ThemeSwitcher() {
  const t = useTranslations("theme");
  const ref = useRef<HTMLDivElement>(null);
  useDS(ref);
  // Server render: the default; the browser then reports the stored choice and the current mark follows.
  const theme = useSyncExternalStore(subscribe, readStored, () => DEFAULT_THEME);

  // Changing the LANGUAGE swaps the whole <html> element (the locale is a route segment), and the new one has no data-theme: the script
  // in <head> does not run again on a client navigation. Put it back in the same commit, before the browser paints, so there is no
  // flash. On a normal load the attribute is already there (set by the script) and this does nothing.
  useLayoutEffect(() => {
    if (!document.documentElement.dataset.theme) apply(readStored());
  }, []);

  // For "system": follow the device while the page is open. (Nothing is applied on mount: the script in <head> already did, and the
  // server render's default must never override it.) The menu highlights the current choice when it opens.
  useEffect(() => {
    setDropdownValue(ref.current, theme);
    if (theme !== "system") return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return;
    }
    const onChange = () => {
      if (readStored() === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = (e: Event) => choose(parseTheme((e as CustomEvent<{ value: string }>).detail.value));
    el.addEventListener("dd:change", onChange);
    return () => el.removeEventListener("dd:change", onChange);
  }, []);

  const options: Array<{ value: Theme; label: string; hint?: string; icon: React.ReactNode }> = [
    { value: "dark", label: t("dark"), icon: <MoonIcon className="lead-ic" /> },
    { value: "light", label: t("light"), icon: <SunIcon className="lead-ic" /> },
    { value: "system", label: t("system"), hint: t("systemHint"), icon: <MonitorIcon className="lead-ic" /> },
  ];

  return (
    <div className="x-contents" ref={ref}>
      {/* data-value: the design system highlights the CURRENT choice when the menu opens. */}
      <div className="dd dd--right x-theme" data-dd="menu" data-value={theme}>
        {/* Icon-only trigger: its accessible name is "Theme". Which icon shows follows the real <html data-theme> in CSS, so the
            server markup never disagrees with the browser's. The current choice is marked inside the menu (text + check). */}
        <button type="button" className="btn btn--ghost btn--icon dd__trigger" aria-label={t("label")}>
          <MoonIcon className="x-theme__moon" />
          <SunIcon className="x-theme__sun" />
        </button>
        <div className="dd__menu glass-strong">
          {options.map((o) => (
            <div key={o.value} className={o.hint ? "dd__opt x-opt--hint" : "dd__opt"} data-value={o.value} data-label={o.label} aria-current={o.value === theme ? "true" : undefined}>
              {o.icon}
              <span>
                {o.label}
                {o.hint ? <small>{o.hint}</small> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
