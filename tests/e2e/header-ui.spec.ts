import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The header's icon buttons and the theme menu, measured (not just "visible"):
 *  - the icon of an icon-only button is exactly in the middle of the button (0.5px), and so is the content of every other header control
 *    (the design system's .dd__trigger carries a chevron's padding-right and space-between: the theme icon sat 12px left of centre);
 *  - the rows of the theme menu: the icon is on the first line, the hint is on its own line below it, nothing overflows at 375px;
 *  - the menu surface lets nothing through (computed alpha and a pixel comparison against a magenta block placed behind it);
 *  - axe on the open menus, in both themes;
 *  - the focus ring of the icon button is not clipped.
 * Desktop 1280 and phones 375x667 / 390x844, dark and light, uk / en / nb. Signed-in checks need the DEV database (the sign-in setup).
 */
test.setTimeout(150_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const VIEWPORTS = [
  { name: "desktop 1280", width: 1280, height: 800, mobile: false },
  { name: "phone 390x844", width: 390, height: 844, mobile: true },
  { name: "phone 375x667", width: 375, height: 667, mobile: true },
] as const;
type Viewport = (typeof VIEWPORTS)[number];
const SCHEMES = ["dark", "light"] as const;
type Scheme = (typeof SCHEMES)[number];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEME_KEY = "vinilium:theme";
const THEME_ROOT = ".navbar .x-theme";
const LANG_ROOT = ".navbar .dd:not(.x-theme)";

let ipCounter = 0;
const nextIp = () => `203.0.113.${230 + (ipCounter++ % 20)}`;

async function makeContext(browser: Browser, baseURL: string | undefined, vp: Viewport, scheme: Scheme, signedIn = false): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    storageState: signedIn ? "tests/.auth/user.json" : { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": nextIp() },
  });
  await context.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
    [THEME_KEY, scheme],
  );
  return context;
}

async function openPage(browser: Browser, baseURL: string | undefined, vp: Viewport, scheme: Scheme, path: string, signedIn = false) {
  const context = await makeContext(browser, baseURL, vp, scheme, signedIn);
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
  return { context, page };
}

async function openMenu(page: Page, root: string, vp: Viewport) {
  const trigger = page.locator(`${root} .dd__trigger`);
  if (vp.mobile) await trigger.tap();
  else await trigger.click();
  await expect(page.locator(`${root}.is-open`)).toHaveCount(1);
  await page.waitForTimeout(500); // the open transition
}

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Centring of every control in the header

interface ControlReport {
  label: string;
  iconOnly: boolean;
  box: { w: number; h: number };
  /** content centre minus button centre (the icon for an icon-only button, the whole content group otherwise) */
  dx: number;
  dy: number;
}

async function measureControls(page: Page): Promise<ControlReport[]> {
  return page.evaluate(() => {
    const out: ControlReport[] = [];
    const controls = [...document.querySelectorAll<HTMLElement>(".navbar .btn, .navbar .dd__trigger")].filter((b) => b.offsetParent !== null);
    for (const b of controls) {
      const bb = b.getBoundingClientRect();
      const text = (b.textContent ?? "").trim();
      const visibleSvgs = [...b.querySelectorAll("svg")].filter((s) => s.getBoundingClientRect().width > 0);
      const iconOnly = text === "" && visibleSvgs.length === 1;
      let content: DOMRect;
      if (iconOnly) {
        content = visibleSvgs[0].getBoundingClientRect();
      } else {
        const rg = document.createRange();
        rg.selectNodeContents(b);
        const rects = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        content = new DOMRect(left, top, right - left, bottom - top);
      }
      out.push({
        label: b.getAttribute("aria-label") ?? text,
        iconOnly,
        box: { w: bb.width, h: bb.height },
        dx: content.x + content.width / 2 - (bb.x + bb.width / 2),
        // a text-only button (Sign in) has no icon: glyph metrics are the design system's own and are not asserted vertically
        dy: visibleSvgs.length === 0 ? 0 : content.y + content.height / 2 - (bb.y + bb.height / 2),
      });
    }
    return out;
  });
}

function expectCentred(reports: ControlReport[], where: string) {
  expect(reports.length, `controls found ${where}`).toBeGreaterThanOrEqual(2);
  for (const r of reports) {
    expect(Math.abs(r.dx), `${r.label}: content is centred horizontally (dx=${r.dx.toFixed(2)}) ${where}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.dy), `${r.label}: content is centred vertically (dy=${r.dy.toFixed(2)}) ${where}`).toBeLessThanOrEqual(0.5);
    expect(r.box.h, `${r.label}: 44px touch target ${where}`).toBeGreaterThanOrEqual(44);
    if (r.iconOnly) expect(r.box.w, `${r.label}: 44px wide ${where}`).toBeGreaterThanOrEqual(44);
  }
}

for (const vp of VIEWPORTS.slice(0, 2)) {
  for (const scheme of SCHEMES) {
    for (const locale of ["uk", "en", "nb"]) {
      test(`header controls are centred: ${vp.name} ${scheme} ${locale} (signed out)`, async ({ browser, baseURL }) => {
        const { context, page } = await openPage(browser, baseURL, vp, scheme, `/${locale}`);
        const reports = await measureControls(page);
        const theme = reports.find((r) => r.iconOnly);
        expect(theme, "the theme button is an icon-only button").toBeTruthy();
        expectCentred(reports, `${vp.name} ${scheme} ${locale}`);
        await context.close();
      });
    }
  }
}

for (const scheme of SCHEMES) {
  test(`header controls are centred, signed in (account, sign out, theme, language): desktop 1280 ${scheme}`, async ({ browser, baseURL }) => {
    const { context, page } = await openPage(browser, baseURL, VIEWPORTS[0], scheme, "/uk", true);
    const reports = await measureControls(page);
    expect(reports.map((r) => r.label).join("|")).toMatch(/Вийти/); // the Sign out button is in this header
    expectCentred(reports, `signed in ${scheme}`);
    await context.close();
  });
}

test("the focus ring of the theme button is whole: visible, not clipped by an ancestor, centred on the button", async ({ browser, baseURL }) => {
  for (const vp of VIEWPORTS.slice(0, 2)) {
    for (const scheme of SCHEMES) {
      const { context, page } = await openPage(browser, baseURL, vp, scheme, "/en");
      await page.keyboard.press("Tab"); // keyboard modality, so :focus-visible applies
      await page.locator(`${THEME_ROOT} .dd__trigger`).focus();
      const r = await page.evaluate((sel) => {
        const el = document.querySelector<HTMLElement>(sel)!;
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        const grow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
        const ring = { l: b.left - grow, t: b.top - grow, r: b.right + grow, b: b.bottom + grow };
        const clippedBy: string[] = [];
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p);
          if (o.overflowX === "visible" && o.overflowY === "visible") continue;
          const pb = p.getBoundingClientRect();
          if (ring.l < pb.left || ring.t < pb.top || ring.r > pb.right || ring.b > pb.bottom) clippedBy.push(p.tagName.toLowerCase() + "." + p.className);
        }
        return {
          focusVisible: el.matches(":focus-visible"),
          style: cs.outlineStyle,
          width: parseFloat(cs.outlineWidth),
          inViewport: ring.l >= 0 && ring.t >= 0 && ring.r <= window.innerWidth && ring.b <= window.innerHeight,
          dx: (ring.l + ring.r) / 2 - (b.left + b.right) / 2,
          dy: (ring.t + ring.b) / 2 - (b.top + b.bottom) / 2,
          clippedBy,
        };
      }, `${THEME_ROOT} .dd__trigger`);
      const where = `${vp.name} ${scheme}`;
      expect(r.focusVisible, `focus-visible ${where}`).toBe(true);
      expect(r.style, `outline drawn ${where}`).not.toBe("none");
      expect(r.width).toBeGreaterThan(0);
      expect(r.inViewport, `ring inside the screen ${where}`).toBe(true);
      expect(r.clippedBy, `ring not clipped ${where}`).toEqual([]);
      expect(Math.abs(r.dx) + Math.abs(r.dy), `ring centred on the button ${where}`).toBeLessThanOrEqual(0.5);
      await context.close();
    }
  }
});

// The design system turns every direct svg of an OPEN .dd__trigger by 180deg (a chevron's flip). The moon of the theme button was shown
// upside down while its menu was open: no icon of a header menu trigger may be transformed.
for (const vp of VIEWPORTS.slice(0, 2)) {
  for (const scheme of SCHEMES) {
    test(`the icons of the header menu buttons are not turned while the menu is open: ${vp.name} ${scheme}`, async ({ browser, baseURL }) => {
      const { context, page } = await openPage(browser, baseURL, vp, scheme, "/en");
      for (const root of [THEME_ROOT, LANG_ROOT]) {
        await openMenu(page, root, vp);
        const transforms = await page.evaluate((sel) => {
          const icons = [...document.querySelectorAll<SVGElement>(`${sel} .dd__trigger > svg`)].filter((s) => s.getBoundingClientRect().width > 0);
          return icons.map((s) => getComputedStyle(s).transform);
        }, root);
        expect(transforms.length, `visible icon in ${root}`).toBeGreaterThanOrEqual(1);
        for (const t of transforms) expect(t, `${root} icon is not transformed (${vp.name} ${scheme})`).toBe("none");
        await page.keyboard.press("Escape");
        await expect(page.locator(`${root}.is-open`)).toHaveCount(0);
      }
      await context.close();
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. Rows of the theme menu

interface RowReport {
  value: string;
  iconCy: number;
  iconLeft: number;
  labelLeft: number;
  labelLineCy: number;
  labelLineBottom: number;
  hint: { top: number; left: number; right: number } | null;
  rowRight: number;
  rowPaddingRight: number;
  contentRight: number;
  overflowX: boolean;
}

async function measureRows(page: Page): Promise<RowReport[]> {
  return page.evaluate((root) => {
    return [...document.querySelectorAll<HTMLElement>(`${root} .dd__opt`)].map((row) => {
      const icon = row.querySelector("svg")!.getBoundingClientRect();
      const block = row.querySelector("span")!;
      const tn = [...block.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? "").trim())!;
      const rg = document.createRange();
      rg.selectNodeContents(tn);
      const first = rg.getClientRects()[0];
      const small = row.querySelector("small");
      const sb = small?.getBoundingClientRect();
      const rb = row.getBoundingClientRect();
      const bb = block.getBoundingClientRect();
      return {
        value: row.dataset.value ?? "",
        iconCy: icon.top + icon.height / 2,
        iconLeft: icon.left,
        labelLeft: first.left,
        labelLineCy: first.top + first.height / 2,
        labelLineBottom: first.bottom,
        hint: sb ? { top: sb.top, left: sb.left, right: sb.right } : null,
        rowRight: rb.right,
        rowPaddingRight: parseFloat(getComputedStyle(row).paddingRight),
        contentRight: Math.max(bb.right, sb?.right ?? 0),
        overflowX: row.scrollWidth > row.clientWidth + 0.5,
      };
    });
  }, THEME_ROOT);
}

for (const vp of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const locale of ["uk", "nb", "en"]) {
      test(`theme menu rows are aligned: ${vp.name} ${scheme} ${locale}`, async ({ browser, baseURL }) => {
        const { context, page } = await openPage(browser, baseURL, vp, scheme, `/${locale}`);
        await openMenu(page, THEME_ROOT, vp);
        const rows = await measureRows(page);
        expect(rows.map((r) => r.value)).toEqual(["dark", "light", "system"]);
        const where = `${vp.name} ${scheme} ${locale}`;

        // the same columns in every row
        for (const r of rows) {
          expect(r.iconLeft, `icon column ${r.value} ${where}`).toBeCloseTo(rows[0].iconLeft, 0);
          expect(r.labelLeft, `label column ${r.value} ${where}`).toBeCloseTo(rows[0].labelLeft, 0);
          expect(r.labelLeft, `label starts after the icon ${where}`).toBeGreaterThan(r.iconLeft + 20);
          expect(r.overflowX, `row does not overflow sideways ${r.value} ${where}`).toBe(false);
          expect(r.contentRight, `text stays inside the row ${r.value} ${where}`).toBeLessThanOrEqual(r.rowRight - r.rowPaddingRight + 0.5);
        }
        // the icon sits on the label's FIRST line, the same way in the one-line rows and in the row with a hint
        const offsets = rows.map((r) => r.iconCy - r.labelLineCy);
        for (const [i, o] of offsets.entries()) {
          expect(Math.abs(o), `icon is on the label line (${rows[i].value}: ${o.toFixed(2)}) ${where}`).toBeLessThanOrEqual(1.5);
          expect(Math.abs(o - offsets[0]), `${rows[i].value} aligns like ${rows[0].value} ${where}`).toBeLessThanOrEqual(0.75);
        }
        // the hint is on its own line, below the label, with a gap, in the label's column
        const system = rows[2];
        expect(system.hint, "the System row has a hint").not.toBeNull();
        expect(system.hint!.top, `the hint starts below the label line with a gap ${where}`).toBeGreaterThanOrEqual(system.labelLineBottom + 1);
        expect(system.hint!.left, `the hint starts in the label's column ${where}`).toBeCloseTo(system.labelLeft, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
        await context.close();
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3. The menu surface is opaque

function alphaOf(color: string): number {
  const srgb = /^color\(srgb ([^)]+)\)$/.exec(color);
  if (srgb) {
    const alpha = srgb[1].split("/")[1];
    return alpha === undefined ? 1 : parseFloat(alpha);
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) throw new Error(`unrecognised colour: ${color}`);
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length > 3 ? parseFloat(parts[3]) : 1;
}

for (const vp of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const root of [THEME_ROOT, LANG_ROOT]) {
      test(`menu surface is opaque (computed): ${root === THEME_ROOT ? "theme" : "language"} menu, ${vp.name} ${scheme}`, async ({ browser, baseURL }) => {
        const { context, page } = await openPage(browser, baseURL, vp, scheme, "/uk");
        await openMenu(page, root, vp);
        const s = await page.locator(`${root} .dd__menu`).evaluate((el) => {
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, opacity: cs.opacity, backdrop: cs.backdropFilter };
        });
        expect(alphaOf(s.bg), `background alpha ${JSON.stringify(s)}`).toBe(1);
        expect(Number(s.opacity)).toBe(1);
        await context.close();
      });
    }
  }
}

for (const vp of VIEWPORTS.slice(0, 2)) {
  for (const scheme of SCHEMES) {
    for (const root of [THEME_ROOT, LANG_ROOT]) {
      test(`menu surface is opaque (pixels): ${root === THEME_ROOT ? "theme" : "language"} menu, ${vp.name} ${scheme}`, async ({ browser, baseURL }) => {
        const { context, page } = await openPage(browser, baseURL, vp, scheme, "/uk");
        await openMenu(page, root, vp);
        const box = (await page.locator(`${root} .dd__menu`).boundingBox())!;
        // inset by the corner radius: the rounded corners legitimately show the page
        const inset = 30;
        const clip = { x: box.x + inset, y: box.y + inset, width: box.width - 2 * inset, height: box.height - 2 * inset };
        // A loud magenta block right behind the menu, under the header and the design system's scrim: if any of it shows through the
        // menu (alpha, or a blur that does not apply), the menu's pixels differ from the same menu without the block.
        await page.evaluate((c) => {
          const d = document.createElement("div");
          d.id = "zz-behind";
          d.style.cssText = `position:fixed;left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px;background:#ff00ff;z-index:1;pointer-events:none`;
          document.body.appendChild(d);
        }, clip);
        await page.waitForTimeout(100);
        const withBlock = await page.screenshot({ clip, animations: "disabled" });
        await page.evaluate(() => (document.getElementById("zz-behind")!.style.display = "none"));
        await page.waitForTimeout(100);
        const without = await page.screenshot({ clip, animations: "disabled" });
        expect(withBlock.equals(without), "nothing behind the menu shows through it").toBe(true);
        await context.close();
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4. axe with the menu open

for (const vp of VIEWPORTS.slice(0, 2)) {
  for (const scheme of SCHEMES) {
    for (const root of [THEME_ROOT, LANG_ROOT]) {
      test(`axe, ${root === THEME_ROOT ? "theme" : "language"} menu open: ${vp.name} ${scheme}`, async ({ browser, baseURL }) => {
        const { context, page } = await openPage(browser, baseURL, vp, scheme, "/uk");
        await openMenu(page, root, vp);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => ({ rule: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }))).toEqual([]);
        await context.close();
      });
    }
  }
}
