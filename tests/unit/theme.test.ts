import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, parseTheme, resolveTheme, THEME_KEY, THEME_SCRIPT_PATH, THEMES, themeInitScript, type Theme } from "@/lib/theme";

/**
 * The theme choice and the script that applies it before the first paint. The script is a plain string run in <head>, so these tests
 * RUN it against a fake document, storage and matchMedia, including a blocked storage, and check it agrees with `resolveTheme`.
 */

interface Env {
  stored?: string | null;
  storageThrows?: boolean;
  deviceLight?: boolean;
  matchMediaThrows?: boolean;
}

function runScript(env: Env): string | undefined {
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  const localStorage = {
    getItem: (k: string) => {
      if (env.storageThrows) throw new DOMException("blocked", "SecurityError");
      return k === THEME_KEY ? (env.stored ?? null) : null;
    },
  };
  const matchMedia = (q: string) => {
    if (env.matchMediaThrows) throw new Error("no matchMedia");
    return { matches: q.includes("light") ? Boolean(env.deviceLight) : false };
  };
  new Function("document", "localStorage", "matchMedia", themeInitScript)(document, localStorage, matchMedia);
  return document.documentElement.dataset.theme;
}

describe("theme choice", () => {
  it("dark is the design system's default, and anything else stored falls back to it", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme("")).toBe("dark");
    expect(parseTheme("DARK")).toBe("dark");
    expect(parseTheme("purple")).toBe("dark");
    expect(parseTheme({})).toBe("dark");
    for (const t of THEMES) expect(parseTheme(t)).toBe(t);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("blue")).toBe(false);
  });

  it("resolves to the two values the design system knows: dark and light", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("the script that runs in <head>", () => {
  const cases: Array<[string, Env, "dark" | "light"]> = [
    ["nothing stored: the default (dark), even on a light device", { stored: null, deviceLight: true }, "dark"],
    ["dark chosen on a light device", { stored: "dark", deviceLight: true }, "dark"],
    ["light chosen on a dark device", { stored: "light", deviceLight: false }, "light"],
    ["system on a light device", { stored: "system", deviceLight: true }, "light"],
    ["system on a dark device", { stored: "system", deviceLight: false }, "dark"],
    ["garbage stored: the default", { stored: "{\"theme\":\"light\"}", deviceLight: true }, "dark"],
    ["wrong case stored: the default", { stored: "Light" }, "dark"],
    ["storage blocked: the default, no exception", { storageThrows: true, deviceLight: true }, "dark"],
    ["system but matchMedia missing: dark, no exception", { stored: "system", matchMediaThrows: true }, "dark"],
    ["light chosen, matchMedia missing: still light", { stored: "light", matchMediaThrows: true }, "light"],
  ];
  for (const [name, env, expected] of cases) {
    it(name, () => expect(runScript(env)).toBe(expected));
  }

  it("agrees with resolveTheme for every stored value and device", () => {
    for (const stored of THEMES) {
      for (const deviceLight of [true, false]) {
        expect(runScript({ stored, deviceLight }), `${stored} / light device: ${deviceLight}`).toBe(resolveTheme(stored as Theme, deviceLight));
      }
    }
  });

  it("is static (no request data) and small", () => {
    expect(themeInitScript).not.toMatch(/\$\{|`/);
    expect(themeInitScript.length).toBeLessThan(400);
    expect(themeInitScript).toContain(THEME_KEY);
  });

  it("is served as the file /theme-init.js, byte for byte, as JavaScript, cacheable", async () => {
    // A file, not an inline script: the Content-Security-Policy allows it with 'self', with no hash to keep in step with the script.
    const { GET, dynamic } = await import("@/app/theme-init.js/route");
    expect(THEME_SCRIPT_PATH).toBe("/theme-init.js");
    expect(dynamic).toBe("force-static");
    const res = GET();
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(await res.text()).toBe(themeInitScript);
  });

  it("is never inlined into a page: no inline script exists anywhere in the app's source (the CSP forbids them)", () => {
    const dir = path.resolve(__dirname, "../../src");
    const sources: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(e.name)) sources.push(full);
      }
    };
    walk(dir);
    const offenders = sources.filter((f) => /dangerouslySetInnerHTML|<script(?![^>]*\/>)[^>]*>\s*[^<\s]/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(dir, f))).toEqual([]);
  });
});
