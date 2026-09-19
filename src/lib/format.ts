/** The app is single-timezone: everything is dated in India, always. */
export const IST_TIMEZONE = 'Asia/Kolkata';

export const formatINR = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatINRDecimal = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Transaction dates are stored as UTC midnight of the intended calendar day,
 * so rendering them in whatever timezone the device happens to be in shows the
 * previous day west of Greenwich. Pin the display to IST.
 */
export const formatDate = (date: string | Date): string => {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
};

export const formatPercent = (value: number): string => {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

/**
 * Today as `YYYY-MM-DD` in India, whatever timezone the device is in.
 *
 * Do NOT use `new Date().toISOString().slice(0, 10)` for this: that is UTC, so
 * between 00:00 and 05:29 IST it yields *yesterday*. Late-night entries and
 * scanned receipts were being dated a day early because of it.
 */
export const todayIST = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
