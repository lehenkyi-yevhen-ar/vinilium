/**
 * Better Auth reports how long to wait in `X-Retry-After`; clients, proxies and monitoring tools look for the standard `Retry-After`.
 * A 429 from the auth endpoints gets both (the same number of seconds).
 */
export function withRetryAfter(response: Response): Response {
  const seconds = response.headers.get("x-retry-after");
  if (response.status !== 429 || !seconds || response.headers.has("retry-after")) return response;
  const headers = new Headers(response.headers);
  headers.set("Retry-After", seconds);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
