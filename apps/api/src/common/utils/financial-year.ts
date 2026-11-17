/**
 * Indian financial year label for a date, e.g. 2026-11-18 -> "2026-27", 2027-03-31 -> "2026-27".
 * The year runs 1 April to 31 March, evaluated in India time (UTC+05:30) so late-evening
 * sales on 31 March still belong to the closing year.
 */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 3_600_000);
  const year = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? year : year - 1; // month index 3 = April
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}
