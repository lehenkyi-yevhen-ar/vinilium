import { describe, expect, it } from "vitest";
import { emailPasswordEnabled, isEmailAllowed, parseFlag, signupAllowlist } from "@/lib/auth-flags";
import { authSubPath, EMAIL_PASSWORD_DISABLED, guardAuthRequest, SIGNUP_INVITE_ONLY } from "@/server/auth/guard";

const req = (path: string, method = "POST", body?: unknown) =>
  new Request(`http://localhost:3000/api/auth${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("parseFlag", () => {
  it("is the default when unset, empty or unrecognised, and understands the usual spellings", () => {
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag("", true)).toBe(true);
    expect(parseFlag("   ", false)).toBe(false);
    expect(parseFlag("flase", true)).toBe(true); // a typo never silently changes the mode
    for (const t of ["1", "true", "TRUE", "Yes", "on"]) expect(parseFlag(t, false), t).toBe(true);
    for (const f of ["0", "false", "False", "no", "OFF"]) expect(parseFlag(f, true), f).toBe(false);
  });
  it("AUTH_EMAIL_PASSWORD_ENABLED defaults to true", () => {
    expect(emailPasswordEnabled({})).toBe(true);
    expect(emailPasswordEnabled({ AUTH_EMAIL_PASSWORD_ENABLED: "false" })).toBe(false);
    expect(emailPasswordEnabled({ AUTH_EMAIL_PASSWORD_ENABLED: "true" })).toBe(true);
  });
});

describe("signupAllowlist", () => {
  it("is off unless it holds at least one valid address; normalises case, spaces and duplicates", () => {
    expect(signupAllowlist({})).toBeNull();
    expect(signupAllowlist({ AUTH_SIGNUP_ALLOWLIST: "" })).toBeNull();
    expect(signupAllowlist({ AUTH_SIGNUP_ALLOWLIST: " , ,not-an-email" })).toBeNull();
    expect(signupAllowlist({ AUTH_SIGNUP_ALLOWLIST: " A@Example.test, b@example.test ,a@example.test" })).toEqual(["a@example.test", "b@example.test"]);
  });
  it("matches exactly (no plus-address or domain tricks), ignoring case", () => {
    const list = ["a@example.test"];
    expect(isEmailAllowed(list, "A@EXAMPLE.TEST ")).toBe(true);
    for (const bad of ["a+x@example.test", "b@example.test", "a@example.test.evil", "", null, undefined, 5, { toString: () => "a@example.test" }]) expect(isEmailAllowed(list, bad), String(bad)).toBe(false);
  });
});

describe("guardAuthRequest: email + password switched off", () => {
  const off = { AUTH_EMAIL_PASSWORD_ENABLED: "false" };

  it("refuses every email+password endpoint with a clean, coded 403", async () => {
    for (const path of ["/sign-up/email", "/sign-in/email", "/send-verification-email", "/request-password-reset", "/forget-password", "/reset-password", "/reset-password/abc123"]) {
      const res = await guardAuthRequest(req(path, "POST", { email: "a@example.test" }), off);
      expect(res?.status, path).toBe(403);
      expect(await res?.json(), path).toEqual({ code: EMAIL_PASSWORD_DISABLED, message: expect.any(String) });
      expect(res?.headers.get("cache-control")).toBe("no-store");
    }
    const get = await guardAuthRequest(req("/reset-password/abc123", "GET"), off); // the link in a reset email
    expect(get?.status).toBe(403);
  });

  it("leaves Google sign-in, sessions, sign-out, account deletion and email-verification links alone", async () => {
    for (const [path, method] of [["/sign-in/social", "POST"], ["/callback/google", "GET"], ["/get-session", "GET"], ["/sign-out", "POST"], ["/delete-user", "POST"], ["/verify-email", "GET"], ["/update-user", "POST"], ["/ok", "GET"]] as const) {
      expect(await guardAuthRequest(req(path, method, method === "POST" ? {} : undefined), off), path).toBeNull();
    }
  });

  it("does not touch anything while the flag is on (the default)", async () => {
    for (const path of ["/sign-up/email", "/sign-in/email", "/send-verification-email", "/request-password-reset", "/reset-password"]) {
      expect(await guardAuthRequest(req(path, "POST", { email: "a@example.test" }), {}), path).toBeNull();
    }
  });

  it("resolves the sub-path whatever the host, trailing slash or query", () => {
    expect(authSubPath("https://x.test/api/auth/sign-up/email?x=1")).toBe("/sign-up/email");
    expect(authSubPath("https://x.test/api/auth")).toBe("/");
  });
});

describe("guardAuthRequest: invite-only sign-up", () => {
  const env = { AUTH_SIGNUP_ALLOWLIST: "friend@example.test, other@example.test" };

  it("lets listed addresses sign up (any case) and still leaves the body readable for Better Auth", async () => {
    const r = req("/sign-up/email", "POST", { email: "Friend@Example.test", password: "x", name: "F" });
    expect(await guardAuthRequest(r, env)).toBeNull();
    expect(await r.json()).toMatchObject({ email: "Friend@Example.test" });
  });

  it("refuses everyone else, a missing email and an unreadable body, with a coded 403", async () => {
    for (const body of [{ email: "stranger@example.test" }, {}, { email: 5 }, "not json at all"]) {
      const r = new Request("http://localhost:3000/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
      const res = await guardAuthRequest(r, env);
      expect(res?.status, JSON.stringify(body)).toBe(403);
      expect((await res!.json()).code).toBe(SIGNUP_INVITE_ONLY);
    }
  });

  it("only restricts email sign-UP: sign-in, reset and Google are unaffected", async () => {
    for (const [path, body] of [["/sign-in/email", { email: "stranger@example.test" }], ["/request-password-reset", { email: "stranger@example.test" }], ["/sign-in/social", { provider: "google" }]] as const) {
      expect(await guardAuthRequest(req(path, "POST", body), env), path).toBeNull();
    }
  });

  it("combines with the flag: with email+password off the answer is 'disabled', not 'invite only'", async () => {
    const res = await guardAuthRequest(req("/sign-up/email", "POST", { email: "friend@example.test" }), { ...env, AUTH_EMAIL_PASSWORD_ENABLED: "false" });
    expect((await res!.json()).code).toBe(EMAIL_PASSWORD_DISABLED);
  });
});
