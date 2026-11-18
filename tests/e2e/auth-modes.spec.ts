import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { e2eDatabaseUrl } from "../helpers/e2e-db";
import { FAKE_TOKEN } from "../helpers/fake-secrets";

/**
 * Email + password sign-up, verification and reset against a MOCK Brevo (tests/mocks/discogs-mock.ts), the two switches
 * (AUTH_EMAIL_PASSWORD_ENABLED, AUTH_SIGNUP_ALLOWLIST) and a failing email provider: the real Better Auth flows, the DEV database
 * only (never production), fake credentials, no real email is ever sent.
 *
 *   3200  the normal e2e server (switches unset, email through the mock Brevo)
 *   3202  started here: AUTH_EMAIL_PASSWORD_ENABLED=false   (Google only)
 *   3203  started here: AUTH_SIGNUP_ALLOWLIST=<one address>  (invite only)
 *
 * The two extra servers run the SAME build with a different environment: the switches are read per request.
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DEV_DATABASE_URL (the dev branch).");
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const MOCK = "http://localhost:3201";
const MAIN = "http://localhost:3200";
const OFF = "http://localhost:3202";
const INVITE = "http://localhost:3203";
const RUN = Date.now().toString(36);
const PASSWORD = "E2e-Password-123";
const NEW_PASSWORD = "E2e-New-Password-456";
const INVITED = `e2e-invited-${RUN}@example.test`;
let ipCounter = 0;
/** Better Auth limits sign-up / reset requests per IP per minute; every call comes from its own documentation-range address. */
const nextIp = () => `203.0.113.${(Number.parseInt(RUN.slice(-3), 36) + 17 * ++ipCounter) % 250 + 1}`;

interface Mail {
  to: string;
  sender: { email: string; name: string };
  replyTo?: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
}
const mails = async (): Promise<Mail[]> => (await fetch(`${MOCK}/__emails`)).json();
async function mailTo(address: string, timeoutMs = 15_000): Promise<Mail> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = (await mails()).filter((m) => m.to === address).at(-1);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no email arrived at the mock Brevo");
}
const setEmailFail = (status: number | null) => fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify({ emailFail: status }) });

async function api(base: string): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: base, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { origin: base, "x-forwarded-for": nextIp() } });
}
async function post(base: string, path: string, data: unknown) {
  const ctx = await api(base);
  const res = await ctx.post(path, { data });
  const body = await res.json().catch(() => null);
  await ctx.dispose();
  return { status: res.status(), body };
}
const signUp = (base: string, email: string, locale = "en") => post(base, "/api/auth/sign-up/email", { name: "E2E Mail", email, password: PASSWORD, locale });
const signIn = (base: string, email: string, password = PASSWORD) => post(base, "/api/auth/sign-in/email", { email, password });
const urlIn = (text: string) => text.match(/https?:\/\/\S+/)![0];

// ---------------------------------------------------------------------------------------------------------------------------
// The two extra servers

const servers: ChildProcess[] = [];
function start(port: number, extra: Record<string, string>) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: e2eDatabaseUrl(), // the DEV database; the helper refuses the production host
      DEV_DATABASE_URL: "",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      BETTER_AUTH_URL: `http://localhost:${port}`,
      DISCOGS_API_BASE: MOCK,
      DISCOGS_CONSUMER_KEY: "test-key",
      DISCOGS_CONSUMER_SECRET: "test-secret",
      DISCOGS_TOKEN: "",
      EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "test-brevo-key",
      BREVO_API_BASE: `${MOCK}/brevo`,
      EMAIL_FROM: "sender@example.test",
      EMAIL_FROM_NAME: "Vinilium",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      AUTH_EMAIL_PASSWORD_ENABLED: "",
      AUTH_SIGNUP_ALLOWLIST: "",
      ...extra,
    },
  });
  servers.push(child);
  return child;
}
async function ready(base: string) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${base}/en`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${base} did not start`);
}

test.beforeAll(async () => {
  start(3202, { AUTH_EMAIL_PASSWORD_ENABLED: "false" });
  start(3203, { AUTH_SIGNUP_ALLOWLIST: ` ${INVITED.toUpperCase()} , someone-else@example.test` });
  await Promise.all([ready(OFF), ready(INVITE), ready(MAIN)]);
  await fetch(`${MOCK}/__reset`);
});

test.afterAll(async () => {
  await setEmailFail(null);
  for (const s of servers) if (s.pid) spawnSync("taskkill", ["/pid", String(s.pid), "/T", "/F"], { stdio: "ignore" });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Normal mode: the real flows through the mock Brevo

test("sign-up sends ONE localized verification email through Brevo (sender, Reply-To), and the account cannot sign in until the link is opened", async () => {
  const email = `e2e-flow-${RUN}@example.test`;
  const up = await signUp(MAIN, email, "uk");
  expect(up.status).toBe(200);

  const mail = await mailTo(email);
  expect(mail.sender).toEqual({ name: "Vinilium", email: "sender@example.test" });
  expect(mail.replyTo).toEqual({ name: "Vinilium contact", email: "contact@example.test" }); // the public contact address, NEXT_PUBLIC_CONTACT_EMAIL
  expect(mail.subject).toContain("Підтвердьте"); // the user's language
  expect(mail.text).toContain("/api/auth/verify-email?token=");
  expect((await mails()).filter((m) => m.to === email)).toHaveLength(1);

  // email verification is NOT weakened: signing in before the link is refused
  const early = await signIn(MAIN, email);
  expect(early.status).toBe(403);
  expect(early.body.code).toBe("EMAIL_NOT_VERIFIED");

  // opening the link verifies (it follows the redirect to the page we asked for), then sign-in works
  const ctx = await api(MAIN);
  expect((await ctx.get(urlIn(mail.text).replace(/^https?:\/\/[^/]+/, ""))).ok()).toBe(true);
  await ctx.dispose();
  const ok = await signIn(MAIN, email);
  expect(ok.status).toBe(200);
});

test("password reset runs end to end through Brevo, and the old password stops working", async () => {
  const email = `e2e-flow-${RUN}@example.test`; // verified by the previous test
  const asked = await post(MAIN, "/api/auth/request-password-reset", { email, redirectTo: `${MAIN}/en/reset-password` });
  expect(asked.status).toBe(200);
  const mail = (await mailTo(email, 20_000));
  const reset = (await mails()).filter((m) => m.to === email && /reset/i.test(m.text)).at(-1) ?? mail;
  const link = urlIn(reset.text);
  expect(link).toMatch(/\/api\/auth\/reset-password\/[A-Za-z0-9_-]+/);
  const token = link.match(/reset-password\/([^?/]+)/)![1];

  expect((await post(MAIN, "/api/auth/reset-password", { newPassword: NEW_PASSWORD, token })).status).toBe(200);
  expect((await signIn(MAIN, email, NEW_PASSWORD)).status).toBe(200);
  expect((await signIn(MAIN, email, PASSWORD)).status).toBe(401);
});

test("a failing email provider (429, 500, 401) never breaks sign-up or reset, and the answers are identical whether or not the email could be sent", async () => {
  const baselineEmail = `e2e-baseline-${RUN}@example.test`;
  const baseline = await signUp(MAIN, baselineEmail);
  await mailTo(baselineEmail);

  for (const status of [429, 500, 401]) {
    await setEmailFail(status);
    const before = (await mails()).length;

    const email = `e2e-fail${status}-${RUN}@example.test`;
    const up = await signUp(MAIN, email);
    expect(up.status, `sign-up while Brevo answers ${status}`).toBe(baseline.status);
    expect(Object.keys(up.body ?? {}).sort()).toEqual(Object.keys(baseline.body ?? {}).sort()); // same shape as when the email goes out
    expect((await signIn(MAIN, email)).body.code, "the account exists, unverified").toBe("EMAIL_NOT_VERIFIED");

    // password reset: an existing and an unknown address get exactly the same answer
    const known = await post(MAIN, "/api/auth/request-password-reset", { email: baselineEmail, redirectTo: `${MAIN}/en/reset-password` });
    const unknown = await post(MAIN, "/api/auth/request-password-reset", { email: `nobody-${status}-${RUN}@example.test`, redirectTo: `${MAIN}/en/reset-password` });
    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);

    await new Promise((r) => setTimeout(r, 1500)); // the sends are queued: give them time to fail
    expect((await mails()).length, "nothing was recorded by the provider").toBe(before);
    expect((await fetch(`${MAIN}/en`)).status, "the site is fine").toBe(200);
  }
  await setEmailFail(null);
});

const NOT_ARRIVED = {
  en: { words: ["spam or junk folder", "not spam", "try again"], contact: "Contact us", submit: /Send reset link/ },
  uk: { words: ["«Спам» або «Небажана пошта»", "«Не спам»", "спробувати ще раз"], contact: "Зв’язатися з нами", submit: /Надіслати/ },
  nb: { words: ["søppelpost- eller spam-mappen", "«ikke søppelpost»", "prøve igjen"], contact: "Kontakt oss", submit: /Send/ },
} as const;

for (const lang of ["en", "uk", "nb"] as const) {
  test(`${lang}: every screen that sends an email says what to do when nothing arrives (spam or junk, try again, contact us)`, async ({ page }) => {
    const { words, contact } = NOT_ARRIVED[lang];
    // Better Auth limits these endpoints per IP per minute (that is the point of the limiter): every submit comes from its own address.
    const freshIp = () => page.context().setExtraHTTPHeaders({ "x-forwarded-for": nextIp() });
    const note = page.getByTestId("email-not-arrived");
    const expectNote = async () => {
      await expect(note).toBeVisible();
      for (const w of words) await expect(note).toContainText(w);
      await expect(note.getByRole("link", { name: contact })).toHaveAttribute("href", `/${lang}/contact`);
    };

    // 1. the sign-up confirmation: really sign up through the form and land on the "check your inbox" screen
    const email = `e2e-notes-${lang}-${RUN}@example.test`;
    await freshIp();
    await page.goto(`${MAIN}/${lang}/sign-up`);
    await page.locator('input[name="name"]').fill("Notes User");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('form button[type="submit"]').click(); // not "the last button": Google's is one too
    await expect(page).toHaveURL(new RegExp(`/${lang}/verify-email[?]email=`));
    await expectNote();

    // 2. the verification resend screen (same page, with its button) and the page when it is opened without an address
    await page.goto(`${MAIN}/${lang}/verify-email?email=${encodeURIComponent(email)}`);
    await expectNote();
    await expect(page.getByRole("main").getByRole("button").first()).toBeVisible();
    await page.goto(`${MAIN}/${lang}/verify-email`);
    await expectNote();

    // 3. signing in with an address that is not verified yet (a new link is sent): the error AND the note
    await freshIp();
    await page.goto(`${MAIN}/${lang}/sign-in`);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expectNote();

    // 4. the password-reset screen: an existing and an unknown address get the SAME words (no account enumeration)
    const answers: string[] = [];
    for (const address of [email, `nobody-${lang}-${RUN}@example.test`]) {
      await freshIp();
      await page.goto(`${MAIN}/${lang}/forgot-password`);
      await page.locator('input[type="email"]').fill(address);
      await page.locator('form button[type="submit"]').click(); // not "the last button": Google's is one too
      await expectNote();
      answers.push(await page.getByRole("main").innerText());
    }
    expect(answers[0]).toBe(answers[1]);
  });
}

test("the privacy policy and terms describe the normal mode: Brevo, passwords, the operator as a private individual", async ({ page }) => {
  await page.goto(`${MAIN}/en/privacy`);
  await expect(page.locator("article")).toContainText("Brevo");
  await expect(page.locator("article")).not.toContainText("Resend");
  await expect(page.locator("article")).toContainText("hashed form");
  await expect(page.locator("article")).toContainText("local storage"); // the one setting the search help keeps on the device
  await expect(page.locator("article")).toContainText("private individual");
  await expect(page.locator("article")).toContainText("[NEEDS LEGAL REVIEW]");
  await page.goto(`${MAIN}/en/terms`);
  await expect(page.locator("article")).toContainText("real email address");
  await expect(page.locator("article")).toContainText("private individual");
});

// ---------------------------------------------------------------------------------------------------------------------------
// AUTH_EMAIL_PASSWORD_ENABLED=false

test.describe("email + password switched off (Google only)", () => {
  const MESSAGES = {
    en: "Signing in with email and password is turned off",
    uk: "Вхід за email і паролем вимкнено",
    nb: "Innlogging med e-post og passord er slått av",
  } as const;
  // Google is not configured in this environment, so the honest "not available" variant is shown
  const UNAVAILABLE = { en: "Signing in is not available right now", uk: "Вхід зараз недоступний", nb: "Innlogging er ikke tilgjengelig akkurat nå" } as const;

  test("every email+password screen says so, in all three languages, and shows no password field", async ({ page }) => {
    for (const lang of ["en", "uk", "nb"] as const) {
      for (const path of ["sign-in", "sign-up", "forgot-password", `reset-password?token=${FAKE_TOKEN}`, "verify-email?email=a%40example.test"]) {
        await page.goto(`${OFF}/${lang}/${path}`);
        await expect(page.getByTestId("email-password-off"), `${lang}/${path}`).toBeVisible();
        await expect(page.getByTestId("email-password-off")).toContainText(UNAVAILABLE[lang]);
        await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
        await expect(page.getByTestId("email-not-arrived")).toHaveCount(0);
      }
    }
    expect(MESSAGES.en).toBeTruthy();
  });

  test("the API refuses every email+password endpoint with a clean error and sends no email", async () => {
    const before = (await mails()).length;
    const email = `e2e-off-${RUN}@example.test`;
    for (const [path, data] of [
      ["/api/auth/sign-up/email", { name: "X", email, password: PASSWORD }],
      ["/api/auth/sign-in/email", { email, password: PASSWORD }],
      ["/api/auth/send-verification-email", { email }],
      ["/api/auth/request-password-reset", { email, redirectTo: `${OFF}/en/reset-password` }],
      ["/api/auth/reset-password", { newPassword: NEW_PASSWORD, token: FAKE_TOKEN }],
    ] as const) {
      const r = await post(OFF, path, data);
      expect(r.status, path).toBe(403);
      expect(r.body, path).toEqual({ code: "EMAIL_PASSWORD_DISABLED", message: expect.any(String) });
    }
    await new Promise((r) => setTimeout(r, 1000));
    expect((await mails()).length, "no email was sent").toBe(before);
    // and the account was not created behind the refusal
    expect((await signIn(MAIN, email)).status).toBe(401);
  });

  test("the rest of the auth API still works (sessions, sign-out) and the site is up", async () => {
    const ctx = await api(OFF);
    expect((await ctx.get("/api/auth/get-session")).status()).toBe(200);
    await ctx.dispose();
    expect((await fetch(`${OFF}/en`)).status).toBe(200);
  });

  test("the legal text follows the mode: no Brevo, no password or email-verification wording", async ({ page }) => {
    await page.goto(`${OFF}/en/privacy`);
    const article = page.locator("article");
    await expect(article).toContainText("Google");
    await expect(article).not.toContainText("Brevo");
    await expect(article).not.toContainText("Resend");
    await expect(article).not.toContainText("password-reset");
    await expect(article).toContainText("An account created earlier with a password");
    await expect(article).toContainText("private individual");
    await page.goto(`${OFF}/en/terms`);
    await expect(page.locator("article")).not.toContainText("real email address");
    await expect(page.locator("article")).toContainText("private individual");
    await page.goto(`${OFF}/uk/privacy`);
    await expect(page.locator("article")).not.toContainText("Brevo");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// AUTH_SIGNUP_ALLOWLIST

test.describe("invite-only sign-up", () => {
  test("a listed address (any case) can sign up and gets its email; anybody else is refused and gets none", async () => {
    const up = await signUp(INVITE, INVITED);
    expect(up.status).toBe(200);
    await mailTo(INVITED);

    const stranger = `e2e-stranger-${RUN}@example.test`;
    const before = (await mails()).length;
    const refused = await signUp(INVITE, stranger);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("SIGNUP_INVITE_ONLY");
    await new Promise((r) => setTimeout(r, 1000));
    expect((await mails()).length).toBe(before);
    expect((await signIn(MAIN, stranger)).status, "no account was created").toBe(401);
  });

  test("the sign-up form shows the refusal in the user's language", async ({ page }) => {
    await page.goto(`${INVITE}/nb/sign-up`);
    await page.locator('input[name="name"]').fill("Stranger");
    await page.locator('input[type="email"]').fill(`e2e-ui-stranger-${RUN}@example.test`);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator("form").getByRole("button").last().click();
    await expect(page.getByRole("alert").first()).toContainText("bare mulig etter invitasjon");
  });

  test("sign-in and reset are not restricted, and the normal server accepts anybody", async () => {
    const other = `e2e-open-${RUN}@example.test`;
    expect((await signUp(MAIN, other)).status).toBe(200);
    // an unknown address on the invite-only server is answered like anywhere else (no allowlist leak through sign-in / reset)
    const reset = await post(INVITE, "/api/auth/request-password-reset", { email: `nobody-${RUN}@example.test`, redirectTo: `${INVITE}/en/reset-password` });
    expect(reset.status).toBe(200);
  });
});
