import { expect, test, type Page } from "@playwright/test";
import type { ArtistGroup } from "../../src/lib/discogs/types";

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
  await page.locator("#finder-q").fill(q);
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
  await expect(page).toHaveURL(/g=cobalt\+parade/);
  await expect(page.getByRole("heading", { level: 2, name: "Albums by Cobalt Parade" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Album");
  // The titles are the albums' own (from the master records). The first vinyl release found was "Glass Harbor (Remixes)":
  // that must never be what the card says.
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Glass Harbor", "Paper Tide"]);
  await expect(page.getByText("Glass Harbor (Remixes)")).toHaveCount(0);
  await expect(page.getByText("2001")).toBeVisible();
  // results exist, so there is no "try as artist / album" nudge
  await expect(page.getByRole("navigation", { name: "Not what you meant?" })).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();

  // Step 4: pick the pressing, filter by country / year / label
  await expect(page).toHaveURL(/\/en\/master\/500/);
  await expect(page.getByRole("heading", { level: 1, name: "Pressings of Glass Harbor" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Pressing");
  await expect(page.getByText("3 vinyl pressings")).toBeVisible();
  await expect(page.getByLabel("Country").locator("option")).toHaveText(["All", "Japan (1)", "UK (1)", "US (1)"]); // no France: that one is a CD
  await noOverflow(page);

  await page.getByLabel("Country").selectOption("Japan");
  await expect(page).toHaveURL(/country=Japan/);
  await expect(page.getByText("1 vinyl pressing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/country=/);
  await expect(page.getByText("3 vinyl pressings")).toBeVisible();
  await page.getByLabel("Year").selectOption("2001");
  await expect(page).toHaveURL(/released=2001/);
  await expect(page.getByText("2 vinyl pressings")).toBeVisible();
  await page.getByLabel("Label").selectOption("Virgin");
  await expect(page).toHaveURL(/label=Virgin/);
  await expect(page).toHaveURL(/released=2001/); // the earlier filter is kept
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/label=|released=/);
  await expect(page.getByText("3 vinyl pressings")).toBeVisible();
  await page.getByLabel("Country").selectOption("Japan");
  await expect(page.getByText("1 vinyl pressing", { exact: true })).toBeVisible();

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

test("a track that exists only on CD gives an empty result, and THEN offers to search another way", async ({ page }) => {
  await search(page, `cdonly-${RUN}`);
  await expect(page.getByText("No vinyl matches")).toBeVisible();
  await expect(page.getByText("Only vinyl pressings are searched.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Not what you meant?" });
  await expect(nav.getByRole("link", { name: "an artist" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "an album" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "a track" })).toHaveCount(0); // not the mode we just used
  await nav.getByRole("link", { name: "an artist" }).click();
  await expect(page).toHaveURL(/mode=artist/);
  await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Not what you meant?" })).toHaveCount(0); // results exist: no nudge
});

test("artist + track: the optional artist field narrows the search, and an empty result can drop it", async ({ page }) => {
  await page.goto("/en/search");
  await page.getByRole("searchbox", { name: "Track title" }).fill(`slow orbit ${RUN}`);
  await page.getByRole("searchbox", { name: /Artist \(optional\)/ }).fill("Cobalt Parade");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(/by=Cobalt\+Parade/);
  // one artist matched, so the artist step is skipped straight to the albums
  await expect(page.getByRole("heading", { level: 2, name: "Albums by Cobalt Parade" })).toBeVisible();
  await expect(currentStep(page)).toHaveText("Album");
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Glass Harbor", "Paper Tide"]);
  await expect(page.getByText("Some Band")).toHaveCount(0);

  // a CD-only track with an artist: empty, with a way to widen the search
  await page.goto(`/en/search?mode=track&q=cdonly-${RUN}&by=Lumen Choir`);
  await expect(page.getByText("No vinyl matches")).toBeVisible();
  await page.getByRole("link", { name: "search without the artist" }).click();
  await expect(page).not.toHaveURL(/by=/);
  await expect(page.getByText("No vinyl matches")).toBeVisible(); // the track still has no vinyl
  await expect(page.getByRole("link", { name: "search without the artist" })).toHaveCount(0);
});

test("albums appear 12 at a time, and only the visible ones have their master records fetched", async ({ page }) => {
  const askedIds: number[][] = [];
  await page.route("**/api/discogs/search**", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const daft = body.data.groups.find((g: ArtistGroup) => g.artist === "Cobalt Parade");
    daft.entries.push(
      ...Array.from({ length: 12 }, (_, i) => ({ key: `m:80${i}`, kind: "master", id: 8000 + i, artist: "Cobalt Parade", title: `Extra ${i}`, year: 2010 + i, thumb: null, formats: ["Vinyl", "LP"], country: null, discogsUrl: `https://www.discogs.com/master/${8000 + i}`, mergedHits: 1, fromMaster: false })),
    );
    await route.fulfill({ response: res, json: body });
  });
  page.on("request", (r) => {
    const m = new URL(r.url()).searchParams.get("ids");
    if (r.url().includes("/api/discogs/masters?") && m) askedIds.push(m.split(",").map(Number));
  });

  await search(page, `many-${RUN}`);
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  const cards = page.getByRole("heading", { level: 3 });
  await expect(cards).toHaveCount(12); // 14 albums exist; 12 are shown
  await expect(page.getByRole("button", { name: "Show more albums" })).toBeVisible();
  expect(askedIds).toHaveLength(1);
  expect(askedIds[0].length).toBeLessThanOrEqual(12);

  await page.getByRole("button", { name: "Show more albums" }).click();
  await expect(cards).toHaveCount(14);
  await expect(page.getByRole("button", { name: "Show more albums" })).toHaveCount(0);
  expect(askedIds).toHaveLength(2); // the second view's masters, in a second call
  for (const ids of askedIds) expect(ids.length).toBeLessThanOrEqual(12);
  expect(new Set(askedIds.flat()).size).toBe(askedIds.flat().length); // no master is asked for twice
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
  await page.locator("#finder-q").fill(`slow orbit ${RUN}`);
  await page.getByRole("button", { name: "Шукати", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Оберіть виконавця" })).toBeVisible();
  await expect(page.getByText("2 альбоми")).toBeVisible(); // Ukrainian plural form (2 -> "few")
  await expect(page.getByText("1 альбом").first()).toBeVisible(); // ... and "one"
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Альбоми виконавця Cobalt Parade" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Переглянути видання" }).first()).toBeVisible();
});
