/**
 * Normalises an Indian mobile number to its 10 digits: "+91 98765-43210", "09876543210" -> "9876543210".
 * Returns null when it is not a valid Indian mobile number (must start with 6-9).
 */
export function normalizeIndianPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
