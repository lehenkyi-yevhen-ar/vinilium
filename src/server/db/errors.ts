/**
 * True for a Postgres "foreign key violation" (SQLSTATE 23503), however many wrappers (drizzle, the driver) the error is inside.
 * Used where a row is written for a user who may have just deleted their account: the session was valid when the request began and the
 * user row is gone when the insert runs. That is an ordinary race, answered with "signed out", not a crash.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if ((e as { code?: unknown }).code === "23503") return true;
  }
  return false;
}
