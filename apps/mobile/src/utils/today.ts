/** Today's date in India (YYYY-MM-DD): shop days follow the India calendar, whatever the phone's time zone says. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
