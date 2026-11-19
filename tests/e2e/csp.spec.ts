import { expect, test, type Page } from "@playwright/test";

/**
 * The Content-Security-Policy, in a real browser: every page in every language, signed out and signed in, must produce ZERO
 * violations of the strict nonce-based policy, and every inline script must carry the request's nonce. The browser fires a
 * `securitypolicyviolation` event in report-only mode too, so this is the evidence that CSP_MODE=enforce would break nothing.
 * Runs against the MOCKED Discogs server and the DEV database (never production). To prove enforcement, run the whole suite with
 * CSP_MODE=enforce (see docs/operations.md, section 10).
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch): the signed-in pages need a session.");
test.setTimeout(90_000);

interface Violation {
  directive: string;
  blocked: string;
  source: string;
  line: number;
  disposition: string;
  sample: string;
}

async function watch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: unknown[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, disposition: e.disposition, sample: (e.sample ?? "").slice(0, 60) });
    });
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp);

/** Exercise what a visitor can do on the page that runs script: the header's two menus (design-system script + React state). */
async function poke(page: Page) {
  await page.waitForLoadState("networkidle");
  const lang = page.locator("header .dd").first();
  if (await lang.isVisible().catch(() => false)) {
    await lang.locator(".dd__trigger").click();
    await page.keyboard.press("Escape");
  }
}

async function check(page: Page, url: string, expectedStatus = 200) {
  await watch(page);
  const res = await page.goto(url);
  expect(res?.status(), url).toBe(expectedStatus);
  await poke(page);
  expect(await violations(page), `${url}: CSP violations`).toEqual([]);

  // The policy is on the response, strict, with a nonce; every inline script carries exactly that nonce.
  const headers = res!.headers();
  const csp = headers["content-security-policy"] ?? headers["content-security-policy-report-only"];
  expect(csp, `${url}: has a CSP header`).toBeTruthy();
  const nonce = csp.match(/script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  expect(nonce, `${url}: script-src is 'self' plus a nonce`).toBeTruthy();
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const inline = await page.evaluate(() => [...document.scripts].filter((s) => !s.src).map((s) => ({ nonce: s.nonce, length: s.textContent?.length ?? 0 })));
  for (const s of inline) expect(s.nonce, `${url}: an inline script without the nonce`).toBe(nonce);
  return { nonce, inline: inline.length };
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.217" } });

  for (const locale of ["en", "uk", "nb"]) {
    for (const path of ["", "/sign-in", "/sign-up", "/forgot-password", "/contact", "/privacy", "/terms", "/search", "/lists"]) {
      test(`/${locale}${path} has no CSP violations`, async ({ page }) => {
        await check(page, `/${locale}${path}`);
      });
    }
  }

  test("an unknown page under a locale, and an unknown address, are fine too (the 404s)", async ({ page }) => {
    await check(page, "/en/no-such-page", 404);
    // The global 404 is rendered outside the app layout: the theme script is a file, so nothing inline is left for it to need a nonce for.
    await watch(page);
    const res = await page.goto("/no-such-page-at-all");
    expect(res?.status()).toBe(404);
    await page.waitForLoadState("networkidle");
    expect(await violations(page), "global 404: CSP violations").toEqual([]);
  });

  test("the sign-in form with errors showing, and the theme switcher, run without a violation", async ({ page }) => {
    await watch(page);
    await page.goto("/en/sign-in");
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.locator("header .dd").nth(1).locator(".dd__trigger").click();
    await page.keyboard.press("Escape");
    expect(await violations(page)).toEqual([]);
  });

  test("each response has its own nonce", async ({ page }) => {
    const a = await check(page, "/en/sign-in");
    const b = await check(page, "/en/sign-in");
    expect(a.nonce).not.toBe(b.nonce);
  });

  test("the theme script is a file served as JavaScript, and the theme still applies before paint", async ({ page, request }) => {
    const res = await request.get("/theme-init.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/javascript/);
    await page.addInitScript(() => localStorage.setItem("vinilium:theme", "light"));
    await page.goto("/en/sign-in");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("signed in", () => {
  test.use({ storageState: "tests/.auth/user.json", extraHTTPHeaders: { "x-forwarded-for": "203.0.113.218" } });

  for (const path of ["/en/search", "/en/search?mode=artist&q=cobalt%20csp&g=cobalt+parade", "/en/master/500?t=Glass%20Harbor&a=Cobalt%20Parade", "/en/release/1001", "/en/lists", "/en/account", "/uk/search", "/nb/account"]) {
    test(`${path} has no CSP violations`, async ({ page }) => {
      await check(page, path);
    });
  }
});
