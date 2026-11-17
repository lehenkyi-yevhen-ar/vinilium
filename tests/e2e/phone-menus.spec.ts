import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";
import { inspectOpenMenu, type MenuReport } from "../helpers/phone-menus";

/**
 * The header's dropdown menus (language, theme) and the other overlays at PHONE widths: 375x667 and 390x844, touch emulation, dark and
 * light, signed out and signed in. The design system opens a menu as a bottom sheet at 640px and below; our header used to trap it
 * (the navbar's backdrop-filter is the containing block of fixed descendants, and the sticky header's stacking context sat below the
 * design system's scrim): the menu opened above the trigger, partly off the screen, under the scrim. Every test here measures where
 * the menu really is and what is on top of it (elementFromPoint), not just that it is "visible".
 *
 * DEV database and the MOCKED Discogs only. The signed-in tests need the DEV database (sign-in); the signed-out ones do not.
 */
test.setTimeout(150_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];
const SCHEMES = ["dark", "light"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEME_KEY = "vinilium:theme";
// The language menu is the header's other dropdown; not found by its (translated) label, which changes with the language.
const LANG_ROOT = ".navbar .dd:not(.x-theme)";
const THEME_ROOT = ".navbar .x-theme";
const HEADINGS = { en: "Find the exact pressing.", uk: "Знайдіть саме те видання.", nb: "Finn akkurat den utgivelsen." } as const;

let ipCounter = 0;
const nextIp = () => `203.0.113.${100 + (ipCounter++ % 90)}`;

interface PhoneOptions {
  viewport: { width: number; height: number };
  scheme: "dark" | "light";
  signedIn?: boolean;
}

/** A phone-sized, touch-enabled context. The theme is chosen the way a person would: through the theme switcher's storage key. */
async function phoneContext(browser: Browser, baseURL: string | undefined, o: PhoneOptions): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport: o.viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    colorScheme: o.scheme,
    storageState: o.signedIn ? "tests/.auth/user.json" : { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": nextIp() },
  });
  await context.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
    [THEME_KEY, o.scheme],
  );
  return context;
}

async function expectSheetOk(page: Page, report: MenuReport, count: number) {
  const where = JSON.stringify({ menu: report.menu, viewport: report.viewport });
  expect(report.sheetMediaQuery, "phone width: the design system's bottom sheet applies").toBe(true);
  expect(report.menuPosition).toBe("fixed");
  expect(report.insideViewport, `the whole menu is inside the screen ${where}`).toBe(true);
  expect(report.menu.top, "it opens at the bottom of the screen, not above the trigger").toBeGreaterThan(report.trigger.bottom);
  expect(report.menuCentre, "nothing (no scrim, no blur layer) is on top of the menu").toEqual(expect.objectContaining({ isMenu: true }));
  expect(report.options).toHaveLength(count);
  for (const o of report.options) {
    expect(o.fullyInside, `${o.label} is fully on screen`).toBe(true);
    expect(o.coveredBy, `${o.label} is not covered (elementFromPoint)`).toBeNull();
    expect(o.heightOk, `${o.label} is at least 44px tall`).toBe(true);
  }
  expect(report.scrim.on, "the design system's scrim is behind the menu").toBe(true);
  expect(report.scrollLocked, "no scroll lock is left behind").toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no horizontal overflow").toBe(0);
}

const open = async (page: Page, root: string) => {
  await page.locator(`${root} .dd__trigger`).tap();
  await expect(page.locator(`${root}.is-open`)).toHaveCount(1);
  await page.waitForTimeout(450); // the open transition
};

async function axeScan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => ({ rule: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })),
    `${label}: accessibility violations`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Language menu, signed out (needs no database)

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test.describe(`language menu ${viewport.width}x${viewport.height} ${scheme} (signed out)`, () => {
      for (const path of ["/en", "/en/search"]) {
        test(`${path}: opens inside the screen, above nothing else, with 44px rows; Esc and an outside tap close it`, async ({ browser, baseURL }) => {
          const context = await phoneContext(browser, baseURL, { viewport, scheme });
          const page = await context.newPage();
          await page.goto(path);
          await expect(page.locator("main")).toBeVisible();
          const trigger = page.locator(`${LANG_ROOT} .dd__trigger`);

          // closed: the trigger is a labelled, 44px-tall button; its accessible name starts with the visible text ("EN")
          await expect(trigger).toHaveAttribute("aria-expanded", "false");
          await expect(trigger).toHaveAttribute("aria-label", /^EN, Language: English$/);
          expect(await trigger.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

          await open(page, LANG_ROOT);
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator(`${LANG_ROOT} [role="menu"]`)).toBeVisible();
          await expect(page.locator(`${LANG_ROOT} [role="menuitem"]`)).toHaveCount(3);
          await expectSheetOk(page, await inspectOpenMenu(page, LANG_ROOT), 3);
          // the CURRENT language is the one highlighted and marked (a check mark and weight, not colour alone)
          await expect(page.locator(`${LANG_ROOT} .dd__opt.is-active`)).toHaveText("English");
          await expect(page.locator(`${LANG_ROOT} .dd__opt[aria-current="true"]`)).toHaveText("English");

          // Esc closes it, focus returns to the trigger, and nothing stays locked
          await page.keyboard.press("Escape");
          await expect(page.locator(`${LANG_ROOT}.is-open`)).toHaveCount(0);
          await expect(trigger).toHaveAttribute("aria-expanded", "false");
          await expect(trigger).toBeFocused();
          await expect(page.locator(".ds-scrim.is-on")).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.classList.contains("is-locked"))).toBe(false);

          // an outside tap closes it too
          await open(page, LANG_ROOT);
          await page.touchscreen.tap(20, 300);
          await expect(page.locator(`${LANG_ROOT}.is-open`)).toHaveCount(0);
          await expect(page.locator(".ds-scrim.is-on")).toHaveCount(0);
          await context.close();
        });
      }

      test("choosing each language changes the URL locale and the page text, and closes the menu", async ({ browser, baseURL }) => {
        const context = await phoneContext(browser, baseURL, { viewport, scheme });
        const page = await context.newPage();
        await page.goto("/en");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADINGS.en);

        for (const [code, label] of [["uk", "Українська"], ["nb", "Norsk bokmål"], ["en", "English"]] as const) {
          await open(page, LANG_ROOT);
          await page.locator(`${LANG_ROOT} .dd__opt`, { hasText: label }).tap();
          await expect(page).toHaveURL(new RegExp(`/${code}$`));
          await expect(page.locator("html")).toHaveAttribute("lang", code);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEADINGS[code]);
          await expect(page.locator(`${LANG_ROOT}.is-open`)).toHaveCount(0);
          await expect(page.locator(".ds-scrim.is-on")).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.classList.contains("is-locked"))).toBe(false);
        }
        // choosing the language that is already on closes it and puts focus back on the trigger (no navigation to hide it)
        await open(page, LANG_ROOT);
        await page.locator(`${LANG_ROOT} .dd__opt`, { hasText: "English" }).tap();
        await expect(page.locator(`${LANG_ROOT}.is-open`)).toHaveCount(0);
        await expect(page.locator(`${LANG_ROOT} .dd__trigger`)).toBeFocused();
        await context.close();
      });

      test("keyboard: opens with Enter, arrows move, Enter chooses; and the open state has no axe violations", async ({ browser, baseURL }) => {
        const context = await phoneContext(browser, baseURL, { viewport, scheme });
        const page = await context.newPage();
        await page.goto("/en");
        const trigger = page.locator(`${LANG_ROOT} .dd__trigger`);
        await trigger.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator(`${LANG_ROOT}.is-open`)).toHaveCount(1);
        await page.waitForTimeout(450);
        await axeScan(page, `language menu open (${scheme}, ${viewport.width}px)`);
        await page.keyboard.press("ArrowDown"); // English -> Norsk bokmål
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/nb$/);
        await context.close();
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Theme menu, signed out: the same sheet, in the same header

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`theme menu ${viewport.width}x${viewport.height} ${scheme}: inside the screen, uncovered, 44px rows; choosing changes the theme; Esc closes; axe`, async ({ browser, baseURL }) => {
      const context = await phoneContext(browser, baseURL, { viewport, scheme });
      const page = await context.newPage();
      await page.goto("/en");
      const trigger = page.locator(`${THEME_ROOT} .dd__trigger`);
      await expect(trigger).toHaveAttribute("aria-label", "Theme");
      expect(await trigger.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
      expect(await trigger.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

      await open(page, THEME_ROOT);
      await expectSheetOk(page, await inspectOpenMenu(page, THEME_ROOT), 3);
      await expect(page.locator(`${THEME_ROOT} .dd__opt[aria-current="true"]`)).toHaveText(new RegExp(`^${scheme === "dark" ? "Dark" : "Light"}`));
      await axeScan(page, `theme menu open (${scheme}, ${viewport.width}px)`);

      // choose the other theme: the design system's attribute flips, the menu closes, focus is back on the trigger
      const other = scheme === "dark" ? "light" : "dark";
      await page.locator(`${THEME_ROOT} .dd__opt[data-value="${other}"]`).tap();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await expect(page.locator(`${THEME_ROOT}.is-open`)).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe(other);

      // Esc closes it
      await open(page, THEME_ROOT);
      await page.keyboard.press("Escape");
      await expect(page.locator(`${THEME_ROOT}.is-open`)).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // only one menu is open at a time. A tap on the OTHER header button while a sheet is open is an outside tap: it dismisses the sheet
      // (the second tap then opens the other menu).
      await open(page, THEME_ROOT);
      await page.locator(`${LANG_ROOT} .dd__trigger`).tap({ force: true });
      await expect(page.locator(".navbar .dd.is-open")).toHaveCount(0);
      await open(page, LANG_ROOT);
      await expect(page.locator(".navbar .dd.is-open")).toHaveCount(1);
      await expect(page.locator(`${THEME_ROOT}.is-open`)).toHaveCount(0);
      await context.close();
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Signed in (needs the DEV database): the other overlays at phone width

test.describe("other widgets at phone width (signed in)", () => {
  const viewport = VIEWPORTS[0];
  let userId = "";

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "tests/.auth/user.json" });
    userId = (await (await ctx.request.get("http://localhost:3200/api/auth/get-session")).json())?.user?.id;
    await ctx.close();
  });

  const withPool = async (fn: (query: (sql: string, args?: unknown[]) => Promise<unknown>) => Promise<void>) => {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: e2eDatabaseUrl() }); // DEV database only
    try {
      await fn((sql, args) => pool.query(sql, args));
    } finally {
      await pool.end();
    }
  };
  test.beforeEach(async () => {
    expect(userId, "the e2e user is signed in (needs the DEV database)").toBeTruthy();
    await withPool(async (q) => {
      await q("delete from user_items where user_id = $1", [userId]);
      await q("insert into user_items (user_id, discogs_release_id, list, added_at, updated_at) values ($1, 820000001, 'wishlist', now(), now())", [userId]);
    });
  });
  test.afterAll(async () => {
    if (userId) await withPool(async (q) => void (await q("delete from user_items where user_id = $1", [userId])));
  });

  const centreIsInside = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { inside: !!top && el.contains(top), fully: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };
    }, selector);

  for (const scheme of SCHEMES) {
    test(`header menus when signed in (${scheme})`, async ({ browser, baseURL }) => {
      const context = await phoneContext(browser, baseURL, { viewport, scheme, signedIn: true });
      const page = await context.newPage();
      await page.goto("/en/search");
      await expect(page.locator("#finder-q")).toBeVisible(); // really signed in
      for (const root of [LANG_ROOT, THEME_ROOT]) {
        await open(page, root);
        await expectSheetOk(page, await inspectOpenMenu(page, root), 3);
        await page.keyboard.press("Escape");
        await expect(page.locator(`${root}.is-open`)).toHaveCount(0);
      }
      await context.close();
    });
  }

  test("account page: the language select opens as a sheet; the delete-account modal fits, is on top, and releases the page", async ({ browser, baseURL }) => {
    const context = await phoneContext(browser, baseURL, { viewport, scheme: "dark", signedIn: true });
    const page = await context.newPage();
    await page.goto("/en/account");
    // the account page's own language select (not the header's)
    const select = "main .dd";
    await page.locator(`${select} .dd__trigger`).tap();
    await expect(page.locator(`${select}.is-open`)).toHaveCount(1);
    await page.waitForTimeout(450);
    await expectSheetOk(page, await inspectOpenMenu(page, select), 3);
    await page.keyboard.press("Escape");

    // the account menu on a phone is the bottom tab bar: its Account item is a plain link and reachable
    await expect(page.locator(".tabbar").getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");

    // the confirmation modal
    const opener = page.getByRole("button", { name: /Delete my account/ });
    await opener.tap();
    const dialog = ".modal.is-open .modal__dialog";
    await expect(page.locator(dialog)).toBeVisible();
    await page.waitForTimeout(450);
    expect(await centreIsInside(page, dialog)).toEqual({ inside: true, fully: true });
    expect(await page.evaluate(() => document.documentElement.classList.contains("is-locked")), "the page is locked while the modal is open").toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal.is-open")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains("is-locked")), "the lock is released").toBe(false);
    await expect(opener).toBeFocused();
    await context.close();
  });

  test("lists: the Filters toggle reveals sort and page size inside the screen; the remove modal fits, is on top, and releases the page", async ({ browser, baseURL }) => {
    const context = await phoneContext(browser, baseURL, { viewport, scheme: "light", signedIn: true });
    const page = await context.newPage();
    await page.goto("/en/lists");
    await expect(page.getByTestId("library-item").first()).toBeVisible({ timeout: 30_000 });

    const toggle = page.getByRole("button", { name: /^Filters/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const id of ["#library-sort", "#library-size"]) {
      await expect(page.locator(id)).toBeVisible();
      expect(await centreIsInside(page, id), `${id} is on screen and not covered`).toEqual({ inside: true, fully: true });
      expect(await page.locator(id).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    const remove = page.getByRole("button", { name: /^Remove / }).first();
    await remove.tap();
    const dialog = ".modal.is-open .modal__dialog";
    await expect(page.locator(dialog)).toBeVisible();
    await page.waitForTimeout(450);
    expect(await centreIsInside(page, dialog)).toEqual({ inside: true, fully: true });
    for (const name of ["Keep it", "Remove"]) {
      const button = page.locator(dialog).getByRole("button", { name, exact: true });
      expect(await button.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Keep it" }).tap();
    await expect(page.locator(".modal.is-open")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains("is-locked"))).toBe(false);
    await expect(remove).toBeFocused();
    await context.close();
  });

  test('search: the "How to search" toggle opens and closes by touch without covering anything', async ({ browser, baseURL }) => {
    const context = await phoneContext(browser, baseURL, { viewport, scheme: "dark", signedIn: true });
    const page = await context.newPage();
    await page.goto("/en/search");
    const summary = page.locator("details.x-help summary");
    await expect(page.locator("details.x-help")).toHaveAttribute("open", "");
    expect(await summary.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await summary.tap();
    await expect(page.locator("details.x-help")).not.toHaveAttribute("open", "");
    expect(await centreIsInside(page, "#finder-q")).toEqual({ inside: true, fully: true });
    await summary.tap();
    await expect(page.locator("details.x-help")).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    await context.close();
  });
});
