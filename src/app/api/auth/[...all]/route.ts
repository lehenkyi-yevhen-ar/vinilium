import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// Lazy so that importing this route at build time doesn't require secrets.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
