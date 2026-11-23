import Decimal from 'decimal.js';
import { AppException } from '../../../common/errors/app.exception';
import { isRealIsoDate, startOfIndiaDay, todayInIndia } from '../../../common/utils/dates';

/** Longest period one report may cover (keeps every report quick at shop scale). */
export const MAX_RANGE_DAYS = 366;
/** When no period is given a report covers the last 30 days including today. */
export const DEFAULT_RANGE_DAYS = 30;

export interface ReportRange {
  /** First and last day (India calendar), inclusive. */
  from: string;
  to: string;
  /** The same period as instants: [fromTs, toTs). Use these on timestamp columns. */
  fromTs: Date;
  toTs: Date;
  days: number;
}

export function addDays(isoDate: string, days: number): string {
  const t = new Date(`${isoDate}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const wholeDaysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

/** Turns optional `from` / `to` dates into a checked period. Real dates only; `from` may not be after `to`. */
export function resolveRange(from?: string, to?: string, today = todayInIndia()): ReportRange {
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== undefined && !isRealIsoDate(value)) {
      throw new AppException('INVALID_DATE', `${name} must be a real date, YYYY-MM-DD`, 400);
    }
  }
  const end = to ?? today;
  const start = from ?? addDays(end, -(DEFAULT_RANGE_DAYS - 1));
  if (start > end) {
    throw new AppException('INVALID_RANGE', 'from must not be after to', 400);
  }
  const days = wholeDaysBetween(start, end) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new AppException(
      'INVALID_RANGE',
      `A report can cover at most ${MAX_RANGE_DAYS} days; narrow the dates`,
      400,
    );
  }
  return {
    from: start,
    to: end,
    fromTs: startOfIndiaDay(start),
    toTs: startOfIndiaDay(addDays(end, 1)),
    days,
  };
}

/** A database number (or nothing) as an exact decimal. */
export const dec = (v: string | number | null | undefined): Decimal => new Decimal(v ?? 0);
/** Money as the API sends it: a decimal string with two places. */
export const money = (v: string | number | Decimal | null | undefined): string =>
  (v instanceof Decimal ? v : dec(v)).toFixed(2);
export const quantity = (v: string | number | Decimal | null | undefined): string =>
  (v instanceof Decimal ? v : dec(v)).toFixed(3);

/** `part` as a percentage of `whole` with two places; "0.00" when there is nothing to divide by. */
export function percentOf(part: Decimal, whole: Decimal): string {
  return whole.isZero() ? '0.00' : part.div(whole).times(100).toFixed(2);
}

export const sumOf = (values: Decimal[]): Decimal =>
  values.reduce((a, b) => a.plus(b), new Decimal(0));
