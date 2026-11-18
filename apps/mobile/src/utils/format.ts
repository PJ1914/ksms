/** 98.000 -> "98", 1.500 -> "1.5", 0.250 -> "0.25" (quantities are shown without trailing zeros). */
export function trimZeros(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

/** "2026-11-20" -> "20 Nov 2026" (the date as written, no time zone shifting). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** A timestamp as the shop's local date and time, e.g. "20 Nov 2026, 3:05 pm" (India time). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  const date = formatDate(ist.toISOString().slice(0, 10));
  let h = ist.getUTCHours();
  const min = String(ist.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${date}, ${h}:${min} ${ampm}`;
}

/** Plain words for the API's status and type codes. */
const WORDS: Record<string, string> = {
  PARTIALLY_RECEIVED: 'Part received',
  BANK_TRANSFER: 'Bank transfer',
  CREDIT_SALE: 'Credit sale',
  OPENING_BALANCE: 'Opening balance',
  PURCHASE_RETURN: 'Purchase return',
  SALE_RETURN: 'Sale return',
  CANCELLATION_REVERSAL: 'Cancellation',
  PURCHASE_RECEIPT: 'Purchase received',
  ADJUSTMENT_IN: 'Stock added',
  ADJUSTMENT_OUT: 'Stock removed',
};
export function words(code: string): string {
  if (WORDS[code]) return WORDS[code];
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Badge colour for a purchase status. */
export function purchaseTone(status: string): 'good' | 'bad' | 'warn' | 'neutral' {
  return status === 'RECEIVED'
    ? 'good'
    : status === 'CANCELLED'
      ? 'bad'
      : status === 'PARTIALLY_RECEIVED'
        ? 'warn'
        : 'neutral';
}
