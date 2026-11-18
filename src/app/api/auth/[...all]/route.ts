import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";
import { guardAuthRequest } from "@/server/auth/guard";
import { withRetryAfter } from "@/server/auth/retry-after";

// Lazy so that importing this route at build time doesn't require secrets.
export async function GET(request: Request) {
  const blocked = await guardAuthRequest(request);
  if (blocked) return blocked;
  return withRetryAfter(await toNextJsHandler(getAuth()).GET(request));
}

export async function POST(request: Request) {
  const blocked = await guardAuthRequest(request);
  if (blocked) return blocked;
  return withRetryAfter(await toNextJsHandler(getAuth()).POST(request));
}
