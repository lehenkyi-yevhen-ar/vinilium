import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { APP_ONLY_PATHS, PUBLIC_PAGES } from "@/lib/seo";

/** Robots, sitemap, manifest and icons: public pages only, an installable app, and NO service worker or offline cache (Discogs Terms). */

const ROOT = path.resolve(__dirname, "../..");

describe("robots.txt", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;

  it("allows the site, keeps crawlers out of the API and every locale's app screens", () => {
    expect(rule.userAgent).toBe("*");
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    expect(disallow).toContain("/api/");
    for (const locale of ["uk", "en", "nb"]) for (const p of ["/search", "/master/", "/release/", "/lists", "/account", "/sign-in", "/sign-up"]) expect(disallow, `/${locale}${p}`).toContain(`/${locale}${p}`);
    expect(disallow).toEqual([...APP_ONLY_PATHS]);
  });

  it("never disallows a public page, and points at the sitemap", () => {
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    for (const locale of ["uk", "en", "nb"]) for (const p of PUBLIC_PAGES) expect(disallow.some((d) => `/${locale}${p}`.startsWith(d) && d !== "/"), `/${locale}${p}`).toBe(false);
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("sitemap.xml", () => {
  const entries = sitemap();

  it("lists the public pages in every language, with their translations, and nothing else", () => {
    const urls = entries.map((e) => new URL(e.url).pathname).sort();
    const expected = ["uk", "en", "nb"].flatMap((l) => PUBLIC_PAGES.map((p) => `/${l}${p}`)).sort();
    expect(urls).toEqual(expected);
    for (const e of entries) {
      expect(Object.keys(e.alternates?.languages ?? {}).sort()).toEqual(["en", "nb", "uk"]);
      expect(e.url).not.toMatch(/\/api\/|\/search|\/lists|\/account|\/release|\/master|\/sign-/);
    }
  });
});

describe("web app manifest and icons", () => {
  const m = manifest();

  it("is installable: name, standalone display, start URL, 192 and 512 icons and a maskable one, in the design system's colours", () => {
    expect(m.name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.background_color).toBe("#121611"); // --sand-950
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("every icon file exists and is a real PNG of the size it claims", () => {
    for (const icon of m.icons ?? []) {
      const file = path.join(ROOT, "public", icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const buf = readFileSync(file);
      expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const [w] = (icon.sizes ?? "0x0").split("x").map(Number);
      expect(buf.readUInt32BE(16)).toBe(w);
      expect(buf.readUInt32BE(20)).toBe(w);
    }
    expect(statSync(path.join(ROOT, "src/app/favicon.ico")).size).toBeGreaterThan(100);
    expect(existsSync(path.join(ROOT, "src/app/icon.svg"))).toBe(true);
    expect(existsSync(path.join(ROOT, "src/app/apple-icon.png"))).toBe(true);
  });

  it("there is NO service worker and no offline cache anywhere: the Discogs Terms forbid keeping Content past the 6-hour limit", () => {
    const publicFiles = readdirSync(path.join(ROOT, "public"), { recursive: true }).map(String);
    expect(publicFiles.filter((f) => /(^|[\\/])(sw|service-?worker|workbox)[^\\/]*\.js$/i.test(f))).toEqual([]);
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(ROOT, f)).not.toMatch(/serviceWorker|navigator\.serviceWorker|caches\.open|workbox/);
    }
  });
});

describe("publicMetadata", () => {
  it("makes a public page indexable with a canonical address, its translations and Open Graph, and no image", async () => {
    const { publicMetadata, OG_LOCALE } = await import("@/lib/seo");
    const m = publicMetadata("nb", "/privacy", { title: "Personvern", description: "Beskrivelse" });
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.alternates?.canonical).toMatch(/\/nb\/privacy$/);
    expect(Object.keys(m.alternates?.languages ?? {}).sort()).toEqual(["en", "nb", "uk"]);
    expect(m.openGraph).toMatchObject({ type: "website", title: "Personvern", description: "Beskrivelse", locale: OG_LOCALE.nb });
    expect(JSON.stringify(m)).not.toMatch(/"images"/);
  });

  it("the locale layout makes everything else noindex, and only the four public pages opt in", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    const optIn = ["page.tsx", "contact/page.tsx", "privacy/page.tsx", "terms/page.tsx"].filter((f) => /publicMetadata\(/.test(readFileSync(path.join(ROOT, "src/app/[locale]", f), "utf8")));
    expect(optIn).toEqual(["page.tsx", "contact/page.tsx", "privacy/page.tsx", "terms/page.tsx"]);
    for (const f of ["search", "lists", "account", "sign-in", "release/[id]", "master/[id]"]) {
      const file = path.join(ROOT, "src/app/[locale]", f, "page.tsx");
      if (existsSync(file)) expect(readFileSync(file, "utf8"), f).not.toMatch(/publicMetadata\(/);
    }
  });
});
