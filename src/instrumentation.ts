/**
 * Runs once when the Next.js server starts. In development a missing DEV_DATABASE_URL stops the server HERE, with a clear
 * message, instead of failing on the first request (or, worse, quietly using another database).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  const { databaseTarget } = await import("./server/db/target");
  databaseTarget();
}
