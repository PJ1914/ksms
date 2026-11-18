import { AppException } from '../errors/app.exception';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** True only for a real calendar date written YYYY-MM-DD (so "2026-02-31" is refused, not passed to the database). */
export function isRealIsoDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in India (YYYY-MM-DD); shop days follow the India calendar, not the server's. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight at the start of an India-time calendar day, as an instant. */
export function startOfIndiaDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/**
 * Turns a `from` / `to` filter into a time range on a timestamp column.
 *  - A plain date (YYYY-MM-DD) means the WHOLE India-time day: `from` starts at its midnight and `to` includes
 *    that entire day (the range ends before the next midnight).
 *  - A full timestamp is used exactly as given.
 * Impossible dates are refused (400) instead of reaching the database.
 */
export function timestampRange(
  from?: string,
  to?: string,
): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lt?: Date; lte?: Date } = {};
  if (from)
    range.gte = DATE_ONLY.test(from)
      ? startOfIndiaDay(requireDate(from, 'from'))
      : requireInstant(from, 'from');
  if (to) {
    if (DATE_ONLY.test(to)) {
      range.lt = new Date(startOfIndiaDay(requireDate(to, 'to')).getTime() + DAY_MS);
    } else {
      range.lte = requireInstant(to, 'to');
    }
  }
  return range;
}

/** Validates a date-only filter for a DATE column (no time zone involved) and returns it as a UTC-midnight Date. */
export function dateOnly(value: string, field: string): Date {
  return new Date(`${requireDate(value, field)}T00:00:00Z`);
}

function requireDate(value: string, field: string): string {
  if (!isRealIsoDate(value)) {
    throw new AppException('INVALID_DATE', `${field} must be a real date, YYYY-MM-DD`, 400);
  }
  return value;
}

function requireInstant(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppException('INVALID_DATE', `${field} must be a valid date or timestamp`, 400);
  }
  return d;
}
