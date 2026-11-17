import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";

/**
 * Automated accessibility audit (axe-core, WCAG 2.0/2.1/2.2 A and AA rules) of the main screens, run in LIGHT and DARK themes on a
 * desktop viewport and once on a phone viewport (see the a11y-* projects in playwright.config.ts). The theme follows the OS colour
 * scheme, which each project sets. A scan only finds what a tool can find: keyboard, focus and screen-reader wording are checked
 * separately (keyboard.spec.ts) and by hand (docs/operations.md, "Accessibility checks").
 *
 * Runs against the MOCKED Discogs server and the DEV database (never production).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch).");
test.setTimeout(120_000);

const MOCK = "http://localhost:3201";
const BASE = 810_000_000 + (Date.now() % 80_000_000);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 2).join(" ") })),
  }));
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Signed-out pages (and in three languages)

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const pages: Array<[string, string]> = [
    ["/en", "home"],
    ["/en/sign-in", "sign in"],
    ["/en/sign-up", "sign up"],
    ["/en/forgot-password", "forgot password"],
    ["/en/contact", "contact"],
    ["/en/search", "search (sign-in required)"],
    ["/en/lists", "lists (sign-in required)"],
    ["/en/privacy", "privacy policy"],
    ["/en/terms", "terms"],
    ["/uk", "home (uk)"],
    ["/uk/sign-in", "sign in (uk)"],
    ["/uk/privacy", "privacy (uk)"],
    ["/nb", "home (nb)"],
    ["/nb/sign-up", "sign up (nb)"],
    ["/nb/terms", "terms (nb)"],
  ];
  for (const [url, label] of pages) {
    test(`${label}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("main h1").first()).toBeVisible();
      await settle(page);
      await scan(page, label);
    });
  }

  test("sign in with an error message showing", async ({ page }) => {
    await page.goto("/en/sign-in");
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await scan(page, "sign in with errors");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Signed-in pages

test.describe("signed in", () => {
  let userId = "";
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "tests/.auth/user.json" });
    userId = (await (await ctx.request.get("http://localhost:3200/api/auth/get-session")).json())?.user?.id;
    await ctx.close();
  });

  test.beforeEach(async () => {
    expect(userId, "the e2e user is signed in").toBeTruthy();
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: e2eDatabaseUrl() }); // DEV database only
    try {
      await pool.query("delete from user_items where user_id = $1", [userId]);
      await pool.query(
        `insert into user_items (user_id, discogs_release_id, list, notes, condition_media, condition_sleeve, added_at, updated_at)
         select $1, (r->>'id')::bigint, r->>'list', r->>'notes', r->>'media', r->>'sleeve', now(), now() from jsonb_array_elements($2::jsonb) r`,
        [
          userId,
          JSON.stringify([
            { id: BASE + 1, list: "wishlist", notes: "first press" },
            { id: BASE + 2, list: "wishlist" },
            { id: BASE + 3, list: "collection", notes: "bought in Oslo", media: "NM", sleeve: "VG+" },
            { id: BASE + 4, list: "collection" },
            { id: 404404, list: "collection", notes: "lost release" },
          ]),
        ],
      );
    } finally {
      await pool.end();
    }
    await fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify({ throttleNext: 0 }) });
  });

  test.afterAll(async () => {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: e2eDatabaseUrl() });
    try {
      if (userId) await pool.query("delete from user_items where user_id = $1", [userId]);
    } finally {
      await pool.end();
    }
  });

  test("search: artist step", async ({ page }) => {
    await page.goto("/en/search?mode=artist&q=cobalt%20a11y");
    await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
    await settle(page);
    await scan(page, "search artist step");
  });

  test("search: albums step", async ({ page }) => {
    await page.goto("/en/search?mode=artist&q=cobalt%20a11y&g=cobalt+parade");
    await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
    await settle(page);
    await scan(page, "search albums step");
  });

  test("pressings of an album", async ({ page }) => {
    await page.goto("/en/master/500?t=Glass%20Harbor&a=Cobalt%20Parade");
    await expect(page.getByRole("heading", { level: 1, name: /Pressings of/ })).toBeVisible();
    await settle(page);
    await scan(page, "pressings");
  });

  test("release card", async ({ page }) => {
    await page.goto("/en/release/1001");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settle(page);
    await scan(page, "release card");
  });

  test("Wishlist", async ({ page }) => {
    await page.goto("/en/lists");
    await expect(page.getByTestId("library-item").first()).toBeVisible();
    await expect(page.locator(".x-result__title a").first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await scan(page, "wishlist");
  });

  test("Collection, with a release that is gone from Discogs", async ({ page }) => {
    await page.goto("/en/lists?list=collection");
    await expect(page.getByTestId("library-gone")).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await scan(page, "collection");
  });

  test("Wishlist with the filters open and a note being edited", async ({ page }) => {
    await page.goto("/en/lists");
    await expect(page.getByTestId("library-item").first()).toBeVisible();
    const toggle = page.getByRole("button", { name: /^Filters/ });
    if (await toggle.isVisible()) await toggle.click();
    await page.getByRole("button", { name: /^Edit notes|^Add notes/ }).first().click();
    await expect(page.getByRole("textbox", { name: /^Notes for/ })).toBeVisible();
    await settle(page);
    await scan(page, "wishlist with filters and notes editor");
  });

  test("the remove confirmation dialog", async ({ page }) => {
    await page.goto("/en/lists");
    await expect(page.locator(".x-result__title a").first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Remove / }).first().click();
    await expect(page.locator("#library-remove-modal .modal__dialog")).toBeVisible();
    await page.waitForTimeout(400); // the dialog's opening animation
    await scan(page, "remove dialog");
  });

  test("an empty list", async ({ page }) => {
    await page.goto("/en/lists?q=zzzz-no-such-note");
    await expect(page.getByTestId("library-empty")).toBeVisible();
    await scan(page, "no results");
  });

  test("account", async ({ page }) => {
    await page.goto("/en/account");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settle(page);
    await scan(page, "account");
  });

  test("account: the delete-account dialog", async ({ page }) => {
    await page.goto("/en/account");
    await page.getByRole("button", { name: /Delete/i }).first().click();
    await page.waitForTimeout(400);
    await scan(page, "delete account dialog");
  });

  for (const lang of ["uk", "nb"] as const) {
    test(`Wishlist and account in ${lang}`, async ({ page }) => {
      await page.goto(`/${lang}/lists`);
      await expect(page.getByTestId("library-item").first()).toBeVisible();
      await expect(page.locator(".x-result__title a").first()).toBeVisible({ timeout: 30_000 });
      await settle(page);
      await scan(page, `wishlist (${lang})`);
      await page.goto(`/${lang}/account`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await settle(page);
      await scan(page, `account (${lang})`);
    });
  }
});
