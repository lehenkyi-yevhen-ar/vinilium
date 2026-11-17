import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * The theme switcher: on every screen, signed out and signed in; the choice changes the design system's `data-theme` attribute on <html>,
 * is remembered in ONE local-storage key (no cookie), is applied before the first paint, and nothing breaks when storage is blocked.
 * Desktop and 390px wide (the theme-* projects). Mocked Discogs and the DEV database only; the signed-in tests need the DEV database.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const KEY = "vinilium:theme";
const ROOT = ".navbar .x-theme";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SIGNED_OUT = { cookies: [], origins: [] };
const PAGES = ["/en", "/en/search", "/en/lists", "/en/account", "/en/contact", "/en/privacy", "/en/terms", "/en/sign-in", "/en/sign-up", "/uk", "/nb"];

let walk = 0;
test.beforeEach(async ({ context }, testInfo) => {
  const base = testInfo.project.name.endsWith("390") ? 150 : 110;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${base + (walk++ % 30)}` });
});

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const openMenu = async (page: Page) => {
  await page.locator(`${ROOT} .dd__trigger`).click();
  await expect(page.locator(`${ROOT}.is-open`)).toHaveCount(1);
  await page.waitForTimeout(450);
};
const choose = async (page: Page, value: "dark" | "light" | "system") => {
  await openMenu(page);
  await page.locator(`${ROOT} .dd__opt[data-value="${value}"]`).click();
  await expect(page.locator(`${ROOT}.is-open`)).toHaveCount(0);
};

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  for (const path of PAGES) {
    test(`${path}: the switcher is in the header, labelled, reachable, 44px`, async ({ page }) => {
      await page.goto(path);
      const trigger = page.locator(`${ROOT} .dd__trigger`);
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-label", /^(Theme|Тема|Tema)$/);
      const box = (await trigger.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "inside the screen, not pushed off the side").toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no horizontal overflow").toBe(0);
      // reachable by keyboard: the language and theme buttons are in the tab order of the header
      await trigger.focus();
      await expect(trigger).toBeFocused();
    });
  }

  test("a first-time visitor gets the design system's default (dark), whatever the device prefers; nothing is stored by looking", async ({ browser, baseURL }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ baseURL, colorScheme, storageState: SIGNED_OUT, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.140" } });
      const page = await context.newPage();
      await page.goto("/en");
      expect(await theme(page)).toBe("dark");
      expect(await stored(page)).toBeNull();
      expect((await context.cookies()).map((c) => c.name)).toEqual([]);
      await context.close();
    }
  });

  test("choosing a theme flips data-theme, is remembered in one local-storage key (no cookie), and survives reload and client navigation", async ({ page, context }) => {
    await page.goto("/en");
    expect(await theme(page)).toBe("dark");
    const cookiesBefore = (await context.cookies()).map((c) => c.name).sort();

    await choose(page, "light");
    expect(await theme(page)).toBe("light");
    expect(await stored(page)).toBe("light");
    expect(await page.evaluate(() => localStorage.length)).toBe(1); // the one setting
    expect((await context.cookies()).map((c) => c.name).sort()).toEqual(cookiesBefore); // not a cookie

    // the menu marks the current choice with text and a check
    await openMenu(page);
    await expect(page.locator(`${ROOT} .dd__opt[aria-current="true"]`)).toHaveText(/^Light/);
    await page.keyboard.press("Escape");

    // reload: still light
    await page.reload();
    expect(await theme(page)).toBe("light");

    // client navigation (no full reload): still light
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    await page.getByRole("contentinfo").getByRole("link", { name: "Contact" }).click();
    await expect(page).toHaveURL(/\/en\/contact$/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker), "it was a client navigation, not a reload").toBe(1);
    expect(await theme(page)).toBe("light");

    // and back to dark; changing the language keeps the theme too
    await choose(page, "dark");
    expect(await theme(page)).toBe("dark");
    expect(await stored(page)).toBe("dark");
    await page.locator('.navbar .dd:not(.x-theme) .dd__trigger').click();
    await page.locator('.navbar .dd:not(.x-theme) .dd__opt', { hasText: "Norsk bokmål" }).click();
    await expect(page).toHaveURL(/\/nb\//);
    expect(await theme(page)).toBe("dark");
  });

  test('"system" follows the device, live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    await choose(page, "system");
    expect(await stored(page)).toBe("system");
    expect(await theme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => theme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toBe("light");
    await page.reload(); // and it is applied before the first paint on the next visit
    expect(await theme(page)).toBe("light");
    // choosing a fixed theme stops following the device
    await choose(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(300);
    expect(await theme(page)).toBe("dark");
  });

  test("no flash: the attribute is set once, directly to the stored theme, before the first paint", async ({ page }) => {
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, "light");
      } catch {
        /* blocked */
      }
      const w = window as unknown as { __themeLog: Array<{ value: string | null; at: number }> };
      w.__themeLog = [];
      // on `document`, because <html> does not exist yet when this runs
      new MutationObserver(() => w.__themeLog.push({ value: document.documentElement.getAttribute("data-theme"), at: performance.now() })).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }, KEY);
    await page.goto("/en");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(500); // let hydration finish: it must not change the attribute either
    const { log, firstPaint } = await page.evaluate(() => ({
      log: (window as unknown as { __themeLog: Array<{ value: string | null; at: number }> }).__themeLog,
      firstPaint: performance.getEntriesByName("first-paint")[0]?.startTime ?? null,
    }));
    expect(log.map((l) => l.value), "set once, to light, never to dark first").toEqual(["light"]);
    expect(firstPaint, "the browser reported a first paint").not.toBeNull();
    expect(log[0].at, "the theme was set before the first paint").toBeLessThan(firstPaint!);
  });

  test("with storage blocked the page still works: default theme, no errors, the choice lasts until reload", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.addInitScript(() => {
      // what a browser with blocked site data does: touching localStorage throws
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await theme(page)).toBe("dark");
    await expect(page.locator(`${ROOT} .dd__trigger`)).toBeVisible();

    await choose(page, "light"); // changes now, cannot be remembered
    expect(await theme(page)).toBe("light");
    await page.getByRole("contentinfo").getByRole("link", { name: "Contact" }).click();
    await expect(page).toHaveURL(/\/en\/contact$/);
    expect(await theme(page), "kept while the page is open").toBe("light");
    await page.reload();
    expect(await theme(page), "not remembered: the default again").toBe("dark");
    expect(errors).toEqual([]);
  });

  test("a damaged stored value falls back to the default instead of breaking the page", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '{"not":"a theme"}'), KEY);
    await page.goto("/en");
    expect(await theme(page)).toBe("dark");
    await expect(page.locator(`${ROOT} .dd__trigger`)).toBeVisible();
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`axe: ${scheme} theme, with the theme menu open and with the language menu open`, async ({ page }) => {
      await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, scheme]);
      await page.goto("/en");
      expect(await theme(page)).toBe(scheme);
      await openMenu(page);
      for (const label of ["theme menu open"]) {
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => ({ rule: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })), `${scheme}: ${label}`).toEqual([]);
      }
      await page.keyboard.press("Escape");
      await page.locator('.navbar .dd:not(.x-theme) .dd__trigger').click();
      await page.waitForTimeout(450);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations.map((v) => ({ rule: v.id, help: v.help })), `${scheme}: language menu open`).toEqual([]);
    });
  }
});

test.describe("signed in (needs the DEV database)", () => {
  test.use({ storageState: "tests/.auth/user.json" });

  for (const path of ["/en", "/en/search", "/en/lists", "/en/account"]) {
    test(`${path}: the switcher is there when signed in, and a choice made here is kept on the next page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("link", { name: /E2E User|Account/ }).first()).toBeVisible(); // really signed in
      await expect(page.locator(`${ROOT} .dd__trigger`)).toBeVisible();
      await choose(page, "light");
      expect(await theme(page)).toBe("light");
      await page.goto(path === "/en/lists" ? "/en/account" : "/en/lists");
      expect(await theme(page)).toBe("light");
      await expect(page.locator(`${ROOT} .dd__trigger`)).toBeVisible();
    });
  }
});

// Opt-in: E2E_SHOTS=<folder> saves screenshots of both themes at 390px (not an assertion; nothing runs without the variable).
if (process.env.E2E_SHOTS)
test("screenshots of both themes at 390px (only with E2E_SHOTS)", async ({ browser, baseURL }, testInfo) => {
  if (!testInfo.project.name.endsWith("390")) return; // the 390px project only
  const dir = process.env.E2E_SHOTS!;
  for (const signedIn of [false, true]) {
    for (const scheme of ["dark", "light"] as const) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: signedIn ? "tests/.auth/user.json" : SIGNED_OUT,
        extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${180 + (signedIn ? 2 : 0) + (scheme === "dark" ? 0 : 1)}` },
      });
      await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, scheme]);
      const page = await context.newPage();
      for (const [name, path] of [["home", "/en"], ["search", "/en/search"], ["lists", "/en/lists"]] as const) {
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${dir}/${signedIn ? "signedin" : "signedout"}-${name}-${scheme}.png` });
      }
      await page.goto("/en");
      await page.locator(`${ROOT} .dd__trigger`).tap();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/${signedIn ? "signedin" : "signedout"}-theme-menu-open-${scheme}.png` });
      await context.close();
    }
  }
});
