import Decimal from 'decimal.js';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Money rules for purchases. Pure functions: no database, no clock.
 * All money is rounded half-up to paise (2 decimals); costs per unit are kept to 4 decimals.
 */

export const MONEY_DP = 2;
export const COST_DP = 4;
export const MAX_AMOUNT = new Decimal('99999999999.99'); // fits NUMERIC(14,2)
export const MAX_ROUND_OFF = new Decimal(5);

const money = (v: Decimal) => v.toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);

export interface PurchaseLineInput {
  /** Quantity in the purchase unit (e.g. 5 BAG). */
  quantity: Decimal;
  /** The same quantity in base units (e.g. 125 KG). */
  baseQuantity: Decimal;
  /** Price per ONE purchase unit, before discount and tax. */
  unitCost: Decimal;
  /** Discount for the whole line, in rupees. */
  discount: Decimal;
  taxRatePercent: Decimal;
}

export interface PurchaseLineFigures {
  gross: Decimal;
  discount: Decimal;
  net: Decimal;
  tax: Decimal;
  /** net + tax. */
  lineTotal: Decimal;
  /** This line's share of additional costs (freight, loading). */
  extra: Decimal;
  /** What the shop owes the supplier for this line: lineTotal + extra. */
  payable: Decimal;
  /** The part of the payable that becomes the cost of the goods in stock. */
  costBasis: Decimal;
  /** Landed cost of one BASE unit (4 decimals); this is the cost the stock engine receives. */
  baseUnitCost: Decimal;
}

export interface PurchaseFigures {
  lines: PurchaseLineFigures[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  additionalCosts: Decimal;
  roundOff: Decimal;
  total: Decimal;
}

/**
 * Splits `total` across lines in proportion to `weights` to the paisa, so the shares always add up to
 * exactly `total` (largest-remainder method; ties go to the earlier line).
 */
export function allocateProportionally(total: Decimal, weights: Decimal[]): Decimal[] {
  if (total.isZero()) return weights.map(() => new Decimal(0));
  const sum = weights.reduce((a, w) => a.plus(w), new Decimal(0));
  if (sum.lte(0)) {
    throw new DomainError(
      'ADDITIONAL_COST_UNALLOCATABLE',
      'Additional costs cannot be spread because every line is free',
    );
  }
  const cents = total.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const raw = weights.map((w) => cents.mul(w).div(sum));
  const floors = raw.map((r) => r.floor());
  let left = cents.minus(floors.reduce((a, f) => a.plus(f), new Decimal(0))).toNumber();
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
 * Works out every figure of a purchase from what the user typed. The server always recomputes; client totals
 * are never trusted.
 *
 * Input tax (GST) on purchases is recoverable as credit, so when the shop is GST-registered it is NOT part of
 * the stock cost; otherwise it is. (Owner/accountant to confirm before production: see RISKS_AND_ASSUMPTIONS.)
 */
export function computePurchase(
  inputs: PurchaseLineInput[],
  additionalCosts: Decimal,
  roundOff: Decimal,
  gstEnabled: boolean,
): PurchaseFigures {
  if (inputs.length === 0) throw new DomainError('PURCHASE_EMPTY', 'Add at least one item');
  if (roundOff.abs().gt(MAX_ROUND_OFF)) {
    throw new DomainError(
      'ROUND_OFF_TOO_LARGE',
      `Round-off can be at most ₹${MAX_ROUND_OFF.toFixed()}`,
    );
  }

  const partial = inputs.map((l, index) => {
    const gross = money(l.quantity.mul(l.unitCost));
    if (l.discount.gt(gross)) {
      throw new DomainError(
        'DISCOUNT_EXCEEDS_LINE',
        'A discount cannot be more than the line amount',
        {
          line: index + 1,
        },
      );
    }
    const net = gross.minus(l.discount);
    const tax = money(net.mul(l.taxRatePercent).div(100));
    return { gross, discount: l.discount, net, tax, lineTotal: net.plus(tax) };
  });

  const extras = allocateProportionally(
    additionalCosts,
    partial.map((p) => p.net),
  );

  const lines: PurchaseLineFigures[] = partial.map((p, i) => {
    const extra = extras[i]!;
    const costBasis = p.net.plus(extra).plus(gstEnabled ? 0 : p.tax);
    return {
      ...p,
      extra,
      payable: p.lineTotal.plus(extra),
      costBasis,
      baseUnitCost: costBasis
        .div(inputs[i]!.baseQuantity)
        .toDecimalPlaces(COST_DP, Decimal.ROUND_HALF_UP),
    };
  });

  const sum = (pick: (l: PurchaseLineFigures) => Decimal) =>
    lines.reduce((a, l) => a.plus(pick(l)), new Decimal(0));
  const total = sum((l) => l.payable).plus(roundOff);
  if (total.lt(0))
    throw new DomainError('PURCHASE_TOTAL_NEGATIVE', 'The purchase total cannot be negative');
  if (total.gt(MAX_AMOUNT))
    throw new DomainError('AMOUNT_TOO_LARGE', 'The purchase total is too large');

  return {
    lines,
    subtotal: sum((l) => l.gross),
    discountTotal: sum((l) => l.discount),
    taxTotal: sum((l) => l.tax),
    additionalCosts,
    roundOff,
    total,
  };
}

/**
 * The amount that should have been billed (or credited) once `done` of `ordered` base units have been
 * received (or returned): proportional, half-up to the paisa, and EXACTLY `payable` when everything is done.
 * Each receipt posts the difference to what was already posted, so partial receipts always add up to the total.
 */
export function cumulativeAmount(payable: Decimal, done: Decimal, ordered: Decimal): Decimal {
  if (done.gt(ordered)) throw new RangeError('done cannot exceed ordered');
  if (done.equals(ordered)) return payable;
  return money(payable.mul(done).div(ordered));
}
