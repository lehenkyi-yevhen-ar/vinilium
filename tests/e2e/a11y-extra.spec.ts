import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility beyond the axe scans of a11y.spec.ts: reflow at 320 CSS px (which is what 400% zoom on a 1280 px window gives; 200% is
 * 640 px), WCAG 1.4.12 text-spacing overrides, forced colours, reduced motion, 44 px targets and a visible focus indicator on whatever the
 * keyboard reaches. Three languages (Ukrainian and Norwegian run longer than English). Signed in pages use the e2e user; the data comes
 * from the MOCKED Discogs server and the DEV database (never production).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): the signed-in pages need a session.");
test.setTimeout(120_000);

const PUBLIC = ["", "/sign-in", "/sign-up", "/forgot-password", "/contact", "/privacy", "/terms", "/search", "/no-such-page"];
const SIGNED_IN = ["/search", "/search?mode=artist&q=cobalt%20reflow&g=cobalt+parade", "/master/500?t=Glass%20Harbor&a=Cobalt%20Parade", "/release/1001", "/lists", "/account"];
const LOCALES = ["en", "uk", "nb"] as const;

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
};

/** Elements that reach past the right edge of the viewport (horizontal scrolling is a reflow failure; fixed bars are measured too). */
const beyondEdge = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (el.closest("details:not([open]) > :not(summary)")) continue;
      if (r.right > window.innerWidth + 1 && r.left < window.innerWidth) out.push(`${el.tagName.toLowerCase()}.${(el.className?.toString() ?? "").split(" ")[0]} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 6);
  });

test.describe("reflow at 320 px (400% zoom) and 640 px (200%)", () => {
  for (const width of [320, 640]) {
    test.describe(`${width}px wide, signed out`, () => {
      test.use({ viewport: { width, height: 800 }, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${width === 320 ? 223 : 224}` } });
      for (const locale of LOCALES) {
        for (const p of PUBLIC) {
          test(`/${locale}${p}`, async ({ page }) => {
            await page.goto(`/${locale}${p}`);
            await settle(page);
            expect(await overflow(page), "no sideways scrolling").toBeLessThanOrEqual(0);
            expect(await beyondEdge(page), "nothing reaches past the right edge").toEqual([]);
          });
        }
      }
    });
    test.describe(`${width}px wide, signed in`, () => {
      test.use({ viewport: { width, height: 800 }, storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${width === 320 ? 225 : 226}` } });
      for (const locale of LOCALES) {
        for (const p of SIGNED_IN) {
          test(`/${locale}${p}`, async ({ page }) => {
            await page.goto(`/${locale}${p}`);
            await settle(page);
            expect(await overflow(page), "no sideways scrolling").toBeLessThanOrEqual(0);
            expect(await beyondEdge(page), "nothing reaches past the right edge").toEqual([]);
          });
        }
      }
    });
  }
});

test.describe("text spacing (WCAG 1.4.12): nothing is cut off or lost", () => {
  test.use({ viewport: { width: 390, height: 844 }, storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.227" } });
  const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;
  for (const locale of LOCALES) {
    for (const p of ["", "/sign-in", "/search", "/release/1001", "/lists", "/account"]) {
      test(`/${locale}${p}`, async ({ page }) => {
        await page.goto(`/${locale}${p}`);
        await settle(page);
        await page.addStyleTag({ content: SPACING });
        expect(await overflow(page), "no sideways scrolling").toBeLessThanOrEqual(0);
        const clipped = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("button, a, label, h1, h2, h3, p, li, summary, .btn, .dd__item")) {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || cs.display === "inline") continue;
            const hidden = cs.overflowX === "hidden" || cs.overflowY === "hidden" || cs.textOverflow === "ellipsis";
            if (hidden && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
          }
          return out.slice(0, 6);
        });
        expect(clipped, "no text clipped by its own box").toEqual([]);
      });
    }
  }
});

test.describe("forced colours (Windows high contrast)", () => {
  test.use({ storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.228" } });
  for (const p of ["/en", "/en/sign-in", "/en/search", "/en/release/1001", "/en/lists", "/en/account"]) {
    test(`${p}: controls keep a visible boundary and axe finds nothing`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto(p);
      await settle(page);
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), "forced colours are on").toBe(true);
      // a button or field must not be drawn by background colour alone: it needs a border or outline of its own in forced-colours mode
      const bare = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("main button, main input:not([type=hidden]), main select, main textarea, main a.btn")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          const border = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== "none");
          const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
          if (!border && !outline) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 24)}"`);
        }
        return out.slice(0, 8);
      });
      expect(bare, "controls with neither a border nor an outline").toEqual([]);
      // color-contrast is left out: in forced-colours mode the system picks the colours, and axe's contrast maths reads the pre-override ones
      // (a known tool limitation); contrast is covered by the normal light and dark scans in a11y.spec.ts.
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).disableRules(["color-contrast"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});

test.describe("reduced motion", () => {
  test.use({ storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.229" } });
  test("transitions and animations are switched off, and the menus and the dialog still work", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en/account");
    await settle(page);
    await page.locator(".modal__dialog").first().waitFor({ state: "attached" });
    const durations = await page.evaluate(() => ({
      dd: getComputedStyle(document.querySelector(".dd__menu")!).transitionDuration,
      dialog: getComputedStyle(document.querySelector(".modal__dialog")!).transitionDuration,
      overlay: getComputedStyle(document.querySelector(".modal__overlay")!).transitionDuration,
    }));
    for (const [what, d] of Object.entries(durations)) expect(d.split(",").every((x) => parseFloat(x) === 0), `${what} transition: ${d}`).toBe(true);
    await page.getByRole("button", { name: /Delete my account/ }).click();
    await expect(page.locator(".modal.is-open .modal__dialog")).toBeVisible();
    await page.waitForTimeout(400); // the dialog's script wires Escape and focus just after it opens (a person cannot press a key sooner)
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal.is-open")).toHaveCount(0);
  });
});

test.describe("touch targets (44 px) on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.230" } });
  for (const p of ["/en", "/en/sign-in", "/en/search", "/en/release/1001", "/en/lists", "/en/account", "/uk/search", "/nb/lists"]) {
    test(`${p}`, async ({ page }) => {
      await page.goto(p);
      await settle(page);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel = "button, a.btn, [role=button], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, summary, .dd__trigger, .tabbar a";
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden], .sr-only")) continue;
          if (el.closest(".modal:not(.is-open)")) continue;
          if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute("aria-label") || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out.slice(0, 8);
      });
      expect(small, "interactive controls smaller than 44x44 px").toEqual([]);
    });
  }
});

test.describe("focus is always visible", () => {
  test.use({ storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.231" } });
  for (const p of ["/en", "/en/sign-in", "/en/search", "/uk/search", "/en/release/1001", "/en/lists", "/nb/account"]) {
    test(`${p}: every stop on the keyboard path shows an indicator`, async ({ page }) => {
      await page.goto(p);
      await settle(page);
      const lost: string[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
          const shadow = cs.boxShadow !== "none";
          const r = el.getBoundingClientRect();
          return { label: `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`, visible: outline || shadow, onScreen: r.width > 0 && r.height > 0 };
        });
        if (state && state.onScreen && !state.visible) lost.push(state.label);
      }
      expect(lost, "focused elements without an outline or shadow").toEqual([]);
    });
  }
});
