import { expect, test, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";

/**
 * Keyboard behaviour, scripted: what a keyboard-only person needs and a scan cannot prove. Desktop viewport, signed in, MOCKED
 * Discogs and the DEV database. Anything that needs a human (is the order sensible? is the wording useful with a screen reader?)
 * is on the manual checklist in docs/operations.md.
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch).");
test.setTimeout(120_000);

const BASE = 820_000_000 + (Date.now() % 70_000_000);
let userId = "";

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "tests/.auth/user.json" });
  userId = (await (await ctx.request.get("http://localhost:3200/api/auth/get-session")).json())?.user?.id;
  await ctx.close();
  expect(userId).toBeTruthy();
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: e2eDatabaseUrl() }); // DEV database only
  try {
    await pool.query("delete from user_items where user_id = $1", [userId]);
    await pool.query(
      `insert into user_items (user_id, discogs_release_id, list, added_at, updated_at)
       select $1, ($2::bigint + g), 'wishlist', now() - (g || ' minutes')::interval, now() from generate_series(1, 14) g`,
      [userId, BASE],
    );
  } finally {
    await pool.end();
  }
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

const activeInfo = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? "", id: el?.id ?? "", text: (el?.textContent ?? "").trim().slice(0, 40), label: el?.getAttribute("aria-label") ?? "" };
  });

test("the skip link is the first stop and moves focus to the main content", async ({ page }) => {
  await page.goto("/en");
  await page.keyboard.press("Tab");
  const first = await activeInfo(page);
  expect(first.text).toBe("Skip to content");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await activeInfo(page)).id).toBe("main");
});

test("every stop on the main screens has a visible focus indicator, and nothing uses a positive tabindex", async ({ page }) => {
  for (const url of ["/en", "/en/sign-in", "/en/lists", "/en/account"]) {
    await page.goto(url);
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await page.locator("[tabindex]:not([tabindex='0']):not([tabindex='-1'])").count(), `${url}: positive tabindex`).toBe(0);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true; // wrapped around to the browser UI
        const cs = getComputedStyle(el);
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
        // a focused text field may draw its ring on a wrapper (design-system inputs): accept a focused-within wrapper too
        const wrapper = !!el.closest(".field, .select-wrap, .x-input-row") && getComputedStyle(el.closest(".field, .select-wrap, .x-input-row") as HTMLElement).boxShadow !== "none";
        return outline || ring || wrapper;
      });
      expect(visible, `${url}: stop ${i + 1} (${JSON.stringify(await activeInfo(page))}) has a visible focus indicator`).toBe(true);
    }
  }
});

test("the sign-in form can be completed and submitted from the keyboard", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").focus();
  await page.keyboard.type("nobody@example.test");
  await page.keyboard.press("Tab");
  expect((await activeInfo(page)).tag).toBe("INPUT"); // the password field comes next
  await page.keyboard.type("not-a-real-password");
  await page.keyboard.press("Enter"); // submits the form without a mouse
  await expect(page.getByRole("alert").first()).toBeVisible();
  await ctx.close();
});

test("lists: the notes editor takes focus, saves with the keyboard, and the dialog traps focus, closes with Escape and gives focus back", async ({ page }) => {
  await page.goto("/en/lists");
  await expect(page.locator(".x-result__title a").first()).toBeVisible({ timeout: 40_000 });

  // notes: opening the editor puts the cursor in the text box
  const first = page.getByTestId("library-item").first();
  await first.getByRole("button", { name: /^Add notes/ }).focus();
  await page.keyboard.press("Enter");
  await expect(first.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("typed without a mouse");
  await page.keyboard.press("Tab"); // character help text is not a stop; the next stop is Save
  await expect(first.getByRole("button", { name: "Save notes" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(first.getByTestId("item-notes")).toHaveText("typed without a mouse");
  await expect(page.getByTestId("library-notice")).toHaveText("Notes saved."); // the card's actions are disabled while its request is in flight

  // dialog: opened from a button, focus moves inside, Tab never leaves it, Escape closes and returns focus to the button
  const opener = first.getByRole("button", { name: /^Remove / });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("#library-remove-modal .modal__dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#library-remove-modal .modal__dialog")), `Tab ${i + 1} stays inside the dialog`).toBe(true);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#library-remove-modal .modal__dialog")), `Shift+Tab ${i + 1} stays inside the dialog`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // after a removal the focus is not lost: it goes to the page heading
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused(); // the design system moves focus in a moment after opening
  await page.keyboard.press("Tab"); // from "Keep it" to the confirm button
  await expect(page.getByTestId("confirm-remove")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("library-notice")).toHaveText("Removed from your lists.");
  await expect.poll(async () => (await activeInfo(page)).tag).toBe("H1");
});

test("lists: the pager, tabs, search box and selects are all reachable and operable with the keyboard", async ({ page }) => {
  await page.goto("/en/lists");
  await expect(page.getByTestId("library-item").first()).toBeVisible();

  await page.getByRole("button", { name: "Next page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");

  await page.getByLabel("Sort by").focus();
  await page.keyboard.press("ArrowDown"); // a native select changes with the arrow keys
  await expect(page).toHaveURL(/sort=added&dir=asc/);

  await page.getByLabel("Search your notes").focus();
  await page.keyboard.type("nothing-matches");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=nothing-matches/);
  await expect(page.getByTestId("library-empty")).toBeVisible();

  await page.getByRole("link", { name: /^Collection/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/list=collection/);
});

test("the language menu opens from the keyboard, closes with Escape and returns focus", async ({ page }) => {
  await page.goto("/en");
  const trigger = page.getByRole("button", { name: /Language/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  // The language menu's own dropdown: the header has two (language and theme), both `.dd--right`, so scope it to the trigger's menu.
  const menu = page.locator(".dd--right", { has: trigger }).locator(".dd__menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("each screen has its own, descriptive page title", async ({ page }) => {
  const titles = new Set<string>();
  for (const url of ["/en", "/en/sign-in", "/en/contact", "/en/search", "/en/lists", "/en/account", "/en/privacy", "/en/terms"]) {
    await page.goto(url);
    const title = await page.title();
    expect(title.trim().length, `${url} has a title`).toBeGreaterThan(2);
    titles.add(title);
  }
  expect(titles.size, "titles differ from page to page").toBeGreaterThanOrEqual(7);
});
