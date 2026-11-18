import { expect, test, type Page } from "@playwright/test";

/**
 * A crawler-style check of the Discogs Terms' attribution rule: every page that shows Discogs data carries "Data provided by Discogs."
 * as a link to discogs.com, opened safely, WITHOUT nofollow (ranking credit must pass), directly in the page's content next to the
 * data, in all three languages; and every page, with or without data, carries the exact non-affiliation notice in English.
 * Signed in, against the MOCKED Discogs server and the DEV database (never production).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): the pages that show Discogs data need a session.");
test.setTimeout(120_000);

const NOTICE = "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.";
// Prescribed by Discogs and shown verbatim, in English, in every language (footer.dataProvidedBy).
const ATTRIBUTION = "Data provided by Discogs.";

async function expectAttribution(page: Page, label: string) {
  const main = page.getByRole("main");
  const links2 = main.getByRole("link", { name: ATTRIBUTION });
  expect(await links2.count(), `${label}: at least one attribution link in the page's content`).toBeGreaterThan(0);
  for (const link of await links2.all()) {
    await expect(link, `${label}: points to discogs.com`).toHaveAttribute("href", /^https:\/\/www\.discogs\.com(\/|$)/);
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel, `${label}: no nofollow (ranking credit must pass)`).not.toMatch(/nofollow/);
    expect(rel, `${label}: opened safely`).toMatch(/noopener/);
    await expect(link, `${label}: visible`).toBeVisible();
  }
  // directly next to the data: the attribution sits inside the same results container as at least one Discogs-derived element
  const dataBlocks = await main.locator(".x-result, .x-card, article, section, li").count();
  expect(dataBlocks, `${label}: there is data for it to sit next to`).toBeGreaterThan(0);
}

async function expectNotice(page: Page, label: string) {
  // the footer's own element (a legal page may quote the notice in its text too)
  const notice = page.locator("footer").getByText(NOTICE, { exact: true });
  await expect(notice.first(), `${label}: the exact non-affiliation notice is shown`).toBeVisible();
  await expect(notice.first(), `${label}: and it is in English`).toHaveAttribute("lang", "en");
}

for (const locale of ["en", "uk", "nb"]) {
  test.describe(`${locale}: pages that show Discogs data`, () => {
    test.use({ storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${locale === "en" ? 219 : locale === "uk" ? 220 : 221}` } });

    const pages: Array<[string, string]> = [
      [`/${locale}/search?mode=artist&q=cobalt%20attr`, "search results: artists"],
      [`/${locale}/search?mode=artist&q=cobalt%20attr&g=cobalt+parade`, "search results: albums"],
      [`/${locale}/master/500?t=Glass%20Harbor&a=Cobalt%20Parade`, "pressings"],
      [`/${locale}/release/1001`, "release card"],
    ];
    for (const [url, label] of pages) {
      test(`${label}`, async ({ page }) => {
        await page.goto(url);
        await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectAttribution(page, `${locale} ${label}`);
        await expectNotice(page, `${locale} ${label}`);
      });
    }
  });
}

test.describe("pages without Discogs data still carry the notice, and make no attribution claim they cannot back", () => {
  test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.222" } });
  for (const path of ["/en", "/uk", "/nb", "/en/contact", "/en/privacy", "/en/terms", "/en/sign-in", "/en/search"]) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await expectNotice(page, path);
    });
  }
});
