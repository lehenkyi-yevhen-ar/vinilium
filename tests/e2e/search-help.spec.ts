import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * The "How to search" help on the search page, signed in, against the MOCKED Discogs server: open for a first-time visitor,
 * remembered as closed (local storage only, no cookie, nothing sent), the example that fills the form, the one-line hint under
 * each mode, and the tips link on an empty result. Desktop and 390 px wide (see the finder-nav-* projects).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): search needs a signed-in user.");
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);
const expect = baseExpect.configure({ timeout: 20_000 });
const RUN = Date.now().toString(36);

let walk = 0;
test.beforeEach(async ({ context }, testInfo) => {
  const base = testInfo.project.name.endsWith("390") ? 230 : 210;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${base + walk++}` });
});

const help = (page: Page) => page.locator("details.x-help");
const summary = (page: Page) => help(page).locator("summary");
const stored = (page: Page) => page.evaluate(() => window.localStorage.getItem("vinilium:search-help"));
const noOverflow = async (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

test("a first-time visitor sees the help open, with the three ways, the steps and the tips", async ({ page }) => {
  await page.goto("/en/search");
  await expect(summary(page)).toHaveText("How to search");
  await expect(help(page)).toHaveAttribute("open", "");
  // three ways to search
  await expect(help(page).getByText("By track name", { exact: false })).toBeVisible();
  await expect(help(page).getByText("By artist", { exact: false })).toBeVisible();
  await expect(help(page).getByText("By album title", { exact: false })).toBeVisible();
  // the flow, in order
  await expect(help(page).locator("ol li")).toHaveText([
    "Type a track and press Search.",
    "Pick the artist.",
    "Pick the album.",
    "Pick the exact pressing: country, year and label.",
    "Open the release card and add it to your Wishlist or Collection.",
  ]);
  // the tips the brief asked for
  const tips = help(page).locator("ul.x-help__list").last();
  await expect(tips.locator("li")).toHaveCount(6);
  await expect(tips).toContainText("optional artist field narrows");
  await expect(tips).toContainText("album or artist mode");
  await expect(tips).toContainText("Only vinyl is shown.");
  await expect(tips).toContainText("Coloured, deluxe and special editions");
  await expect(tips).toContainText("Other pressings without a master");
  await expect(tips).toContainText("Show more albums");
  await noOverflow(page);
  // nothing was stored just by looking
  expect(await stored(page)).toBeNull();
});

test("closing it is remembered on this device (local storage only, no cookie), and opening it again forgets it", async ({ page, context }) => {
  await page.goto("/en/search");
  await expect(help(page)).toHaveAttribute("open", "");
  const cookiesBefore = (await context.cookies()).map((c) => c.name).sort();

  await summary(page).click();
  await expect(help(page)).not.toHaveAttribute("open", "");
  expect(await stored(page)).toBe("closed");
  expect((await context.cookies()).map((c) => c.name).sort()).toEqual(cookiesBefore); // not a cookie
  expect(await page.evaluate(() => window.localStorage.length)).toBe(1); // the one setting, nothing else

  await page.reload();
  await expect(summary(page)).toBeVisible();
  await expect(help(page)).not.toHaveAttribute("open", ""); // stays closed
  await page.goto("/en/search?mode=artist&q=anything"); // and on other search addresses
  await expect(help(page)).not.toHaveAttribute("open", "");

  await summary(page).click(); // open it again: the setting is removed, so it is the default (open) from now on
  await expect(help(page)).toHaveAttribute("open", "");
  expect(await stored(page)).toBeNull();
  await page.reload();
  await expect(help(page)).toHaveAttribute("open", "");
});

test("it works from the keyboard", async ({ page }) => {
  await page.goto("/en/search");
  await expect(help(page)).toHaveAttribute("open", "");
  await summary(page).focus();
  await page.keyboard.press("Enter");
  await expect(help(page)).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(help(page)).toHaveAttribute("open", "");
});

test("a line under the input explains each mode", async ({ page }) => {
  await page.goto("/en/search");
  const hint = page.locator("#finder-q-help");
  await expect(hint).toHaveText("A song title. Add the artist below if the title is common.");
  await page.getByRole("button", { name: "Artist", exact: true }).click();
  await expect(hint).toHaveText("An artist or band name. You will then pick one of their albums.");
  await page.getByRole("button", { name: "Album", exact: true }).click();
  await expect(hint).toHaveText("An album title. Add the artist below to narrow it down.");
  await expect(page.locator("#finder-q")).toHaveAttribute("aria-describedby", /finder-q-help/);
});

test("the example fills the form (it does not search), announces itself, and a real search replaces it", async ({ page }) => {
  await page.goto("/en/search?mode=album&q=something");
  await page.getByRole("button", { name: "Fill in this example" }).click();
  await expect(page.getByText("Example filled in. Press Search.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Track", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#finder-q")).toHaveValue("One More Time");
  await expect(page.locator("#finder-by")).toHaveValue("Daft Punk");
  await expect(page).toHaveURL(/q=something/); // nothing was searched yet

  // the example is only a starting point: it can be edited, and searching works
  await page.locator("#finder-q").fill(`cdonly-${RUN}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/mode=track/);
  await expect(page.locator("#finder-q")).toHaveValue(`cdonly-${RUN}`); // not the example again
  await expect(page.getByText("No vinyl matches")).toBeVisible();
});

test("an empty result points to the tips, and the tips open without changing what is remembered", async ({ page }) => {
  await page.goto("/en/search");
  await expect(help(page)).toHaveAttribute("open", "");
  await summary(page).click(); // the person has closed the help earlier
  expect(await stored(page)).toBe("closed");

  await page.locator("#finder-q").fill(`cdonly-${RUN}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No vinyl matches")).toBeVisible();
  await expect(page.getByText("Need ideas? See the search tips.")).toBeVisible();
  await expect(help(page)).not.toHaveAttribute("open", "");

  await page.getByRole("button", { name: "Show search tips" }).click();
  await expect(help(page)).toHaveAttribute("open", "");
  await expect(summary(page)).toBeFocused();
  await expect(summary(page)).toBeInViewport();
  expect(await stored(page)).toBe("closed"); // opening it from here does not undo the person's choice
  await noOverflow(page);
});

for (const [locale, title, hint, example, empty] of [
  ["uk", "Як шукати", "Назва пісні. Додайте виконавця нижче, якщо назва поширена.", "Підставити цей приклад", "Показати поради"],
  ["nb", "Slik søker du", "En sangtittel. Legg til artisten under hvis tittelen er vanlig.", "Fyll inn dette eksemplet", "Vis søketips"],
] as const) {
  test(`the help speaks ${locale}`, async ({ page }) => {
    await page.goto(`/${locale}/search`);
    await expect(summary(page)).toHaveText(title);
    await expect(help(page)).toHaveAttribute("open", "");
    await expect(page.locator("#finder-q-help")).toHaveText(hint);
    await expect(help(page).getByRole("button", { name: example })).toBeVisible();
    await expect(help(page).locator("ol li")).toHaveCount(5);
    await expect(help(page).locator("ul.x-help__list").last().locator("li")).toHaveCount(6);
    await noOverflow(page);
    await page.goto(`/${locale}/search?mode=track&q=cdonly-${RUN}`);
    await expect(page.getByRole("button", { name: empty })).toBeVisible();
  });
}

// Opt-in: E2E_SHOTS=<folder> saves screenshots of the help for a visual check (not an assertion; nothing runs without the variable).
test("screenshots of the help (only with E2E_SHOTS)", async ({ page }, testInfo) => {
  test.skip(!process.env.E2E_SHOTS, "set E2E_SHOTS=<folder> to save screenshots");
  const dir = process.env.E2E_SHOTS!;
  const tag = testInfo.project.name;
  await page.goto("/en/search");
  await expect(help(page)).toHaveAttribute("open", "");
  await page.screenshot({ path: `${dir}/${tag}-help-open.png` });
  await page.screenshot({ path: `${dir}/${tag}-help-open-full.png`, fullPage: true });
  await summary(page).click();
  await page.screenshot({ path: `${dir}/${tag}-help-closed.png` });
  await page.locator("#finder-q").fill(`cdonly-${RUN}`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No vinyl matches")).toBeVisible();
  await page.screenshot({ path: `${dir}/${tag}-empty-result.png`, fullPage: true });
});
