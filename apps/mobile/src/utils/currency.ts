import Decimal from 'decimal.js';

/**
 * Format a decimal STRING as Indian-rupee text with lakh/crore grouping, e.g. "1234567.5" -> "₹12,34,567.50".
 * Never accepts JS numbers, so float errors cannot enter the display path.
 */
export function formatINR(amount: string): string {
  const d = new Decimal(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = d.isNegative();
  const [whole = '0', frac = '00'] = d.abs().toFixed(2).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}₹${grouped}.${frac}`;
}

// Comparisons and sign changes on decimal STRINGS (money and quantities). Never use Number() on these.
export const isPositive = (v: string): boolean => new Decimal(v).gt(0);
export const isNegative = (v: string): boolean => new Decimal(v).lt(0);
export const isZero = (v: string): boolean => new Decimal(v).isZero();
/** "-120.5" -> "120.50" */
export const absMoney = (v: string): string => new Decimal(v).abs().toFixed(2);
/**
 * Quantity stepper: add or remove one unit from a decimal STRING. A blank or invalid entry counts as 0,
 * and a step that would reach zero or below leaves the quantity unchanged (remove the line instead).
 */
export function stepQuantity(q: string, delta: 1 | -1): string {
  let d: Decimal;
  try {
    d = new Decimal(q.trim() || '0');
  } catch {
    d = new Decimal(0);
  }
  const next = d.plus(delta);
  return next.lte(0) ? (d.lte(0) ? '1' : d.toString()) : next.toString();
}
/**
 * One step down for a "−" button on a product row: the new quantity, or null when the line is at 1
 * or less (or not a number), meaning the caller should take the item off the bill.
 */
export function stepDownOrRemove(q: string): string | null {
  try {
    const d = new Decimal(q.trim());
    return d.gt(1) ? d.minus(1).toString() : null;
  } catch {
    return null;
  }
}
/** First amount greater than the second? */
export const isMoreThan = (a: string, b: string): boolean => new Decimal(a).gt(b);
