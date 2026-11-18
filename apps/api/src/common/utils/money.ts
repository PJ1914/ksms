import Decimal from 'decimal.js';
import { DomainError } from '../errors/domain.error';

/**
 * Money helpers shared by purchases and sales. Pure functions, decimal.js only (never JS numbers for money).
 * Money is rounded half-up to the paisa (2 decimals).
 */

export const MONEY_DP = 2;
export const MAX_AMOUNT = new Decimal('99999999999.99'); // fits NUMERIC(14,2)

export const money = (v: Decimal): Decimal => v.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
export const sum = (values: Decimal[]): Decimal =>
  values.reduce((a, v) => a.plus(v), new Decimal(0));

/**
 * Splits `total` across lines in proportion to `weights`, to the paisa, so the shares ALWAYS add up to exactly
 * `total` (largest-remainder method; ties go to the earlier line). Used for freight on purchases and the
 * bill-level discount on sales.
 */
export function allocateProportionally(
  total: Decimal,
  weights: Decimal[],
  nothingToShareWith: { code: string; message: string } = {
    code: 'ALLOCATION_IMPOSSIBLE',
    message: 'There is nothing to share this amount across',
  },
): Decimal[] {
  if (total.isZero()) return weights.map(() => new Decimal(0));
  const whole = sum(weights);
  if (whole.lte(0)) throw new DomainError(nothingToShareWith.code, nothingToShareWith.message);
  const cents = total.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const raw = weights.map((w) => cents.mul(w).div(whole));
  const floors = raw.map((r) => r.floor());
  let left = cents.minus(sum(floors)).toNumber(); // a count of paise (whole number), safe as a JS number
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(floors[i]!) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const shares = floors.map((f) => f);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] = shares[i]!.plus(1);
    left -= 1;
  }
  return shares.map((c) => c.div(100));
}

/**
 * The amount that should have been posted once `done` of `whole` base units are done (received, returned):
 * proportional, half-up to the paisa, and EXACTLY `amount` when everything is done. Each step posts the
 * difference to what was already posted, so partial steps always add up to the exact total.
 */
export function cumulativeAmount(amount: Decimal, done: Decimal, whole: Decimal): Decimal {
  if (done.gt(whole)) throw new RangeError('done cannot exceed the whole');
  if (done.equals(whole)) return amount;
  return money(amount.mul(done).div(whole));
}
