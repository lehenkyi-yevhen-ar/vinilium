/**
 * The colour theme. The design system (public/ds/tokens.css) defines two themes and ONE mechanism: the `data-theme` attribute on
 * <html>. Dark is its default (`:root, [data-theme="dark"]`); light is `[data-theme="light"]`. The design system has no
 * prefers-color-scheme rule and no switching code, so everything here only decides WHICH of those two values goes on <html>.
 *
 * The person's choice is one of three, kept in ONE local-storage key (never a cookie, never sent anywhere):
 *   dark    the design system's default theme
 *   light
 *   system  follow the device (prefers-color-scheme), resolved to dark or light
 * Nothing stored (a first visit, or storage blocked) = DEFAULT_THEME.
 */
export const THEME_KEY = "vinilium:theme";
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "dark" | "light";

/** The design system's own default. Change this one line to make "follow the device" the default for first-time visitors instead. */
export const DEFAULT_THEME: Theme = "dark";

export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);
export const parseTheme = (v: unknown): Theme => (isTheme(v) ? v : DEFAULT_THEME);
export const resolveTheme = (theme: Theme, systemPrefersLight: boolean): ResolvedTheme => (theme === "light" || (theme === "system" && systemPrefersLight) ? "light" : "dark");

/**
 * Runs in <head>, before the first paint, so the page never flashes the wrong theme. A STATIC string (no request data in it), served as
 * the file /theme-init.js (src/app/theme-init.js/route.ts) so the Content-Security-Policy can allow it with 'self'. It mirrors
 * `resolveTheme`; a unit test runs it against a table of cases and checks both agree. Every access to storage and matchMedia is guarded.
 */
export const THEME_SCRIPT_PATH = "/theme-init.js";

export const themeInitScript =
  `(function(){var d=document.documentElement,p="${DEFAULT_THEME}";` +
  `try{var s=localStorage.getItem("${THEME_KEY}");if(s==="dark"||s==="light"||s==="system")p=s}catch(e){}` +
  `var l=p==="light";` +
  `if(p==="system"){try{l=matchMedia("(prefers-color-scheme: light)").matches}catch(e){}}` +
  `d.dataset.theme=l?"light":"dark"})()`;
