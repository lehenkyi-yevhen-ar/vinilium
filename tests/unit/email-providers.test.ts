import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brevoBase, classifyBrevoStatus, cleanName, parseSender, resolveProvider, sendViaBrevo, sendViaResend, type OutgoingEmail } from "@/server/email/providers";
import { FAKE_AUTH_SECRET } from "../helpers/fake-secrets";

// `after()` is only valid inside a request.
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

const SECRET_KEY = "xkeysib-THIS-IS-A-FAKE-TEST-KEY-0123456789";
const ADDRESS = "someone.private@example.test";
const msg: OutgoingEmail = {
  from: { email: "sender@example.test", name: "Vinilium" },
  to: { email: ADDRESS, name: "Test Person" },
  replyTo: { email: "contact@example.test", name: "Vinilium contact" },
  subject: "Confirm your email",
  html: "<p>hello</p>",
  text: "hello",
};
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("resolveProvider", () => {
  it("uses the explicit EMAIL_PROVIDER when its key is set, and reports a misconfiguration when it is not", () => {
    expect(resolveProvider({ EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "k" })).toEqual({ kind: "brevo", apiKey: "k" });
    expect(resolveProvider({ EMAIL_PROVIDER: "RESEND", RESEND_API_KEY: "r" })).toEqual({ kind: "resend", apiKey: "r" });
    expect(resolveProvider({ EMAIL_PROVIDER: "brevo", RESEND_API_KEY: "r" })).toMatchObject({ kind: "misconfigured", provider: "brevo" });
    expect(resolveProvider({ EMAIL_PROVIDER: "sendgrid", BREVO_API_KEY: "k" })).toMatchObject({ kind: "misconfigured", provider: "unknown" });
  });

  it("without EMAIL_PROVIDER takes whichever key exists (Brevo first), or none", () => {
    expect(resolveProvider({ BREVO_API_KEY: "b", RESEND_API_KEY: "r" })).toEqual({ kind: "brevo", apiKey: "b" });
    expect(resolveProvider({ RESEND_API_KEY: "r" })).toEqual({ kind: "resend", apiKey: "r" });
    expect(resolveProvider({})).toEqual({ kind: "none" });
    expect(resolveProvider({ BREVO_API_KEY: "  ", RESEND_API_KEY: "" })).toEqual({ kind: "none" });
  });
});

describe("parseSender / cleanName", () => {
  it("reads 'Name <a@b.co>' and a plain address, and lets EMAIL_FROM_NAME win", () => {
    expect(parseSender("Vinilium <hello@example.test>")).toEqual({ email: "hello@example.test", name: "Vinilium" });
    expect(parseSender('"Vinilium Team" <hello@example.test>')).toEqual({ email: "hello@example.test", name: "Vinilium Team" });
    expect(parseSender("hello@example.test")).toEqual({ email: "hello@example.test" });
    expect(parseSender("hello@example.test", "My Project")).toEqual({ email: "hello@example.test", name: "My Project" });
    expect(parseSender("Old <hello@example.test>", "New")).toEqual({ email: "hello@example.test", name: "New" });
  });
  it("rejects anything that is not an address", () => {
    for (const bad of [undefined, "", "   ", "not an address", "a@b", "<>", "Name <nope>"]) expect(parseSender(bad), String(bad)).toBeNull();
  });
  it("keeps header-breaking characters out of display names", () => {
    expect(cleanName('Evil"\r\nBcc: x@y.z <b>')).not.toMatch(/[\r\n"<>]/);
    expect(cleanName("x".repeat(500)).length).toBe(80);
    expect(parseSender("a@example.test", 'Inject"\nX')?.name).not.toMatch(/[\n"]/);
  });
});

describe("sendViaBrevo", () => {
  it("POSTs to /v3/smtp/email with the api-key header and the message in Brevo's shape", async () => {
    const f = vi.fn(async () => json(201, { messageId: "<1@x>" }));
    const r = await sendViaBrevo(msg, { apiKey: SECRET_KEY, fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, provider: "brevo" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe(SECRET_KEY);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: "sender@example.test", name: "Vinilium" },
      to: [{ email: ADDRESS, name: "Test Person" }],
      replyTo: { email: "contact@example.test", name: "Vinilium contact" },
      subject: "Confirm your email",
      htmlContent: "<p>hello</p>",
      textContent: "hello",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sets Reply-To only when there is one", async () => {
    const f = vi.fn(async () => json(201));
    await sendViaBrevo({ ...msg, replyTo: undefined }, { apiKey: "k", fetchImpl: f as unknown as typeof fetch });
    expect(JSON.parse(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string)).not.toHaveProperty("replyTo");
  });

  it("maps every failure class and never leaks the address, the key or the body", async () => {
    const cases: Array<[number, string]> = [[400, "rejected"], [401, "auth"], [403, "auth"], [402, "rate_limited"], [429, "rate_limited"], [500, "unavailable"], [503, "unavailable"], [404, "rejected"]];
    for (const [status, reason] of cases) {
      const f = vi.fn(async () => json(status, { code: "invalid_parameter", message: `email ${ADDRESS} is invalid; key ${SECRET_KEY}` }));
      const r = await sendViaBrevo(msg, { apiKey: SECRET_KEY, fetchImpl: f as unknown as typeof fetch });
      expect(r, String(status)).toMatchObject({ ok: false, provider: "brevo", reason, status });
      expect(JSON.stringify(r)).not.toContain(ADDRESS);
      expect(JSON.stringify(r)).not.toContain(SECRET_KEY);
      expect((r as { code?: string }).code).toBe("invalid_parameter"); // a short machine code is kept
    }
    expect(classifyBrevoStatus(418)).toBe("rejected");
  });

  it("drops an error code that is not a short machine code (it could be anything the provider echoes)", async () => {
    const f = vi.fn(async () => json(400, { code: `bad ${ADDRESS}` }));
    const r = await sendViaBrevo(msg, { apiKey: "k", fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, provider: "brevo", reason: "rejected", status: 400 });
  });

  it("reports a timeout and a network failure, and survives a non-JSON error body", async () => {
    const timeout = await sendViaBrevo(msg, { apiKey: "k", fetchImpl: (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch });
    expect(timeout).toEqual({ ok: false, provider: "brevo", reason: "timeout" });
    const net = await sendViaBrevo(msg, { apiKey: "k", fetchImpl: (async () => { throw new TypeError(`fetch failed for ${ADDRESS}`); }) as unknown as typeof fetch });
    expect(net).toEqual({ ok: false, provider: "brevo", reason: "network" });
    const html = await sendViaBrevo(msg, { apiKey: "k", fetchImpl: (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch });
    expect(html).toMatchObject({ ok: false, reason: "unavailable", status: 502 });
  });
});

describe("brevoBase (the test override can never redirect the API key)", () => {
  it("honours only a localhost http address", () => {
    expect(brevoBase({})).toBe("https://api.brevo.com");
    expect(brevoBase({ BREVO_API_BASE: "http://localhost:3201/brevo" })).toBe("http://localhost:3201/brevo");
    expect(brevoBase({ BREVO_API_BASE: "http://127.0.0.1:3201" })).toBe("http://127.0.0.1:3201");
    for (const bad of ["https://evil.example", "http://evil.example", "http://localhost.evil.example", "http://localhost@evil.example", "ftp://localhost", "//localhost"]) {
      expect(brevoBase({ BREVO_API_BASE: bad }), bad).toBe("https://api.brevo.com");
    }
  });
});

describe("sendViaResend", () => {
  it("sends through the client with from/to/replyTo, and maps errors without leaking", async () => {
    const send = vi.fn(async () => ({ data: { id: "1" }, error: null }));
    const ok = await sendViaResend(msg, { apiKey: "k", client: { emails: { send } } as never });
    expect(ok).toEqual({ ok: true, provider: "resend" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: "Vinilium <sender@example.test>", to: `Test Person <${ADDRESS}>`, replyTo: "Vinilium contact <contact@example.test>", subject: "Confirm your email" }));

    const fail = vi.fn(async () => ({ data: null, error: { message: `bad ${ADDRESS}`, statusCode: 429, name: "rate_limit_exceeded" } }));
    const r = await sendViaResend(msg, { apiKey: "k", client: { emails: { send: fail } } as never });
    expect(r).toEqual({ ok: false, provider: "resend", reason: "rate_limited", status: 429 });
    const boom = vi.fn(async () => { throw new Error(ADDRESS); });
    expect(await sendViaResend(msg, { apiKey: "k", client: { emails: { send: boom } } as never })).toEqual({ ok: false, provider: "resend", reason: "network" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The whole path: deliverAuthEmail / queueAuthEmail with a mocked Brevo

const baseEnv = { DATABASE_URL: "postgresql://dev.invalid/db", BETTER_AUTH_SECRET: FAKE_AUTH_SECRET, BETTER_AUTH_URL: "http://localhost:3000" };
beforeEach(() => {
  vi.resetModules();
  for (const [k, v] of Object.entries(baseEnv)) vi.stubEnv(k, v);
  for (const k of ["RESEND_API_KEY", "BREVO_API_KEY", "EMAIL_PROVIDER", "EMAIL_FROM", "EMAIL_FROM_NAME", "BREVO_API_BASE", "NEXT_PUBLIC_CONTACT_EMAIL"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deliverAuthEmail with Brevo", () => {
  const opts = { kind: "verify" as const, to: ADDRESS, name: "Оля", locale: "uk", url: "https://vinilium.example.test/api/auth/verify-email?token=SECRET-TOKEN" };
  const brevoEnv = { BREVO_API_KEY: SECRET_KEY, EMAIL_FROM: "sender@example.test", EMAIL_FROM_NAME: "Vinilium" };

  it("sends the localized email from EMAIL_FROM with Reply-To = the public contact address", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "contact@example.test");
    const f = vi.fn(async () => json(201));
    vi.stubGlobal("fetch", f);
    const { deliverAuthEmail } = await import("@/server/email");
    const r = await deliverAuthEmail(opts, brevoEnv);
    expect(r).toEqual({ ok: true, provider: "brevo" });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.sender).toEqual({ email: "sender@example.test", name: "Vinilium" });
    expect(body.replyTo).toEqual({ email: "contact@example.test", name: "Vinilium contact" });
    expect(body.to).toEqual([{ email: ADDRESS, name: "Оля" }]);
    expect(body.subject).toContain("Підтвердьте");
    expect(body.htmlContent).toContain("token=SECRET-TOKEN");
    expect(body.textContent).toContain("token=SECRET-TOKEN");
  });

  it("has no Reply-To when no contact address is configured (it is never invented)", async () => {
    const f = vi.fn(async () => json(201));
    vi.stubGlobal("fetch", f);
    const { deliverAuthEmail } = await import("@/server/email");
    await deliverAuthEmail(opts, brevoEnv);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("replyTo");
  });

  it("refuses to guess a sender: without EMAIL_FROM it fails as misconfigured and calls nothing", async () => {
    const f = vi.fn(async () => json(201));
    vi.stubGlobal("fetch", f);
    const { deliverAuthEmail } = await import("@/server/email");
    expect(await deliverAuthEmail(opts, { BREVO_API_KEY: SECRET_KEY })).toMatchObject({ ok: false, provider: "brevo", reason: "misconfigured", code: "sender_setting" });
    expect(f).not.toHaveBeenCalled();
  });

  it("an explicit EMAIL_PROVIDER whose key is missing fails as misconfigured", async () => {
    const { deliverAuthEmail } = await import("@/server/email");
    expect(await deliverAuthEmail(opts, { EMAIL_PROVIDER: "brevo", RESEND_API_KEY: "r", EMAIL_FROM: "a@example.test" })).toMatchObject({ ok: false, reason: "misconfigured" });
  });
});

describe("queueAuthEmail: a failing provider never crashes or leaks", () => {
  const opts = { kind: "reset" as const, to: ADDRESS, name: "A", locale: "en", url: "https://vinilium.example.test/reset?token=SECRET-TOKEN" };

  for (const [label, response] of [
    ["401 unauthorized", () => json(401, { code: "unauthorized", message: `bad key ${SECRET_KEY} for ${ADDRESS}` })],
    ["429 daily limit", () => json(429, { code: "too_many_requests", message: "daily limit reached" })],
    ["500 outage", () => json(500, {})],
    ["network error", () => { throw new TypeError(`getaddrinfo ${ADDRESS}`); }],
  ] as Array<[string, () => Response]>) {
    it(`${label}: returns normally, logs one line with provider/reason/status only`, async () => {
      vi.stubEnv("BREVO_API_KEY", SECRET_KEY);
      vi.stubEnv("EMAIL_FROM", "sender@example.test");
      vi.stubGlobal("fetch", vi.fn(async () => response()));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      const { queueAuthEmail } = await import("@/server/email");
      expect(() => queueAuthEmail(opts)).not.toThrow();
      await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(1));
      const logged = [...err.mock.calls, ...out.mock.calls].flat().join("\n");
      expect(logged).toMatch(/\[email\] reset email FAILED provider=brevo reason=/);
      for (const secret of [ADDRESS, SECRET_KEY, "SECRET-TOKEN", "reset?token"]) expect(logged, secret).not.toContain(secret);
    });
  }

  it("with no provider in production it logs a configuration failure (and never prints the link)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const { queueAuthEmail } = await import("@/server/email");
    queueAuthEmail(opts);
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    expect(err.mock.calls.flat().join("\n")).toMatch(/provider=none reason=misconfigured code=no_provider/);
    expect([...err.mock.calls, ...out.mock.calls].flat().join("\n")).not.toContain("SECRET-TOKEN");
  });

  it("in development with no provider it prints the link to the console, as before", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const { deliverAuthEmail } = await import("@/server/email");
    expect(await deliverAuthEmail(opts, {})).toEqual({ ok: true, provider: "console" });
    expect(out.mock.calls.flat().join("\n")).toContain("SECRET-TOKEN");
  });

  it("sendAuthEmail still rejects on failure, with a message that names no address, key or link", async () => {
    vi.stubEnv("BREVO_API_KEY", SECRET_KEY);
    vi.stubEnv("EMAIL_FROM", "sender@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { code: "too_many_requests" })));
    const { sendAuthEmail } = await import("@/server/email");
    const error = await sendAuthEmail(opts).then(() => null, (e: Error) => e);
    expect(error?.message).toBe("email not sent: brevo rate_limited (429)");
  });
});
