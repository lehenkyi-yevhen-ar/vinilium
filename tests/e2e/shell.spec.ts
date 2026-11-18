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

  test("language switcher changes the URL, <html lang> and remembers the choice (desktop AND phone: the phone opens a bottom sheet)", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: /Language/ }).click();
    await page.getByRole("menuitem", { name: "Norsk bokmål" }).click(); // Playwright refuses a click when another element covers the target
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
    expect(overflow).toBeLessThanOrEqual(0); // negative in WebKit/Firefox with a classic scrollbar (innerWidth includes it)
    await expect(page.getByRole("link", { name: "Data provided by Discogs" })).toHaveAttribute("href", /discogs\.com/);
  });

  test("footer carries the Terms-prescribed notice verbatim, and the attribution link passes ranking credit", async ({ page }) => {
    await page.goto("/uk"); // a non-English page: the notice must still be the prescribed English sentence
    const notice =
      "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.";
    await expect(page.locator("footer").getByText(notice, { exact: true })).toBeVisible();
    const link = page.getByRole("link", { name: "Data provided by Discogs." });
    await expect(link).toHaveAttribute("href", /^https:\/\/www\.discogs\.com/);
    expect(await link.getAttribute("rel")).not.toMatch(/nofollow|sponsored|ugc/);
  });

  for (const [locale, title, footerLink] of [
    ["en", "Contact", "Contact"],
    ["uk", "Контакти", "Контакти"],
    ["nb", "Kontakt", "Kontakt"],
  ] as const) {
    test(`contact page (${locale}) is public, linked from the footer, translated and shows the configured email`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.locator("footer").getByRole("link", { name: footerLink, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/contact$`));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      // E2E server sets NEXT_PUBLIC_CONTACT_EMAIL / _TELEGRAM to fake values (see playwright.config.ts).
      await expect(page.getByRole("link", { name: "contact@example.test" })).toHaveAttribute("href", "mailto:contact@example.test");
      const telegram = page.getByRole("link", { name: "@example_contact" });
      await expect(telegram).toHaveAttribute("href", "https://t.me/example_contact");
      await expect(telegram).toHaveAttribute("rel", /noopener/);
      // the prescribed Discogs notice is on this page too, in English
      await expect(page.getByText("is not affiliated with, sponsored or endorsed by Discogs.", { exact: false }).first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0); // negative in WebKit/Firefox with a classic scrollbar (innerWidth includes it)
    });
  }

  for (const [locale, title, signIn] of [
    ["en", "Sign in to search", "Sign in"],
    ["uk", "Увійдіть, щоб шукати", "Увійти"],
    ["nb", "Logg inn for å søke", "Logg inn"],
  ] as const) {
    test(`search is for signed-in users: ${locale} visitors see a clear sign-in state (the home page stays public)`, async ({ page }) => {
      await page.goto(`/${locale}/search`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const link = page.getByRole("main").getByRole("link", { name: signIn, exact: true });
      await expect(link).toHaveAttribute("href", `/${locale}/sign-in?next=%2Fsearch`);
      for (const path of ["master/500", "release/123"]) {
        await page.goto(`/${locale}/${path}`);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      }
      expect((await page.request.get(`/${locale}`)).status()).toBe(200);
    });
  }

  test("a signed-out visitor following a finder link returns to the SAME step after signing in (validated state only)", async ({ page }) => {
    // search: the step and "show more" state are kept; a tampered counter is clamped and control characters are dropped
    await page.goto("/en/search?mode=track&q=ultraviolence&by=Lana%20del%20Rey&g=lana%20del%20rey&n=999&sp=2&junk=1");
    const nextOf = async () => new URL((await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).getAttribute("href"))!, "http://x").searchParams.get("next");
    expect(await nextOf()).toBe("/search?mode=track&q=ultraviolence&by=Lana+del+Rey&g=lana+del+rey&n=10&sp=2"); // `junk` is not carried

    // pressings and the release card: filters and the search they came from
    await page.goto("/en/master/500?mode=track&q=slow+orbit&g=cobalt+parade&a=Cobalt+Parade&t=Glass+Harbor&country=Japan");
    expect(await nextOf()).toBe("/master/500?mode=track&q=slow+orbit&g=cobalt+parade&a=Cobalt+Parade&t=Glass+Harbor&country=Japan");
    await page.goto("/en/release/13?mode=track&q=slow+orbit&g=cobalt+parade&country=Japan");
    expect(await nextOf()).toBe("/release/13?mode=track&q=slow+orbit&g=cobalt+parade&country=Japan");

    // only a same-site path ever reaches `next`: the value is rebuilt from validated parts
    await page.goto("/en/search?mode=track&q=%2F%2Fevil.example&g=%5C%5Cx");
    expect((await nextOf())!.startsWith("/search?")).toBe(true);
  });
});
