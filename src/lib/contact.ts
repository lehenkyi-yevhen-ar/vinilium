/**
 * Public contact details, read from NEXT_PUBLIC_CONTACT_EMAIL / NEXT_PUBLIC_CONTACT_TELEGRAM (see .env.example).
 * Both are optional and validated: anything that does not look right is dropped (the page then hides that line),
 * so a typo in the environment can never produce a broken or unsafe link.
 */

export interface TelegramContact {
  url: string;
  /** What to show as the link text, e.g. "@handle". */
  label: string;
}

export interface ContactDetails {
  email: string | null;
  telegram: TelegramContact | null;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const HANDLE_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
// A public username path (/handle) or an invite path (/+code, /joinchat/code).
const PATH_RE = /^\/(?:[A-Za-z][A-Za-z0-9_]{3,31}|\+[A-Za-z0-9_-]{6,64}|joinchat\/[A-Za-z0-9_-]{6,64})$/;

export function parseContactEmail(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v && v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Accepts `@handle`, `handle`, `t.me/handle` or `https://t.me/handle` (also telegram.me). Always returns an https://t.me URL. */
export function parseTelegram(value: string | undefined | null): TelegramContact | null {
  const v = value?.trim();
  if (!v) return null;

  const bare = v.replace(/^@/, "");
  if (HANDLE_RE.test(bare)) return { url: `https://t.me/${bare}`, label: `@${bare}` };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!["t.me", "telegram.me"].includes(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.port) return null;
  const path = url.pathname.replace(/\/+$/, ""); // tolerate a trailing slash
  if (!PATH_RE.test(path)) return null;

  const handle = path.slice(1);
  return { url: `https://t.me/${handle}`, label: HANDLE_RE.test(handle) ? `@${handle}` : "Telegram" };
}

export function parseContact(env: { email?: string | null; telegram?: string | null }): ContactDetails {
  return { email: parseContactEmail(env.email), telegram: parseTelegram(env.telegram) };
}
