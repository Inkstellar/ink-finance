/**
 * Date helpers — the app is single-timezone: India (IST, UTC+5:30).
 *
 * Why not `new Date().toISOString().slice(0, 10)`? That is UTC, so between
 * 00:00 and 05:29 IST it returns *yesterday*. Receipts scanned late at night
 * were landing in the previous day's ledger because of exactly that.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

/** Today as `YYYY-MM-DD` in India, whatever timezone the process is in. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
