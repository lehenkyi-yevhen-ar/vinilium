import { expect, test } from "@playwright/test";

test.describe("app shell", () => {
  test("redirects / to a locale and renders translated content", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(en|uk|nb)$/);
    await page.goto("/uk");
    await expect(page.locator("html")).toHaveAttribute("lang", "uk");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Знайдіть саме те видання.");
    // Server components without an explicit locale (header/footer) must follow the URL too.
    await expect(page.getByRole("navigation", { name: "Головна навігація" }).first()).toBeVisible();
  });

  test("language switcher changes the URL, <html lang> and remembers the choice", async ({ page, isMobile }) => {
    test.skip(isMobile, "covered on desktop; the mobile layout uses the same component");
    await page.goto("/en");
    await page.getByRole("button", { name: /Language/ }).click();
    await page.getByRole("menuitem", { name: "Norsk bokmål" }).click();
    await expect(page).toHaveURL(/\/nb$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "nb");
    expect((await page.context().cookies()).find((c) => c.name === "NEXT_LOCALE")?.value).toBe("nb");
  });

  test("protected page sends anonymous users to sign-in with a safe next parameter", async ({ page }) => {
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/sign-in\?next=%2Faccount$/);
  });

  test("sign-in validates on the client, in the user's language, and toggles password visibility", async ({ page }) => {
    await page.goto("/nb/sign-in");
    await page.getByRole("button", { name: "Logg inn", exact: true }).last().click();
    await expect(page.getByText("Skriv inn e-postadressen din.")).toBeVisible();
    await expect(page.getByText("Skriv inn passordet ditt.")).toBeVisible();
    const password = page.getByLabel("Passord", { exact: true });
    await password.fill("hemmelig123");
    await page.getByRole("button", { name: "Vis passord" }).click();
    await expect(password).toHaveAttribute("type", "text");
  });

  test("unknown URLs return a real 404 page", async ({ request }) => {
    const res = await request.get("/uk/does-not-exist");
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("Сторінку не знайдено");
  });

  test("no horizontal scroll and Discogs attribution present", async ({ page }) => {
    await page.goto("/en/sign-up");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
    await expect(page.getByRole("link", { name: "Data provided by Discogs" })).toHaveAttribute("href", /discogs\.com/);
  });
});
