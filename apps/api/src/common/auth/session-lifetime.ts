const DAY_MS = 86_400_000;

/** When a session dies for good, however often it is refreshed (FIXES F5). */
export function absoluteExpiry(createdAt: Date, absoluteTtlDays: number): Date {
  return new Date(createdAt.getTime() + absoluteTtlDays * DAY_MS);
}

/** Next sliding expiry: `now + refreshTtl`, never past the absolute cap. */
export function slidingExpiry(
  createdAt: Date,
  refreshTtlDays: number,
  absoluteTtlDays: number,
  now = Date.now(),
): Date {
  const sliding = now + refreshTtlDays * DAY_MS;
  return new Date(Math.min(sliding, absoluteExpiry(createdAt, absoluteTtlDays).getTime()));
}
