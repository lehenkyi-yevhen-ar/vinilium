import { expect, test, type Page } from "@playwright/test";

/**
 * The finder UI end to end, signed in, in a real browser, against the MOCKED Discogs server:
 * track -> artist -> album -> pressing (with filters) -> release card -> Wishlist / Collection.
 * Runs on a desktop and on a phone-sized viewport (mobile-first), one after the other.
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DATABASE_URL: sign-in, the Discogs cache and the lists live in Postgres.");
test.describe.configure({ mode: "serial" });
// Every step is a real round trip through the app to a remote Postgres, so a full walk takes a while.
test.setTimeout(120_000);

const MOCK = "http://localhost:3201";
const RUN = Date.now().toString(36);

const search = async (page: Page, q: string, mode?: "Track" | "Artist" | "Album") => {
  await page.goto("/en/search");
  if (mode) await page.getByRole("button", { name: mode, exact: true }).click();
  await page.getByRole("searchbox").fill(q);
  await page.getByRole("button", { name: "Search", exact: true }).click();
};
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
const currentStep = (page: Page) => page.getByRole("list", { name: "Search steps" }).locator('[aria-current="step"]');

test("track -> artist -> album -> pressing -> release card, with filters and lists", async ({ page }) => {
  // Any uncaught error or console error (a hydration mismatch is one, in a production build) fails the flow.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // Step 1: a track
  await page.goto("/en/search");
  await expect(page.getByRole("heading", { level: 1, name: "Find your pressing" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Track");
  await search(page, `slow orbit ${RUN}`);

  // Step 2: pick the artist (matches are grouped by artist)
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Artist");
  for (const name of ["Cobalt Parade", "Some Band", "Unknown artist"]) await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole("link", { name: "Data provided by Discogs." }).first()).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();

  // Step 3: pick the album (deduped: 3 raw hits became one Glass Harbor)
  await expect(page).toHaveURL(/artist=cobalt\+parade/);
  await expect(page.getByRole("heading", { level: 2, name: "Albums by Cobalt Parade" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Album");
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Glass Harbor", "Paper Tide"]);
  await noOverflow(page);
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();

  // Step 4: pick the pressing, filter by country / year / label
  await expect(page).toHaveURL(/\/en\/master\/500/);
  await expect(page.getByRole("heading", { level: 1, name: "Pressings of Glass Harbor" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Pressing");
  await expect(page.getByText("3 pressings")).toBeVisible();
  await noOverflow(page);

  await page.getByLabel("Country").selectOption("Japan");
  await expect(page).toHaveURL(/country=Japan/);
  await expect(page.getByText("1 pressing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/country=/);
  await expect(page.getByText("3 pressings")).toBeVisible();
  await page.getByLabel("Year").selectOption("2001");
  await expect(page).toHaveURL(/released=2001/);
  await expect(page.getByText("2 pressings")).toBeVisible();
  await page.getByLabel("Label").selectOption("Virgin");
  await expect(page).toHaveURL(/label=Virgin/);
  await expect(page).toHaveURL(/released=2001/); // the earlier filter is kept
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/label=|released=/);
  await expect(page.getByText("3 pressings")).toBeVisible();
  await page.getByLabel("Country").selectOption("Japan");
  await expect(page.getByText("1 pressing", { exact: true })).toBeVisible();

  await page.getByRole("heading", { level: 3 }).getByRole("link", { name: /Victor/ }).click();

  // The release card
  await expect(page).toHaveURL(/\/en\/release\/13/);
  await expect(page.getByRole("heading", { level: 1, name: "Glass Harbor" })).toBeVisible();
  await expect(page.getByText("Slow Orbit")).toBeVisible();
  await expect(page.getByText("724384960650")).toBeVisible();
  await noOverflow(page);

  // Every block of Discogs data has its own attribution, linking to discogs.com, passing ranking credit
  const attributions = page.getByRole("main").getByRole("link", { name: "Data provided by Discogs." });
  expect(await attributions.count()).toBeGreaterThanOrEqual(3);
  for (const link of await attributions.all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\/www\.discogs\.com\//);
    expect((await link.getAttribute("rel")) ?? "").not.toMatch(/nofollow|sponsored|ugc/);
  }

  // One list per pressing: add, move, persist, remove
  await page.getByRole("button", { name: "Add to Wishlist" }).click();
  await expect(page.getByTestId("list-state")).toHaveText("On your Wishlist");
  await expect(page.getByRole("button", { name: "Add to Wishlist" })).toHaveCount(0);
  await page.getByRole("button", { name: "Move to Collection" }).click();
  await expect(page.getByTestId("list-state")).toHaveText("In your Collection");
  await expect(page.getByText("Moved to your Collection.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("list-state")).toHaveText("In your Collection"); // saved on the server
  await page.getByRole("button", { name: "Remove from my lists" }).click();
  await expect(page.getByTestId("list-state")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to Wishlist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Collection" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("a long artist list can be narrowed by typing part of a name", async ({ page }) => {
  // Three artist groups is below the threshold; the filter only appears for long lists, so fake a long result page.
  await page.route("**/api/discogs/search**", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const extra = Array.from({ length: 6 }, (_, i) => ({ key: `r:90${i}`, kind: "release", id: 9000 + i, artist: `Filler Band ${i}`, title: `Album ${i}`, year: 2000 + i, thumb: null, formats: [], country: null, discogsUrl: `https://www.discogs.com/release/${9000 + i}`, mergedHits: 1, fromMaster: false }));
    body.data.groups = [...body.data.groups, ...extra.map((e) => ({ key: e.artist.toLowerCase(), artist: e.artist, entries: [e] }))];
    await route.fulfill({ response: res, json: body });
  });
  await search(page, `filter-${RUN}`);
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
  const filter = page.getByLabel("Filter these artists");
  await expect(filter).toBeVisible();
  const cards = page.locator("a.x-result--artist");
  const before = await cards.count();
  expect(before).toBeGreaterThanOrEqual(9);
  await filter.fill("daft");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Cobalt Parade");
  await filter.fill("zzzz");
  await expect(page.getByText("No artist in these results matches.")).toBeVisible();
  await filter.fill("");
  await expect(cards).toHaveCount(before);
});

test("a track that matches nothing offers to search as an artist or an album", async ({ page }) => {
  await search(page, `nomatch-${RUN}`);
  await expect(page.getByText("No matches")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Not what you meant?" });
  await expect(nav.getByRole("link", { name: "an artist" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "an album" })).toBeVisible();
  await nav.getByRole("link", { name: "an artist" }).click();
  await expect(page).toHaveURL(/mode=artist/);
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
});

test("artist and album searches reach the same steps; an empty query is refused politely", async ({ page }) => {
  await search(page, `cobalt parade ${RUN}`, "Album");
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
  await expect(page).toHaveURL(/mode=album/);

  await page.goto("/en/search");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Type something to search for.")).toBeVisible();
});

test("when Discogs is busy the screen shows a countdown and recovers on its own", async ({ page }) => {
  await page.request.post(`${MOCK}/__control`, { data: { throttleNext: 3, retryAfter: 4 } });
  await search(page, `busy-${RUN}`);
  await expect(page.getByText("We are a little busy")).toBeVisible();
  await expect(page.getByText(/Trying again in \d+ s\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again now" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Find your pressing" })).toBeVisible(); // the page is intact

  await page.request.post(`${MOCK}/__control`, { data: { throttleNext: 0 } });
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("We are a little busy")).toHaveCount(0);
});

test("thumbnails that Discogs refuses never break the page: a placeholder takes their place", async ({ page }) => {
  await page.route("**/api/discogs/image**", (route) => route.fulfill({ status: 429, json: { error: "throttled", retryAfter: 30 } }));
  await search(page, `thumbs-${RUN}`);
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
  await expect(page.locator(".x-cover--empty").first()).toBeVisible();
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Glass Harbor" })).toBeVisible();
});

test("a release that does not exist shows a clear message and keeps the page", async ({ page }) => {
  await page.goto("/en/release/404404");
  await expect(page.getByText("Not found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to search" })).toBeVisible();
});

test("the whole flow speaks Ukrainian", async ({ page }) => {
  await page.goto("/uk/search");
  await expect(page.getByRole("heading", { level: 1, name: "Знайдіть своє видання" })).toBeVisible();
  await page.getByRole("searchbox").fill(`slow orbit ${RUN}`);
  await page.getByRole("button", { name: "Шукати", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Оберіть виконавця" })).toBeVisible();
  await expect(page.getByText("2 альбоми")).toBeVisible(); // Ukrainian plural form (2 -> "few")
  await expect(page.getByText("1 альбом").first()).toBeVisible(); // ... and "one"
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Альбоми виконавця Cobalt Parade" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Переглянути видання" }).first()).toBeVisible();
});
