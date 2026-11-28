import Decimal from 'decimal.js';
import { money } from '../../../common/utils/money';

/**
 * Price of N months of a plan (ADMIN_PANEL.md decision 3): monthly price × months, minus the plan's
 * discount for exactly that many months (3/6/9/12 by default). Any other duration ("custom") has no
 * discount. Money is decimal.js end to end, rounded half-up to paise.
 */
export interface Quote {
  monthlyPrice: string;
  months: number;
  gross: string;
  discountPercent: string;
  amount: string;
}

export function discountFor(discounts: unknown, months: number): Decimal {
  if (discounts === null || typeof discounts !== 'object') return new Decimal(0);
  const raw = (discounts as Record<string, unknown>)[String(months)];
  if (typeof raw !== 'string' && typeof raw !== 'number') return new Decimal(0);
  try {
    const pct = new Decimal(raw);
    return pct.isFinite() && pct.gte(0) && pct.lte(100) ? pct : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

export function quote(monthlyPrice: Decimal.Value, months: number, discounts: unknown): Quote {
  if (!Number.isInteger(months) || months < 1) throw new Error('months must be a positive integer');
  const price = new Decimal(monthlyPrice);
  const gross = money(price.mul(months));
  const pct = discountFor(discounts, months);
  const amount = money(gross.mul(new Decimal(100).minus(pct)).div(100));
  return {
    monthlyPrice: money(price).toFixed(2),
    months,
    gross: gross.toFixed(2),
    discountPercent: pct.toString(),
    amount: amount.toFixed(2),
  };
}

/** Validates a client-sent amount string ("599", "1709.15"): positive, at most 2 decimals. */
export const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
