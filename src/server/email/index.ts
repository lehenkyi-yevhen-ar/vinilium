import { after } from "next/server";
import { createTranslator } from "next-intl";
import { site } from "@/config/site";
import { serverEnv } from "@/lib/env";
import { routing, type Locale } from "@/i18n/routing";
import { brevoBase, parseSender, resolveProvider, sendViaBrevo, sendViaResend, type Address, type OutgoingEmail, type SendResult } from "./providers";

type EmailKind = "verify" | "reset";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function normalizeLocale(value: unknown): Locale {
  return routing.locales.includes(value as Locale) ? (value as Locale) : routing.defaultLocale;
}

async function loadMessages(locale: Locale) {
  return (await import(`../../messages/${locale}.json`)).default;
}

/** Plain, table-free, accessible HTML. All strings come from the message files. */
async function render(kind: EmailKind, locale: Locale, name: string, url: string) {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "email" });
  const values = { appName: site.name, name };
  const subject = t(`${kind}.subject`, values);
  const heading = t(`${kind}.heading`);
  const body = t(`${kind}.body`, values);
  const button = t(`${kind}.button`);
  const ignore = t(`${kind}.ignore`);
  const fallback = t("linkFallback");

  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0;padding:24px;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#1c221a;">
<div style="max-width:480px;margin:0 auto;background:#fffcf7;border:1px solid #d9cfbd;border-radius:16px;padding:32px;">
<h1 style="font-size:24px;margin:0 0 16px;">${escapeHtml(heading)}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px;">${escapeHtml(body)}</p>
<p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2f5d3a;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">${escapeHtml(button)}</a></p>
<p style="font-size:14px;line-height:1.5;color:#5b5545;margin:0 0 8px;">${escapeHtml(fallback)}</p>
<p style="font-size:13px;word-break:break-all;margin:0 0 24px;"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p style="font-size:14px;line-height:1.5;color:#5b5545;margin:0;">${escapeHtml(ignore)}</p>
</div></body></html>`;
  const text = `${heading}\n\n${body}\n\n${button}: ${url}\n\n${ignore}`;
  return { subject, html, text };
}

export interface AuthEmail {
  kind: EmailKind;
  to: string;
  name: string;
  locale: unknown;
  url: string;
}

/** Who replies go to. Brevo replaces a free-mail From address with its own, so replies must be steered to a real inbox. */
export function replyToAddress(): Address | undefined {
  const email = site.contact.email;
  return email ? { email, name: `${site.name} contact` } : undefined;
}

/**
 * Sends (or, in development with no provider, prints) one email and reports what happened. Never throws: the caller decides.
 * The result carries a provider, a reason and an HTTP status at most: never an address, a key or a link.
 */
export async function deliverAuthEmail(opts: AuthEmail, env: Record<string, string | undefined> = process.env): Promise<SendResult | { ok: true; provider: "console" }> {
  const locale = normalizeLocale(opts.locale);
  const { subject, html, text } = await render(opts.kind, locale, opts.name, opts.url);
  const provider = resolveProvider(env);

  if (provider.kind === "none") {
    if (process.env.NODE_ENV === "production") return { ok: false, provider: "none", reason: "misconfigured", code: "no_provider" };
    // Development: no provider configured. Print the email instead of sending it. Never in production: links are credentials.
    console.log(`
[email:dev] to=${opts.to} subject="${subject}"
[email:dev] ${opts.url}
`);
    return { ok: true, provider: "console" };
  }
  if (provider.kind === "misconfigured") {
    return { ok: false, provider: provider.provider === "unknown" ? "none" : provider.provider, reason: "misconfigured", code: "provider_setting" };
  }

  const e = serverEnv();
  const from = parseSender(env.EMAIL_FROM ?? (provider.kind === "resend" ? e.EMAIL_FROM : undefined), env.EMAIL_FROM_NAME?.trim() || site.name);
  // Brevo needs a sender it has validated: refuse to guess one (the built-in default belongs to Resend's test domain).
  if (!from) return { ok: false, provider: provider.kind, reason: "misconfigured", code: "sender_setting" };

  const msg: OutgoingEmail = { from, to: { email: opts.to, name: opts.name }, replyTo: replyToAddress(), subject, html, text };
  return provider.kind === "brevo" ? sendViaBrevo(msg, { apiKey: provider.apiKey, base: brevoBase(env) }) : sendViaResend(msg, { apiKey: provider.apiKey });
}

/** For callers (and older tests) that want a rejection on failure. The message names the reason only. */
export async function sendAuthEmail(opts: AuthEmail): Promise<void> {
  const r = await deliverAuthEmail(opts);
  if (!r.ok) throw new Error(`email not sent: ${r.provider} ${r.reason}${"status" in r && r.status ? ` (${r.status})` : ""}`);
}

const describe = (r: Exclude<Awaited<ReturnType<typeof deliverAuthEmail>>, { ok: true }>) =>
  `provider=${r.provider} reason=${r.reason}${"status" in r && r.status ? ` status=${r.status}` : ""}${"code" in r && r.code ? ` code=${r.code}` : ""}`;

/**
 * Fire-and-forget without letting serverless freeze the work: `after()` keeps the function alive until the email is handed to the
 * provider, while the HTTP response (and its timing) stays the same whether or not the account exists. A failure is LOGGED (see
 * docs/operations.md) and never reaches the person asking: telling them "we could not email you" would reveal that the address
 * has an account. The pages say what to do when nothing arrives.
 */
export function queueAuthEmail(opts: AuthEmail) {
  const run = async () => {
    try {
      const r = await deliverAuthEmail(opts);
      if (!r.ok) console.error(`[email] ${opts.kind} email FAILED ${describe(r)}`);
    } catch {
      console.error(`[email] ${opts.kind} email FAILED reason=exception`); // not the error object: it could carry the address
    }
  };
  try {
    after(run);
  } catch {
    void run(); // outside a request scope (scripts/tests)
  }
}
