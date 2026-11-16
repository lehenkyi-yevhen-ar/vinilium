import { after } from "next/server";
import { createTranslator } from "next-intl";
import { Resend } from "resend";
import { site } from "@/config/site";
import { serverEnv } from "@/lib/env";
import { routing, type Locale } from "@/i18n/routing";

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

export async function sendAuthEmail(opts: {
  kind: EmailKind;
  to: string;
  name: string;
  locale: unknown;
  url: string;
}) {
  const locale = normalizeLocale(opts.locale);
  const { subject, html, text } = await render(opts.kind, locale, opts.name, opts.url);
  const env = serverEnv();

  if (!env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production to send email.");
    }
    // Dev mode: no provider configured. Print the email instead of sending it.
    // Never do this in production: links are credentials.
    console.log(`\n[email:dev] to=${opts.to} subject="${subject}"\n[email:dev] ${opts.url}\n`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to: opts.to, subject, html, text });
  if (error) throw new Error(`Resend failed: ${error.message}`);
}

/**
 * Fire-and-forget without letting serverless freeze the work: `after()` keeps the function
 * alive until the email is handed to the provider, while the HTTP response (and its timing)
 * stays the same whether or not the account exists.
 */
export function queueAuthEmail(opts: Parameters<typeof sendAuthEmail>[0]) {
  const run = () =>
    sendAuthEmail(opts).catch((e) => console.error(`[email] ${opts.kind} email failed`, e));
  try {
    after(run);
  } catch {
    void run(); // outside a request scope (scripts/tests)
  }
}
