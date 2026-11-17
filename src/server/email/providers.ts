import { Resend } from "resend";

/**
 * Email delivery behind one small interface. Two providers: Brevo (HTTPS transactional API, no SDK) and Resend. A send never
 * throws: it returns a result whose `reason` says what went wrong in terms that are safe to log (no address, no key, no body).
 */

export interface Address {
  email: string;
  name?: string;
}

export interface OutgoingEmail {
  from: Address;
  to: Address;
  replyTo?: Address;
  subject: string;
  html: string;
  text: string;
}

export type FailureReason =
  | "misconfigured" // a required setting is missing or malformed
  | "auth" // the provider refused our credentials (wrong key, or the key is limited to other IP addresses)
  | "rate_limited" // the provider's daily / per-second limit
  | "rejected" // the provider refused this message (bad sender, bad address, blocked)
  | "unavailable" // the provider answered with a server error
  | "timeout"
  | "network";

export type SendResult = { ok: true; provider: ProviderKind } | { ok: false; provider: ProviderKind | "none"; reason: FailureReason; status?: number; code?: string };
export type ProviderKind = "brevo" | "resend";

// ---------------------------------------------------------------------------------------------------------------------------
// Choosing the provider

type Env = Record<string, string | undefined>;
export type Resolved = { kind: ProviderKind; apiKey: string } | { kind: "none" } | { kind: "misconfigured"; provider: ProviderKind | "unknown"; detail: string };

/**
 * EMAIL_PROVIDER (brevo | resend) wins when set; otherwise whichever key exists (Brevo first). No provider at all is not an error:
 * in development the link is printed to the console, in production the send fails (links are credentials: never print them there).
 */
export function resolveProvider(env: Env = process.env): Resolved {
  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  const brevoKey = env.BREVO_API_KEY?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();

  if (explicit) {
    if (explicit !== "brevo" && explicit !== "resend") return { kind: "misconfigured", provider: "unknown", detail: "EMAIL_PROVIDER must be brevo or resend" };
    const key = explicit === "brevo" ? brevoKey : resendKey;
    return key ? { kind: explicit, apiKey: key } : { kind: "misconfigured", provider: explicit, detail: `EMAIL_PROVIDER=${explicit} but its API key is not set` };
  }
  if (brevoKey) return { kind: "brevo", apiKey: brevoKey };
  if (resendKey) return { kind: "resend", apiKey: resendKey };
  return { kind: "none" };
}

/** "Name <a@b.co>" or "a@b.co" -> an address; null when it is neither. A separate display name wins over one inside EMAIL_FROM. */
export function parseSender(from: string | undefined, displayName?: string): Address | null {
  const raw = from?.trim();
  if (!raw) return null;
  const m = /^(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/.exec(raw) ?? /^()([^<>\s]+@[^<>\s]+\.[^<>\s]+)$/.exec(raw);
  if (!m) return null;
  const name = (displayName?.trim() || m[1]?.trim() || "").replace(/[\u0000-\u001f<>"]/g, "");
  return { email: m[2], ...(name ? { name } : {}) };
}

/** Display names go into a JSON field / header: no control characters, no angle brackets or quotes, bounded. */
export const cleanName = (name: string | undefined) => (name ?? "").replace(/[\u0000-\u001f\u007f<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

// ---------------------------------------------------------------------------------------------------------------------------
// Brevo (https://developers.brevo.com/reference/sendtransacemail)

export const BREVO_DEFAULT_BASE = "https://api.brevo.com";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

/**
 * Brevo's API base. BREVO_API_BASE exists for tests only (the mock server) and is honoured ONLY for a localhost http address, so
 * a stray value can never send the API key to another host.
 */
export function brevoBase(env: Env = process.env): string {
  const override = env.BREVO_API_BASE?.trim();
  return override && LOCAL.test(override) ? override.replace(/\/$/, "") : BREVO_DEFAULT_BASE;
}

const safeCode = (v: unknown) => (typeof v === "string" && /^[a-z_]{1,40}$/i.test(v) ? v : undefined);

export function classifyBrevoStatus(status: number): FailureReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status === 402) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "rejected";
}

export async function sendViaBrevo(
  msg: OutgoingEmail,
  opts: { apiKey: string; base?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<SendResult> {
  const f = opts.fetchImpl ?? fetch;
  const person = (a: Address) => ({ email: a.email, ...(cleanName(a.name) ? { name: cleanName(a.name) } : {}) });
  try {
    const res = await f(`${opts.base ?? BREVO_DEFAULT_BASE}/v3/smtp/email`, {
      method: "POST",
      headers: { "api-key": opts.apiKey, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        sender: person(msg.from),
        to: [person(msg.to)],
        ...(msg.replyTo ? { replyTo: person(msg.replyTo) } : {}),
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
    if (res.ok) {
      res.body?.cancel().catch(() => {});
      return { ok: true, provider: "brevo" };
    }
    // The error body can echo the address: read only a short machine code from it.
    const code = safeCode(((await res.json().catch(() => ({}))) as { code?: unknown }).code);
    return { ok: false, provider: "brevo", reason: classifyBrevoStatus(res.status), status: res.status, ...(code ? { code } : {}) };
  } catch (e) {
    const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, provider: "brevo", reason: timeout ? "timeout" : "network" };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Resend (kept so a verified domain can be switched back to later)

const resendFrom = (a: Address) => (cleanName(a.name) ? `${cleanName(a.name)} <${a.email}>` : a.email);

export async function sendViaResend(msg: OutgoingEmail, opts: { apiKey: string; client?: Pick<Resend, "emails"> }): Promise<SendResult> {
  try {
    const client = opts.client ?? new Resend(opts.apiKey);
    const { error } = await client.emails.send({
      from: resendFrom(msg.from),
      to: resendFrom(msg.to),
      ...(msg.replyTo ? { replyTo: resendFrom(msg.replyTo) } : {}),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (!error) return { ok: true, provider: "resend" };
    const status = (error as { statusCode?: number | null }).statusCode ?? undefined;
    const reason: FailureReason = status === 401 || status === 403 ? "auth" : status === 429 ? "rate_limited" : status && status >= 500 ? "unavailable" : "rejected";
    return { ok: false, provider: "resend", reason, ...(status ? { status } : {}) };
  } catch {
    return { ok: false, provider: "resend", reason: "network" };
  }
}
