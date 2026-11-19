import { expect as baseExpect, test, type Page } from "@playwright/test";
import type { ArtistGroup } from "../../src/lib/discogs/types";

/**
 * Navigation through the finder, signed in, against the MOCKED Discogs server: every Back link, the browser's Back button and a
 * reload must return to the same step with the same query, artist, "show more" state and filters (all of it lives in the URL).
 * Runs on a desktop and at 390 px wide.
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): sign-in, the Discogs cache and the lists live in Postgres.");
test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);
const expect = baseExpect.configure({ timeout: 20_000 });

const RUN = Date.now().toString(36);

// Every Back, reload and restored "Load more" page asks for the search again, and the app's own limiter counts per IP (30 a minute).
// One IP per test keeps these long walks from tripping it (the limiter itself is covered by discogs.spec.ts).
let walk = 0;
test.beforeEach(async ({ context }, testInfo) => {
  const base = testInfo.project.name.endsWith("390") ? 160 : 120;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${base + walk++}` });
});

const search = async (page: Page, q: string) => {
  await page.goto("/en/search");
  await page.locator("#finder-q").fill(q);
  await page.getByRole("button", { name: "Search", exact: true }).click();
};
const params = (url: string) => Object.fromEntries([...new URL(url).searchParams].sort(([a], [b]) => a.localeCompare(b)));
const path = (url: string) => new URL(url).pathname;
const noOverflow = async (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
const cards = (page: Page) => page.getByRole("heading", { level: 3 });

/** The same address as `url` (path and every parameter, in any order). */
async function expectSameAddress(page: Page, url: string) {
  await expect.poll(() => path(page.url())).toBe(path(url));
  await expect.poll(() => params(page.url())).toEqual(params(url));
}

const steps = {
  artists: async (page: Page) => {
    await expect(page.getByRole("heading", { level: 2, name: "Pick the artist" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Cobalt Parade/ })).toBeVisible();
  },
  albums: async (page: Page, titles = ["Glass Harbor", "Paper Tide"]) => {
    await expect(page.getByRole("heading", { level: 2, name: "Albums by Cobalt Parade" })).toBeVisible();
    await expect(cards(page)).toHaveText(titles);
  },
  pressings: async (page: Page, title = "Glass Harbor") => {
    await expect(page.getByRole("heading", { level: 1, name: `Pressings of ${title}` })).toBeVisible();
    await expect(page.getByText(/\d vinyl pressings?/).first()).toBeVisible();
  },
  release: async (page: Page) => {
    await expect(page.getByRole("heading", { level: 1, name: "Glass Harbor" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to pressings" })).toBeVisible();
  },
};

test("every Back link returns to the previous step with the same state (search, artist, pages loaded, filters)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // track -> artist list -> albums
  await search(page, `nav-${RUN}`);
  await steps.artists(page);
  await noOverflow(page);
  const artistsUrl = page.url();
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await steps.albums(page);

  // "Load more" brings in an album that is only on page 2 of the results
  await page.getByRole("button", { name: "Load more" }).click();
  await steps.albums(page, ["Glass Harbor", "Paper Tide", "Alive In Dusk"]);
  expect(params(page.url())).toMatchObject({ mode: "track", q: `nav-${RUN}`, g: "cobalt parade", sp: "2" });
  const albumsUrl = page.url();
  await noOverflow(page);

  // a reload keeps the loaded pages
  await page.reload();
  await steps.albums(page, ["Glass Harbor", "Paper Tide", "Alive In Dusk"]);
  await expectSameAddress(page, albumsUrl);

  // an album that exists only on page 2 of the results: pressings and straight back (the album must still be there)
  await page.getByRole("heading", { level: 3, name: "Alive In Dusk" }).getByRole("link").click();
  await steps.pressings(page, "Alive In Dusk");
  expect(params(page.url())).toMatchObject({ g: "cobalt parade", sp: "2", a: "Cobalt Parade", t: "Alive In Dusk" });
  await page.getByRole("link", { name: "Back to albums" }).click();
  await steps.albums(page, ["Glass Harbor", "Paper Tide", "Alive In Dusk"]);
  await expectSameAddress(page, albumsUrl);

  // albums -> pressings, then filter
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();
  await steps.pressings(page);
  await page.getByLabel("Country").selectOption("Japan");
  await expect(page.getByText("1 vinyl pressing", { exact: true })).toBeVisible();
  expect(params(page.url())).toMatchObject({ country: "Japan", g: "cobalt parade", sp: "2", q: `nav-${RUN}` });
  const pressingsUrl = page.url();
  await noOverflow(page);

  // pressings -> release card -> Back to pressings: the filter is still on
  await page.getByRole("heading", { level: 3 }).getByRole("link", { name: /Victor/ }).click();
  await expect(page).toHaveURL(/\/en\/release\/13/);
  await steps.release(page);
  await noOverflow(page);
  await page.getByRole("link", { name: "Back to pressings" }).click();
  await steps.pressings(page);
  await expect(page.getByLabel("Country")).toHaveValue("Japan");
  await expect(page.getByText("1 vinyl pressing", { exact: true })).toBeVisible();
  await expectSameAddress(page, pressingsUrl);

  // pressings -> Back to albums: the same albums list, including the one that needed "Load more"
  await page.getByRole("link", { name: "Back to albums" }).click();
  await steps.albums(page, ["Glass Harbor", "Paper Tide", "Alive In Dusk"]);
  await expectSameAddress(page, albumsUrl);
  await expect(page.locator("#finder-q")).toHaveValue(`nav-${RUN}`); // the form shows the same query

  // albums -> Choose another artist: the artist list of the same search
  await page.getByRole("link", { name: "Choose another artist" }).click();
  await steps.artists(page);
  expect(params(page.url())).toMatchObject({ mode: "track", q: `nav-${RUN}` });
  expect(params(page.url()).g).toBeUndefined();
  expect(params(artistsUrl).g).toBeUndefined();
  expect(errors).toEqual([]);
});

test("the browser's Back button and a reload work at every step", async ({ page }) => {
  await search(page, `hist-${RUN}`);
  await steps.artists(page);
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await steps.albums(page);
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();
  await steps.pressings(page);
  await page.getByRole("heading", { level: 3 }).getByRole("link", { name: /Victor/ }).click();
  await steps.release(page);

  // reload on the release card, then walk back with the browser's button, reloading on the way
  await page.reload();
  await steps.release(page);
  await page.goBack();
  await steps.pressings(page);
  await page.reload();
  await steps.pressings(page);
  await page.goBack();
  await steps.albums(page);
  await page.reload();
  await steps.albums(page);
  await page.goBack();
  await steps.artists(page);
  await page.reload();
  await steps.artists(page);
  await expect(page.locator("#finder-q")).toHaveValue(`hist-${RUN}`);

  // and forward again
  await page.goForward();
  await steps.albums(page);
  await page.goForward();
  await steps.pressings(page);
  await page.goForward();
  await steps.release(page);
});

test('"Show more albums" and the opened "Other pressings" section survive Back and reload', async ({ page }) => {
  await page.route("**/api/discogs/search**", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const cobalt = body.data.groups.find((g: ArtistGroup) => g.artist === "Cobalt Parade");
    cobalt.entries.push(
      ...Array.from({ length: 12 }, (_, i) => ({ key: `m:80${i}`, kind: "master", id: 8000 + i, artist: "Cobalt Parade", title: `Extra ${i}`, year: 2010 + i, thumb: null, formats: ["Vinyl", "LP"], country: null, discogsUrl: `https://www.discogs.com/master/${8000 + i}`, mergedHits: 1, fromMaster: false })),
      ...Array.from({ length: 2 }, (_, i) => ({ key: `r:70${i}`, kind: "release", id: 7000 + i, artist: "Cobalt Parade", title: `Odd Pressing ${i}`, year: 2020 + i, thumb: null, formats: ["Vinyl", '12"'], types: ["single"], country: null, discogsUrl: `https://www.discogs.com/release/${7000 + i}`, mergedHits: 1, fromMaster: false })),
    );
    await route.fulfill({ response: res, json: body });
  });

  await search(page, `more-${RUN}`);
  await page.getByRole("link", { name: /Cobalt Parade/ }).click();
  await expect(cards(page)).toHaveCount(12, { timeout: 60_000 });
  await page.getByRole("button", { name: "Show more albums" }).click();
  await expect(cards(page)).toHaveCount(14, { timeout: 60_000 }); // all 14 albums; the 2 releases without a master are in the collapsed section
  const section = page.locator("details.x-disclosure");
  await section.locator("summary").click();
  await expect(section).toHaveAttribute("open", "");
  await expect(cards(page)).toHaveCount(16);
  await expect.poll(() => params(page.url())).toMatchObject({ n: "2", o: "1", g: "cobalt parade" });
  const albumsUrl = page.url();

  // open the first album and come back with the Back link
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();
  await steps.pressings(page);
  await page.getByRole("link", { name: "Back to albums" }).click();
  await expectSameAddress(page, albumsUrl);
  await expect(cards(page)).toHaveCount(16, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Show more albums" })).toHaveCount(0);
  await expect(section).toHaveAttribute("open", "");

  // a release without a master: its card carries the state, and Back returns to the albums (still 2 views, section open)
  await page.getByRole("link", { name: "Open release" }).first().click();
  await expect(page).toHaveURL(/\/en\/release\/7000/);
  // Wait for the card itself (the mock's record for 7000 has no master, like the entry in the albums list): the Back link is then "Back to albums" before
  // and after the data arrives. The first version clicked "Back to (pressings|albums)" at once and passed or failed on whether the record had arrived yet
  // (the mock said master_id 500, so once it had, the link correctly led to that master: the CI failure of finder-nav-390).
  await expect(page.getByRole("heading", { level: 1, name: "Odd Pressing 0" })).toBeVisible();
  await page.getByRole("link", { name: "Back to albums", exact: true }).click();
  await expectSameAddress(page, albumsUrl);

  // reload and the browser's Back button
  await page.reload();
  await expect(cards(page)).toHaveCount(16, { timeout: 60_000 });
  await expect(section).toHaveAttribute("open", "");
  await page.getByRole("heading", { level: 3, name: "Glass Harbor" }).getByRole("link").click();
  await steps.pressings(page);
  await page.goBack();
  await expect(cards(page)).toHaveCount(16, { timeout: 60_000 });
  await expect(section).toHaveAttribute("open", "");
});

test("a release card opened from a pressings page: its Back link does not point at the albums while the card loads, then leads to those pressings", async ({ page }) => {
  // The address of a card opened from a master's pressings page carries the master's title (t) but not its id; the id comes with the release record.
  // Until then the link must not guess: it used to read "Back to albums" and switch to "Back to pressings" after the record arrived, so a tap in
  // between went to the wrong place.
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  await page.route("**/api/discogs/releases/11", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/en/release/11?mode=track&q=back-${RUN}&g=cobalt+parade&n=1&a=Cobalt+Parade&t=Glass+Harbor`);
  await expect(page.getByTestId("back-pending")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Back to (albums|pressings|search)$/ })).toHaveCount(0); // nothing to tap yet, so nothing wrong to tap
  open();
  const back = page.getByRole("link", { name: "Back to pressings", exact: true });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", /\/en\/master\/500\?/);
  await expect(page.getByTestId("back-pending")).toHaveCount(0);
  await back.click();
  await steps.pressings(page);
});

test("the 'try as artist / album' links keep what they can, and 'without the artist' drops only the artist", async ({ page }) => {
  await page.goto(`/en/search?mode=track&q=cdonly-${RUN}&by=Lumen Choir`);
  const nav = page.getByRole("navigation", { name: "Not what you meant?" });
  await expect(nav).toBeVisible();
  // album mode also has the optional artist, so it is kept; the artist mode has no such field
  const hrefParams = async (name: string) => params(`http://x${await nav.getByRole("link", { name }).getAttribute("href")}`);
  expect(await hrefParams("an album")).toEqual({ mode: "album", q: `cdonly-${RUN}`, by: "Lumen Choir" });
  expect(await hrefParams("an artist")).toEqual({ mode: "artist", q: `cdonly-${RUN}` });
  expect(await hrefParams("search without the artist")).toEqual({ mode: "track", q: `cdonly-${RUN}` });

  await nav.getByRole("link", { name: "an album" }).click();
  await expect(page).toHaveURL(/mode=album/);
  await expect(page.getByRole("searchbox", { name: /Artist \(optional\)/ })).toHaveValue("Lumen Choir");
  await page.goBack();
  await expect(page).toHaveURL(/mode=track/);
  await expect(page.locator("#finder-q")).toHaveValue(`cdonly-${RUN}`);
});

test("a release card opened without the finder's context still has sensible Back links", async ({ page }) => {
  // typed or shared link: Back goes to its pressings (artist and title come from the release itself)
  await page.goto("/en/release/13");
  await expect(page.getByRole("heading", { level: 1, name: "Glass Harbor" })).toBeVisible();
  const back = page.getByRole("link", { name: "Back to pressings" });
  expect(params(`http://x${await back.getAttribute("href")}`)).toEqual({ t: "Glass Harbor", a: "Cobalt Parade" });
  await back.click();
  await steps.pressings(page);

  // a release the mock knows no master for, opened from an albums list: Back returns to that list
  await page.goto(`/en/release/100000001?mode=track&q=slow orbit ${RUN}&g=some band&sp=2`);
  await expect(page.getByRole("heading", { level: 1, name: /Library Record 100000001/ })).toBeVisible();
  await page.getByRole("link", { name: "Back to albums" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Albums by Some Band" })).toBeVisible();
  expect(params(page.url())).toMatchObject({ mode: "track", q: `slow orbit ${RUN}`, g: "some band", sp: "2" });
});

test("tampered or invalid parameters never break a step; counters stay bounded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const searchPages = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/discogs/search") searchPages.add(u.searchParams.get("page") ?? "1");
  });

  // unknown mode, control characters, a huge n and sp, an empty g, a junk o
  await page.goto(`/en/search?mode=%3Cscript%3E&q=slow%20orbit%20${RUN}%00&n=999&sp=999&g=&o=maybe`);
  await steps.artists(page);
  expect([...searchPages].every((p) => Number(p) >= 1 && Number(p) <= 5)).toBe(true); // never more pages than the app allows
  await expect(page.locator("details.x-disclosure")).toHaveCount(0);

  // an artist key that does not exist -> the artist list, not an empty screen
  await page.goto(`/en/search?mode=track&q=slow orbit ${RUN}&g=nobody%20at%20all`);
  await steps.artists(page);

  // the pressings page: junk filters, a huge page count and absurdly long text
  await page.goto(`/en/master/500?vp=999&country=&label=%20&a=${"x".repeat(500)}&t=${"y".repeat(500)}&q=${"z".repeat(500)}&sp=-3`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/\d vinyl pressings?/).first()).toBeVisible();
  const back = await page.getByRole("link", { name: "Back to albums" }).getAttribute("href");
  expect(params(`http://x${back}`).q).toHaveLength(100); // clamped
  expect(errors).toEqual([]);
});

test("a signed-out visitor who follows a finder link signs in and lands on the SAME step (albums with their loaded pages)", async ({ browser, baseURL, request }, testInfo) => {
  // a throwaway user (e2e-*@example.test is removed by the teardown), verified directly in the DEV database like auth.setup.ts does
  const email = `e2e-nav-${RUN}-${testInfo.project.name}@example.test`;
  const password = "E2e-Password-123";
  const up = await request.post("/api/auth/sign-up/email", { data: { name: "Nav User", email, password, locale: "en" }, headers: { origin: baseURL! } });
  expect(up.ok(), "sign-up").toBe(true);
  const { e2ePool } = await import("../helpers/e2e-db");
  const pool = await e2ePool();
  try {
    await pool.query('update "user" set email_verified = true where email = $1', [email]);
  } finally {
    await pool.end();
  }

  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: testInfo.project.use.viewport ?? undefined,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${testInfo.project.name.endsWith("390") ? 190 : 150}` },
  });
  try {
    const page = await context.newPage();
    await page.goto(`/en/search?mode=track&q=back-${RUN}&g=cobalt+parade&sp=2`);
    await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/search\?/);
    expect(params(page.url())).toEqual({ mode: "track", q: `back-${RUN}`, g: "cobalt parade", sp: "2" });
    await steps.albums(page, ["Glass Harbor", "Paper Tide", "Alive In Dusk"]);
  } finally {
    await context.close();
  }
});
