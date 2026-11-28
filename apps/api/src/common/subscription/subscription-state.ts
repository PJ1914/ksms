import type { SubscriptionState } from '@ksms/constants';

/**
 * A shop's subscription state, computed from dates on every request (ADMIN_PANEL.md §2.3). Nothing flips
 * at midnight and no job is needed: the server clock alone decides. Pure function, no I/O.
 *
 *   locked                              → LOCKED  (overrides everything; no reads, no writes)
 *   now <  endsAt                       → TRIAL (trial plan) or ACTIVE
 *   endsAt <= now < endsAt + graceDays  → GRACE   (full access, the app shows a banner)
 *   now >= endsAt + graceDays           → EXPIRED (read-only)
 *
 * All arithmetic is on UTC milliseconds, so daylight-saving or time zones never move a boundary.
 */
export const DAY_MS = 86_400_000;

export interface SubscriptionInput {
  now: Date;
  endsAt: Date;
  graceDays: number;
  isTrial: boolean;
  locked: boolean;
}

export interface SubscriptionStatus {
  state: SubscriptionState;
  canRead: boolean;
  canWrite: boolean;
  graceEndsAt: Date;
  /** Whole days until `endsAt` (rounded up), 0 once it has passed. */
  daysLeft: number;
  /** Whole days until read-only (rounded up), 0 once EXPIRED. */
  graceDaysLeft: number;
}

export function subscriptionState(i: SubscriptionInput): SubscriptionStatus {
  const now = i.now.getTime();
  const ends = i.endsAt.getTime();
  const graceEnds = ends + Math.max(0, i.graceDays) * DAY_MS;
  const daysLeft = Math.max(0, Math.ceil((ends - now) / DAY_MS));
  const graceDaysLeft = Math.max(0, Math.ceil((graceEnds - now) / DAY_MS));
  const base = { graceEndsAt: new Date(graceEnds), daysLeft, graceDaysLeft };

  if (i.locked) return { ...base, state: 'LOCKED', canRead: false, canWrite: false };
  if (now < ends) {
    return { ...base, state: i.isTrial ? 'TRIAL' : 'ACTIVE', canRead: true, canWrite: true };
  }
  if (now < graceEnds) return { ...base, state: 'GRACE', canRead: true, canWrite: true };
  return { ...base, state: 'EXPIRED', canRead: true, canWrite: false };
}

/**
 * Adds calendar months in UTC, end-of-month safe: Jan 31 + 1 month = Feb 28 (or 29), never Mar 3.
 * The time of day is kept. Negative months go back.
 */
export function addMonths(date: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new Error('months must be an integer');
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
