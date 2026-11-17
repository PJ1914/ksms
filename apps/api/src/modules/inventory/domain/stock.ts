import Decimal from 'decimal.js';

/**
 * Pure inventory rules: weighted-average costing and FEFO batch allocation.
 * No database, no framework, no JS floats. Quantities are in the product's base unit.
 */

export const COST_SCALE = 4; // NUMERIC(14,4) per base unit

/** Inbound movement types (stock goes up) and outbound ones (stock goes down). */
export const INBOUND_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'SALE_RETURN',
  'ADJUSTMENT_IN',
  'TRANSFER_IN',
  'CANCELLATION_REVERSAL',
] as const;
export const OUTBOUND_TYPES = [
  'SALE',
  'PURCHASE_RETURN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'EXPIRY',
  'TRANSFER_OUT',
] as const;
export type InboundType = (typeof INBOUND_TYPES)[number];
export type OutboundType = (typeof OUTBOUND_TYPES)[number];

/**
 * Moving weighted-average cost after receiving `quantity` at `unitCost`.
 * - Normal case: (onHand x avg + qty x cost) / (onHand + qty), rounded half-up to 4 decimals.
 * - If on-hand is zero or negative (a deficit allowed by an audited override), the old average no longer
 *   describes any physical stock, so the new average is simply the incoming cost.
 */
export function weightedAverageCost(
  onHand: Decimal,
  currentAverage: Decimal,
  quantity: Decimal,
  unitCost: Decimal,
): Decimal {
  if (quantity.lte(0)) throw new RangeError('quantity must be positive');
  if (unitCost.lt(0)) throw new RangeError('unit cost cannot be negative');
  if (onHand.lte(0)) return unitCost.toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);
  const total = onHand.mul(currentAverage).plus(quantity.mul(unitCost));
  return total.div(onHand.plus(quantity)).toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);
}

export interface BatchStock {
  id: string;
  /** ISO date YYYY-MM-DD, or null when the batch does not expire. */
  expiryDate: string | null;
  quantity: Decimal;
}

export interface Allocation {
  batchId: string;
  quantity: Decimal;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** What could not be covered by usable batches. */
  shortfall: Decimal;
  /** Quantity sitting in batches that are already expired (never used for sales). */
  expiredQuantity: Decimal;
}

/** Expired means the expiry date is strictly before today (stock expiring today can still be sold today). */
export const isExpired = (expiryDate: string | null, today: string): boolean =>
  expiryDate !== null && expiryDate < today;

/**
 * First-Expiring, First-Out. Batches are consumed in order of earliest expiry; batches without an expiry
 * come last; ties keep the given order (the caller passes them oldest-received first).
 * Expired batches are skipped unless `includeExpired` (used only when writing expired stock off).
 */
export function allocateFefo(
  batches: BatchStock[],
  quantity: Decimal,
  today: string,
  includeExpired = false,
): AllocationResult {
  if (quantity.lte(0)) throw new RangeError('quantity must be positive');
  const indexed = batches.map((b, i) => ({ b, i }));
  indexed.sort((x, y) => {
    const ex = x.b.expiryDate;
    const ey = y.b.expiryDate;
    if (ex !== ey) {
      if (ex === null) return 1;
      if (ey === null) return -1;
      return ex < ey ? -1 : 1;
    }
    return x.i - y.i;
  });

  let remaining = quantity;
  let expiredQuantity = new Decimal(0);
  const allocations: Allocation[] = [];
  for (const { b } of indexed) {
    if (b.quantity.lte(0)) continue;
    if (!includeExpired && isExpired(b.expiryDate, today)) {
      expiredQuantity = expiredQuantity.plus(b.quantity);
      continue;
    }
    if (remaining.lte(0)) continue;
    const take = Decimal.min(b.quantity, remaining);
    allocations.push({ batchId: b.id, quantity: take });
    remaining = remaining.minus(take);
  }
  return { allocations, shortfall: Decimal.max(remaining, 0), expiredQuantity };
}

/** Today's date in India (YYYY-MM-DD); stock expiry is a shop-local calendar matter. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** Stock value of a balance: only positive stock has value. Rounded half-up to paise. */
export function stockValue(onHand: Decimal, averageCost: Decimal): Decimal {
  return Decimal.max(onHand, 0).mul(averageCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
