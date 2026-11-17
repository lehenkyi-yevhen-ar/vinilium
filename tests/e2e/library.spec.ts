import { expect as baseExpect, request as pwRequest, test, type Locator, type Page } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";

/**
 * The Wishlist and Collection screens end to end, signed in, in a real browser, against the MOCKED Discogs server and the
 * DEV database. Desktop and phone viewport, one after the other.
 *
 * The signed-in e2e user's items are (re)seeded straight into the dev database before every test, so each test starts from
 * the same known lists. Release ids are unique per run, so the first load is a COLD Discogs cache.
 *
 *   Wishlist (30)   ids BASE+1 .. BASE+30, added one hour apart (BASE+30 is the newest); notes on 3 of them
 *   Collection (5)  BASE+101..104 with grades, plus 404404 = a release the mock says no longer exists on Discogs
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): sign-in, the Discogs cache and the lists live in Postgres.");
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
// A cold page is 12 Discogs calls (app -> mock), each taking a token from the shared bucket (60/min, refilling 1/s): after the earlier
// projects used it up, 12 calls can need ~12 s. That is the throttling working, so the waits here are generous.
const expect = baseExpect.configure({ timeout: 20_000 });

const MOCK = "http://localhost:3201";
const BASE = 800_000_000 + (Date.now() % 90_000_000);
const GONE = 404404;
const T0 = Date.UTC(2026, 0, 1);
const hour = (n: number) => new Date(T0 + n * 3_600_000).toISOString();

interface Row {
  id: number;
  list: "wishlist" | "collection";
  at: string;
  notes?: string;
  media?: string;
  sleeve?: string;
}

const baseRows = (): Row[] => [
  ...Array.from({ length: 30 }, (_, k): Row => {
    const i = k + 1;
    const notes = i === 1 ? "Zulu pressing" : i === 2 ? "alpha original" : i === 3 ? "100% club mint" : undefined;
    return { id: BASE + i, list: "wishlist", at: hour(i), ...(notes ? { notes } : {}) };
  }),
  { id: BASE + 101, list: "collection", at: hour(101), notes: "bought in Oslo", media: "NM", sleeve: "VG" },
  { id: BASE + 102, list: "collection", at: hour(102), media: "M", sleeve: "M" },
  { id: BASE + 103, list: "collection", at: hour(103), media: "VG+", sleeve: "G" },
  { id: BASE + 104, list: "collection", at: hour(104) },
  { id: GONE, list: "collection", at: hour(105), notes: "lost release" },
];

let userId = "";
async function seed(page: Page, rows: Row[] = baseRows()) {
  if (!userId) {
    const session = await (await page.request.get("/api/auth/get-session")).json();
    userId = session?.user?.id;
    expect(userId, "the e2e user is signed in").toBeTruthy();
  }
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: e2eDatabaseUrl() }); // DEV database only (refuses production)
  try {
    await pool.query("delete from user_items where user_id = $1", [userId]);
    if (rows.length) {
      await pool.query(
        `insert into user_items (user_id, discogs_release_id, list, notes, condition_media, condition_sleeve, added_at, updated_at)
         select $1, (r->>'id')::bigint, r->>'list', r->>'notes', r->>'media', r->>'sleeve', (r->>'at')::timestamptz, (r->>'at')::timestamptz
         from jsonb_array_elements($2::jsonb) r`,
        [userId, JSON.stringify(rows)],
      );
    }
  } finally {
    await pool.end();
  }
}

type LogEntry = { path: string; status: number };
const mockLog = async (page: Page) => (await page.request.get(`${MOCK}/__log`)).json() as Promise<LogEntry[]>;
const upstreamReleaseCalls = async (page: Page) => (await mockLog(page)).filter((e) => /^\/releases\/\d+$/.test(e.path)).length;
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

const items = (page: Page) => page.getByTestId("library-item");
const item = (page: Page, id: number) => page.locator(`[data-testid="library-item"][data-release-id="${id}"]`);
const titles = (page: Page) => page.locator(".x-result__title a");
const open = async (page: Page, query = "") => {
  await page.goto(`/en/lists${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "My lists" })).toBeVisible();
};
const summary = (page: Page) => page.getByTestId("library-summary");

/** Make every write of one kind fail after a short delay, so the optimistic state can be seen before it is rolled back. */
async function failWrites(page: Page, method: "PATCH" | "PUT" | "DELETE") {
  await page.route("**/api/lists/items/*", async (route) => {
    if (route.request().method() !== method) return route.continue();
    await new Promise((r) => setTimeout(r, 500));
    return route.fulfill({ status: 500, json: { error: "upstream" } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK}/__control`, { data: { throttleNext: 0 } });
  await seed(page);
});

test.afterAll(async ({ browser }) => {
  // Leave no list rows behind for the next project (the teardown deletes the user anyway).
  const ctx = await browser.newContext({ storageState: "tests/.auth/user.json" });
  const page = await ctx.newPage();
  await page.goto("/en");
  if (userId) await seed(page, []);
  await ctx.close();
});

test("cold load: ONE batched Discogs request for the visible page only; a warm reload costs Discogs nothing", async ({ page }, testInfo) => {
  await page.request.post(`${MOCK}/__reset`);
  const batches: string[] = [];
  page.on("request", (r) => r.url().includes("/api/discogs/releases?") && batches.push(r.url()));

  await open(page);
  await expect(titles(page)).toHaveCount(12);
  await expect(page.getByRole("heading", { level: 3, name: `Library Record ${BASE + 30}` })).toBeVisible();
  const cold = await upstreamReleaseCalls(page);
  expect(cold, "12 items on the page = 12 Discogs release calls, not 30").toBe(12);
  expect(batches).toHaveLength(1);
  const ids = new URL(batches[0]).searchParams.get("ids")!.split(",").map(Number);
  expect(ids).toEqual(Array.from({ length: 12 }, (_, k) => BASE + 30 - k)); // exactly the visible page, in order

  await page.reload();
  await expect(titles(page)).toHaveCount(12);
  expect(await upstreamReleaseCalls(page), "warm reload").toBe(cold); // served from the TTL cache
  expect(batches).toHaveLength(2); // still one batch request per page view

  // The next page asks Discogs only for ITS 12.
  await page.getByRole("button", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("heading", { level: 3, name: `Library Record ${BASE + 18}` })).toBeVisible();
  expect(await upstreamReleaseCalls(page)).toBe(24);
  await page.getByRole("button", { name: "Page 1" }).click();
  await expect(titles(page)).toHaveCount(12);
  expect(await upstreamReleaseCalls(page), "going back is warm").toBe(24);

  testInfo.annotations.push({ type: "discogs-calls", description: `cold page: ${cold}, warm reload: 0, next page: +12, back: +0` });
});

test("pagination: 12 or 24 per page, counts, a pager that knows where it is, and no horizontal overflow", async ({ page }) => {
  await open(page);
  await expect(summary(page)).toHaveText("30 records");
  await expect(page.getByRole("link", { name: "Wishlist (30)" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Collection (5)" })).toBeVisible();
  await expect(items(page)).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await expect(page.getByText("Page 1 of 3")).toBeVisible();
  await noOverflow(page);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(items(page)).toHaveCount(12);
  await page.getByRole("button", { name: "Page 3" }).click();
  await expect(items(page)).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await noOverflow(page);

  await page.getByLabel("Per page").selectOption("24");
  await expect(page).toHaveURL(/size=24/);
  await expect(page).not.toHaveURL(/page=/); // changing the size starts at page 1
  await expect(items(page)).toHaveCount(24);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await noOverflow(page);

  // a page number past the end is clamped, not an error
  await open(page, "?page=99");
  await expect(page.getByText("Page 3 of 3")).toBeVisible();
  await expect(items(page)).toHaveCount(6);
});

test("sort: by added date and by notes on the Wishlist; by condition only on the Collection", async ({ page }) => {
  await open(page);
  await expect(page.getByLabel("Sort by").locator("option")).toHaveText(["Added: newest first", "Added: oldest first", "Notes: A to Z", "Notes: Z to A"]); // no condition sort here
  await expect(items(page).first()).toHaveAttribute("data-release-id", String(BASE + 30));

  await page.getByLabel("Sort by").selectOption("added:asc");
  await expect(items(page).first()).toHaveAttribute("data-release-id", String(BASE + 1));

  await page.getByLabel("Sort by").selectOption("notes:asc");
  await expect(page).toHaveURL(/sort=notes/);
  await expect(page.getByTestId("item-notes").nth(0)).toHaveText("100% club mint");
  await expect(page.getByTestId("item-notes").nth(1)).toHaveText("alpha original");
  await expect(page.getByTestId("item-notes").nth(2)).toHaveText("Zulu pressing");
  await expect(page.getByTestId("item-notes").nth(3)).toHaveText("No notes yet."); // items without notes come last

  await page.getByLabel("Sort by").selectOption("notes:desc");
  await expect(page.getByTestId("item-notes").nth(0)).toHaveText("Zulu pressing");

  await page.getByRole("link", { name: /^Collection/ }).click();
  await expect(page).toHaveURL(/list=collection/);
  await expect(page).not.toHaveURL(/sort=/); // switching lists resets the sort
  await expect(page.getByLabel("Sort by").locator("option")).toHaveText([
    "Added: newest first",
    "Added: oldest first",
    "Notes: A to Z",
    "Notes: Z to A",
    "Condition: best first",
    "Condition: worst first",
  ]);
  await page.getByLabel("Sort by").selectOption("condition:asc");
  await expect(items(page).nth(0)).toHaveAttribute("data-release-id", String(BASE + 102)); // M / M
  await expect(items(page).nth(1)).toHaveAttribute("data-release-id", String(BASE + 101)); // NM / VG
  await expect(items(page).nth(2)).toHaveAttribute("data-release-id", String(BASE + 103)); // VG+ / G
  await page.getByLabel("Sort by").selectOption("condition:desc");
  await expect(items(page).nth(0)).not.toHaveAttribute("data-release-id", String(BASE + 102));
  await expect(items(page).nth(4)).toHaveAttribute("data-release-id", String(BASE + 102));
});

test("search works on the user's own fields only (notes, condition); % is text; clearing brings everything back", async ({ page }) => {
  await open(page);
  await page.getByLabel("Search your notes").fill("alpha");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=alpha/);
  await expect(items(page)).toHaveCount(1);
  await expect(summary(page)).toHaveText("1 record for “alpha”");
  await expect(item(page, BASE + 2)).toBeVisible();

  await page.getByLabel("Search your notes").fill("%");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(items(page)).toHaveCount(1); // a wildcard would have matched all 30
  await expect(item(page, BASE + 3)).toBeVisible();

  // Titles and artists live on Discogs: they are not searchable here.
  await page.getByLabel("Search your notes").fill("Library Record");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("library-empty")).toContainText("Nothing matches");
  await page.getByTestId("library-empty").getByRole("button", { name: "Clear search" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(summary(page)).toHaveText("30 records");

  // a grade finds Collection items graded that
  await open(page, "?list=collection");
  await page.getByLabel("Search your notes").fill("vg+");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(items(page)).toHaveCount(1);
  await expect(item(page, BASE + 103)).toBeVisible();
  await noOverflow(page);
});

test("notes: edit with optimistic UI; persists; a failed save is rolled back with a message", async ({ page }) => {
  await open(page, "?list=wishlist");
  const target = item(page, BASE + 30);
  await expect(target.getByTestId("item-notes")).toHaveText("No notes yet.");

  await target.getByRole("button", { name: `Add notes: Library Record ${BASE + 30}` }).click();
  await target.getByLabel(`Notes for Library Record ${BASE + 30}`).fill("  first press, gatefold  ");
  await target.getByRole("button", { name: "Save notes" }).click();
  await expect(target.getByTestId("item-notes")).toHaveText("first press, gatefold");
  await expect(page.getByTestId("library-notice")).toHaveText("Notes saved.");

  await page.reload();
  await expect(item(page, BASE + 30).getByTestId("item-notes")).toHaveText("first press, gatefold");

  // Rollback: the server refuses; the screen shows the new text at once, then puts the old text back and says so.
  await failWrites(page, "PATCH");
  const again = item(page, BASE + 30);
  await again.getByRole("button", { name: `Edit notes: Library Record ${BASE + 30}` }).click();
  await again.getByLabel(`Notes for Library Record ${BASE + 30}`).fill("this will not be saved");
  await again.getByRole("button", { name: "Save notes" }).click();
  await expect(again.getByTestId("item-notes")).toHaveText("this will not be saved"); // optimistic
  await expect(again.getByTestId("item-notes")).toHaveText("first press, gatefold"); // rolled back
  await expect(again.getByRole("alert")).toContainText("your change was undone");
  await page.unroute("**/api/lists/items/*");
  await page.reload();
  await expect(item(page, BASE + 30).getByTestId("item-notes")).toHaveText("first press, gatefold");
});

test("condition: media and sleeve grades are a Collection-only field, saved at once, rolled back on failure", async ({ page }) => {
  await open(page, "?list=wishlist");
  await expect(page.getByLabel("Record condition")).toHaveCount(0); // not on the Wishlist

  await open(page, "?list=collection");
  const target = item(page, BASE + 104);
  await expect(target.getByLabel("Record condition")).toHaveValue("");
  await expect(item(page, BASE + 101).getByLabel("Record condition")).toHaveValue("NM");
  await expect(item(page, BASE + 101).getByLabel("Sleeve condition")).toHaveValue("VG");

  await target.getByLabel("Record condition").selectOption("VG+");
  await target.getByLabel("Sleeve condition").selectOption("NM");
  await expect(page.getByTestId("library-notice")).toHaveText("Condition saved.");
  await page.reload();
  await expect(item(page, BASE + 104).getByLabel("Record condition")).toHaveValue("VG+");
  await expect(item(page, BASE + 104).getByLabel("Sleeve condition")).toHaveValue("NM");

  await failWrites(page, "PATCH");
  const again = item(page, BASE + 104);
  await again.getByLabel("Record condition").selectOption("P");
  await expect(again.getByLabel("Record condition")).toHaveValue("P"); // optimistic
  await expect(again.getByLabel("Record condition")).toHaveValue("VG+"); // rolled back
  await expect(again.getByRole("alert")).toContainText("your change was undone");
});

test("move between lists: it leaves this list at once, counts follow, the other list has it, and a failure puts it back", async ({ page }) => {
  await open(page);
  const moving = BASE + 30;
  await item(page, moving).getByRole("button", { name: new RegExp(`Move to Collection: Library Record ${moving}`) }).click();
  await expect(item(page, moving)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Wishlist (29)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Collection (6)" })).toBeVisible();
  await expect(page.getByTestId("library-notice")).toHaveText("Moved to your Collection.");
  await expect(items(page)).toHaveCount(12); // the page was refilled from the server

  await page.getByRole("link", { name: /^Collection/ }).click();
  await expect(item(page, moving)).toBeVisible();
  await expect(item(page, moving).getByLabel("Record condition")).toBeVisible(); // now it can be graded
  await item(page, moving).getByRole("button", { name: new RegExp(`Move to Wishlist: Library Record ${moving}`) }).click();
  await expect(item(page, moving)).toHaveCount(0);
  await expect(page.getByTestId("library-notice")).toHaveText("Moved to your Wishlist."); // the write finished before we navigate away

  // failure: PUT is refused, the item comes back where it was
  await open(page);
  await expect(item(page, moving)).toBeVisible(); // moved back
  await failWrites(page, "PUT");
  await item(page, moving).getByRole("button", { name: /^Move to Collection/ }).click();
  await expect(item(page, moving)).toHaveCount(0); // optimistic
  await expect(item(page, moving)).toBeVisible(); // rolled back
  await expect(item(page, moving).getByRole("alert")).toContainText("nothing changed");
  await expect(page.getByRole("link", { name: "Wishlist (30)" })).toBeVisible();
});

test("remove sits behind a confirm modal: keep it, or remove it; a failed removal puts it back", async ({ page }) => {
  await open(page);
  const target = item(page, BASE + 29);
  const dialog = page.locator("#library-remove-modal .modal__dialog");

  await target.getByRole("button", { name: `Remove Library Record ${BASE + 29}` }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Remove from your lists?");
  await expect(dialog).toContainText(`Library Record ${BASE + 29}`);
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await expect(target).toBeVisible(); // cancelled: nothing happened

  await target.getByRole("button", { name: `Remove Library Record ${BASE + 29}` }).click();
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused(); // the design system moves focus into the dialog (the safe choice)
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(target.getByRole("button", { name: `Remove Library Record ${BASE + 29}` })).toBeFocused(); // focus returns to the opener
  await expect(target).toBeVisible();

  // a failed removal is rolled back
  await failWrites(page, "DELETE");
  await target.getByRole("button", { name: `Remove Library Record ${BASE + 29}` }).click();
  await page.getByTestId("confirm-remove").click();
  await expect(target).toHaveCount(0); // optimistic
  await expect(item(page, BASE + 29)).toBeVisible(); // rolled back
  await expect(item(page, BASE + 29).getByRole("alert")).toContainText("still on your list");
  await page.unroute("**/api/lists/items/*");

  await item(page, BASE + 29).getByRole("button", { name: `Remove Library Record ${BASE + 29}` }).click();
  await page.getByTestId("confirm-remove").click();
  await expect(item(page, BASE + 29)).toHaveCount(0);
  await expect(page.getByTestId("library-notice")).toHaveText("Removed from your lists.");
  await expect(page.getByRole("link", { name: "Wishlist (29)" })).toBeVisible();
  await page.reload();
  await expect(summary(page)).toHaveText("29 records");
  await expect(item(page, BASE + 29)).toHaveCount(0);
});

test("a release that is no longer on Discogs gets a placeholder card; the user's own data stays usable", async ({ page }) => {
  await open(page, "?list=collection");
  const gone = item(page, GONE);
  await expect(gone.getByTestId("library-gone")).toContainText("No longer on Discogs");
  await expect(gone.getByTestId("library-gone")).toContainText(`Release ${GONE}`);
  await expect(gone.getByTestId("item-notes")).toHaveText("lost release");
  await expect(gone.getByRole("link", { name: "Data provided by Discogs." })).toHaveCount(0); // no Discogs data shown, so nothing to credit
  await expect(page.getByTestId("library-unresolved")).toHaveCount(0); // gone is not an error, so no retry banner
  await expect(page.getByText(/Discogs is busy/)).toHaveCount(0);
  // the other cards load normally next to it
  await expect(page.getByRole("heading", { level: 3, name: `Library Record ${BASE + 101}` })).toBeVisible();
  await expect(item(page, BASE + 101).getByRole("link", { name: "Data provided by Discogs." })).toBeVisible();

  // it can still be edited and removed
  await gone.getByRole("button", { name: /^Edit notes/ }).click();
  await gone.getByLabel(/^Notes for/).fill("still mine");
  await gone.getByRole("button", { name: "Save notes" }).click();
  await expect(gone.getByTestId("item-notes")).toHaveText("still mine");
  await gone.getByRole("button", { name: /^Remove/ }).click();
  await page.getByTestId("confirm-remove").click();
  await expect(item(page, GONE)).toHaveCount(0);
});

test("when Discogs is busy only the affected cards wait; the rest of the page and the user's data keep working; it recovers on its own", async ({ page }) => {
  // two NEW (uncached) records on top of the Wishlist, so the first page needs two upstream calls
  await seed(page, [...baseRows(), { id: BASE + 501, list: "wishlist", at: hour(500) }, { id: BASE + 502, list: "wishlist", at: hour(501) }]);
  await page.request.post(`${MOCK}/__control`, { data: { throttleNext: 12, retryAfter: 4 } });
  await open(page);

  await expect(page.getByTestId("library-unresolved").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Discogs is busy, so/)).toBeVisible();
  await expect(page.getByText(/Trying again in \d+ s\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again now" })).toBeVisible();
  await expect(items(page)).toHaveCount(12); // the page is intact
  const waiting = page.getByTestId("library-unresolved").first().locator("xpath=ancestor::article");
  await expect(waiting.getByText("Waiting for Discogs")).toBeVisible();
  await expect(waiting.getByRole("button", { name: /^Move to/ })).toBeEnabled(); // the user's own actions still work
  await noOverflow(page);

  await page.request.post(`${MOCK}/__control`, { data: { throttleNext: 0 } });
  await expect(page.getByTestId("library-unresolved")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 3, name: `Library Record ${BASE + 502}` })).toBeVisible();
  await expect(page.getByText(/Discogs is busy/)).toHaveCount(0);
});

test("export: the user's own data only, as CSV and JSON; sign-in and same-site only", async ({ page, baseURL }) => {
  await open(page);
  const csv = await page.request.get("/api/lists/export?format=csv");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toMatch(/^attachment; filename="vinilium-lists-\d{4}-\d{2}-\d{2}\.csv"$/);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["cache-control"]).toContain("no-store");
  expect(csv.headers()["x-content-type-options"]).toBe("nosniff");
  const text = await csv.text();
  expect(text.replace(/^﻿/, "").split("\r\n")[0]).toBe("discogs_release_id,list,notes,condition_media,condition_sleeve,added_at,updated_at");
  expect(text.trim().split("\r\n")).toHaveLength(1 + 35);
  expect(text).toContain(`${BASE + 101},collection,bought in Oslo,NM,VG,`);
  expect(text).not.toMatch(/Library Record|Glass Harbor|Cobalt|discogs\.com/i); // nothing from Discogs

  const json = await (await page.request.get("/api/lists/export?format=json")).json();
  expect(json.items).toHaveLength(35);
  for (const row of json.items) expect(Object.keys(row).sort()).toEqual(json.columns.slice().sort());

  expect((await page.request.get("/api/lists/export?format=xml")).status()).toBe(400);
  expect((await page.request.get("/api/lists/export?format=csv", { headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
  const anon = await pwRequest.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } }); // explicitly signed out: contexts inherit the project's session otherwise
  expect((await anon.get("/api/lists/export?format=csv")).status()).toBe(401);
  expect((await anon.get("/api/lists/items?list=wishlist")).status()).toBe(401);
  await anon.dispose();

  // and the links on the page download the same files
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^vinilium-lists-.*\.csv$/);
});

test("empty lists say so and link to the search; a signed-out visitor is asked to sign in", async ({ page, browser }) => {
  await seed(page, []);
  await open(page);
  await expect(page.getByRole("heading", { level: 2, name: "Your Wishlist is empty" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Wishlist \(0\)/ })).toBeVisible();
  await open(page, "?list=collection");
  await expect(page.getByRole("heading", { level: 2, name: "Your Collection is empty" })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("link", { name: "Find a record" }).click();
  await expect(page).toHaveURL(/\/en\/search/);

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anonPage = await anon.newPage();
  await anonPage.goto("/en/lists");
  await expect(anonPage.getByRole("heading", { level: 1, name: /Sign in/i })).toBeVisible();
  await expect(anonPage.locator('main a[href*="next="]').first()).toHaveAttribute("href", /next=(%2F|\/)lists/);
  await anon.close();
});

test("the screen refreshes its Discogs data after 5.5 hours, well inside the 6-hour display limit", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const batches: string[] = [];
  page.on("request", (r) => r.url().includes("/api/discogs/releases?") && batches.push(r.url()));

  await open(page);
  await expect(titles(page)).toHaveCount(12);
  expect(batches).toHaveLength(1);
  const upstream = await upstreamReleaseCalls(page);

  await page.clock.fastForward("05:29:00");
  await page.waitForTimeout(500);
  expect(batches, "not yet: 5h29m").toHaveLength(1);

  await page.clock.fastForward("00:02:00");
  await expect.poll(() => batches.length, { message: "refetched after 5.5h" }).toBe(2);
  await expect(titles(page)).toHaveCount(12); // cards stay on screen while the refresh runs
  expect(await upstreamReleaseCalls(page)).toBe(upstream); // the server cache still held them: Discogs was not asked again
});

test("a phone-sized page has no horizontal overflow and the actions are reachable", async ({ page }) => {
  await open(page);
  await expect(titles(page)).toHaveCount(12);
  await noOverflow(page);
  const buttons: Locator = items(page).first().getByRole("button");
  for (const b of await buttons.all()) {
    const box = await b.boundingBox();
    expect(box && box.height >= 32, "tap target height").toBeTruthy();
  }
});
