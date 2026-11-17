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
