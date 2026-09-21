/**
 * Calendar date arithmetic — deliberately free of timezone dependence.
 *
 * A calendar day here is a *label* (`YYYY-MM-DD`), not an instant. Every
 * calculation goes through `Date.UTC`, so the grid comes out identical whether
 * the phone is in IST, in UTC, or in California. That is the same reasoning
 * behind storing `fin_events.date` as UTC midnight of the intended day rather
 * than a wall-clock moment.
 *
 * Nothing in this file may use the local-time getters (`getDate()`,
 * `getMonth()`, `getDay()`, `getFullYear()`) or `new Date(y, m, d)`. Those read
 * the *device* timezone, which is precisely the bug that used to file a receipt
 * scanned at 1 am under the previous day. Only `todayIST()` (from format.ts)
 * may consult the clock, and it pins the timezone explicitly.
 *
 * Pure and dependency-free: no React, no `import.meta.env`, no fetch — so the
 * whole grid can be exercised from Node in `scripts/calendar.test.ts`.
 */
import { IST_TIMEZONE, todayIST } from './format';

/** A calendar day as `YYYY-MM-DD`. */
export type DayKey = string;

export interface CalendarCell {
  key: DayKey;
  /** Day of the month, 1–31. */
  day: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  inMonth: boolean;
  /** Saturday or Sunday — used for a lighter background. */
  weekend: boolean;
}

export interface YearMonth {
  year: number;
  /** 1–12, unlike `Date`'s 0–11. */
  month: number;
}

const MS_PER_DAY = 86_400_000;

/** Sunday-first, matching how the grid is laid out. */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * UTC midnight of the given calendar day.
 *
 * `month` is 1–12 and both `month` and `day` are allowed to overflow (13, 0,
 * 32, -1), because `Date.UTC` normalises them — that is what makes `addDays`
 * and `addMonths` correct across month and year boundaries without any special
 * casing.
 */
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** A UTC-midnight date back to its day key, read in UTC. */
function keyOf(date: Date): DayKey {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * `YYYY-MM-DD` → its three numbers, or null if it is not a real calendar day.
 *
 * The round-trip through `utc()` is the point: the regex alone would accept
 * `2026-02-30` or `2026-13-01`, which normalise to a different day than they
 * name. Requiring the numbers to survive normalisation unchanged rejects them.
 */
export function parseDayKey(key: DayKey): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = utc(year, month, day);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** `(2026, 9, 21)` → `'2026-09-21'`. */
export function dayKey(year: number, month: number, day: number): DayKey {
  return keyOf(utc(year, month, day));
}

/** Shift a day key by whole days. Negative moves backwards. */
export function addDays(key: DayKey, days: number): DayKey {
  const parts = parseDayKey(key);
  if (!parts) return key;
  return keyOf(utc(parts.year, parts.month, parts.day + days));
}

/** Shift a year/month by whole months, rolling the year over as needed. */
export function addMonths(year: number, month: number, delta: number): YearMonth {
  const d = utc(year, month + delta, 1);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Whole days between two keys (`to - from`), or null if either is invalid. */
export function dayDelta(from: DayKey, to: DayKey): number | null {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  if (!a || !b) return null;
  return Math.round((utc(b.year, b.month, b.day).getTime() - utc(a.year, a.month, a.day).getTime()) / MS_PER_DAY);
}

/** Number of days in a month. Day 0 of the next month is the last of this one. */
export function daysInMonth(year: number, month: number): number {
  return utc(year, month + 1, 0).getUTCDate();
}

/** The month's own bounds, `01` to its last day. */
export function monthRange(year: number, month: number): { from: DayKey; to: DayKey } {
  return { from: dayKey(year, month, 1), to: dayKey(year, month, daysInMonth(year, month)) };
}

/**
 * The month laid out as Sunday-first weeks.
 *
 * Leading and trailing cells come from the adjacent months so every week is
 * full — a grid that starts on the 1st mid-week looks broken. Those cells are
 * marked `inMonth: false` so they can be dimmed, but they are real days and
 * still carry their events.
 *
 * The result is 4–6 weeks of 7, i.e. 28–42 cells.
 */
export function monthMatrix(year: number, month: number): CalendarCell[][] {
  const first = utc(year, month, 1);
  const lead = first.getUTCDay(); // 0 = Sunday
  const total = daysInMonth(year, month);
  // Round up to whole weeks, so the last row is complete.
  const cellCount = Math.ceil((lead + total) / 7) * 7;

  const weeks: CalendarCell[][] = [];
  let week: CalendarCell[] = [];

  for (let i = 0; i < cellCount; i += 1) {
    // Plain UTC millisecond steps: UTC has no DST, so a day is always exactly
    // MS_PER_DAY long and no calendar day can be skipped or repeated.
    const d = new Date(first.getTime() + (i - lead) * MS_PER_DAY);
    const weekday = d.getUTCDay();
    week.push({
      key: keyOf(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
      weekend: weekday === 0 || weekday === 6,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  return weeks;
}

/**
 * The range the *grid* covers, which is wider than the month itself.
 *
 * The fetch must use this and not `monthRange`: the first and last rows show
 * real days from the neighbouring months, and asking only for the month would
 * leave those cells visibly empty while the same day shows its events one
 * month over.
 */
export function gridRange(year: number, month: number): { from: DayKey; to: DayKey } {
  const weeks = monthMatrix(year, month);
  const first = weeks[0][0];
  const lastWeek = weeks[weeks.length - 1];
  return { from: first.key, to: lastWeek[lastWeek.length - 1].key };
}

/** `'September 2026'`. */
export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(utc(year, month, 1));
}

/**
 * `'Monday, 21 September'`.
 *
 * No year: the agenda always sits under a month header that carries it. The
 * formatter is pinned to IST like `formatDate`, so a UTC-midnight date cannot
 * render as the day before.
 */
export function formatDayLong(key: DayKey): string {
  const parts = parseDayKey(key);
  if (!parts) return String(key);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(utc(parts.year, parts.month, parts.day));
}

/** `'21 Sep'` — for chips and compact rows. */
export function formatDayShort(key: DayKey): string {
  const parts = parseDayKey(key);
  if (!parts) return String(key);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: 'numeric',
    month: 'short',
  }).format(utc(parts.year, parts.month, parts.day));
}

/**
 * `'09:30'` → `'9:30 am'`.
 *
 * Done by hand rather than through `Intl` on a constructed date: a time-of-day
 * is not an instant, and turning it into one would drag a timezone along and
 * shift it. Returns `''` for null/empty so callers can render unconditionally.
 */
export function formatTime(hhmm: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!m) return '';
  const hours = Number(m[1]);
  const suffix = hours < 12 ? 'am' : 'pm';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** `'Today'` / `'Tomorrow'` / `'Yesterday'`, or null for anything else. */
export function relativeDayLabel(
  key: DayKey,
  today: DayKey = todayIST(),
): 'Today' | 'Tomorrow' | 'Yesterday' | null {
  const diff = dayDelta(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return null;
}

/** The minimum an event needs to be placed on the grid. */
export interface DatedEvent {
  /** A day key, or a full ISO timestamp — `toDayKey` accepts either. */
  date: string;
  endDate?: string | null;
}

/**
 * A day key from whatever the API actually sent.
 *
 * `fin_events.date` is UTC midnight, and JSON renders that as
 * `2026-09-21T00:00:00.000Z` — not `2026-09-21`. Requiring the bare form would
 * therefore silently discard every event the API returned, which is exactly
 * what it did: the grid came up empty while the agenda, which slices the string
 * instead, looked fine.
 *
 * The first ten characters are the UTC calendar day, which is the day as
 * stored, so the reduction is lossless rather than a guess. The result is then
 * validated as a real date, so junk still returns null.
 */
export function toDayKey(value: string | null | undefined): DayKey | null {
  const slice = String(value ?? '').slice(0, 10);
  return parseDayKey(slice) ? slice : null;
}

/**
 * Bucket events by every day they cover, within `[from, to]`.
 *
 * A multi-day event deliberately lands in *each* of its days, so a trip shows
 * across its whole span instead of only where it starts. Days outside the
 * window are skipped, which also bounds the work: a typo'd end date in 2099
 * cannot generate thousands of buckets, only the handful of cells actually
 * rendered.
 *
 * Within a day, order follows the input — the API already sorts by start date
 * then all-day-before-timed, so an event that began earlier leads the day.
 */
export function eventsByDay<T extends DatedEvent>(
  events: T[],
  from: DayKey,
  to: DayKey,
): Map<DayKey, T[]> {
  const map = new Map<DayKey, T[]>();
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  if (!start || !end) return map;

  const windowStart = utc(start.year, start.month, start.day).getTime();
  const windowEnd = utc(end.year, end.month, end.day).getTime();

  for (const event of events) {
    // `toDayKey`, not `parseDayKey`: the API sends full ISO timestamps.
    const own = toDayKey(event.date);
    if (!own) continue;
    const ownParts = parseDayKey(own)!;

    const ownStart = utc(ownParts.year, ownParts.month, ownParts.day).getTime();
    const tailKey = toDayKey(event.endDate);
    const tailParts = tailKey ? parseDayKey(tailKey) : null;
    const ownEnd = tailParts ? utc(tailParts.year, tailParts.month, tailParts.day).getTime() : ownStart;

    const firstMs = Math.max(ownStart, windowStart);
    const lastMs = Math.min(ownEnd, windowEnd);
    // Wholly outside the window — or ending before it starts, which the API
    // rejects but a stale cached row could still produce.
    if (lastMs < firstMs) continue;

    for (let ms = firstMs; ms <= lastMs; ms += MS_PER_DAY) {
      const key = keyOf(new Date(ms));
      const existing = map.get(key);
      if (existing) existing.push(event);
      else map.set(key, [event]);
    }
  }

  return map;
}

/**
 * The events to show for one day, from the already-bucketed map.
 *
 * A small convenience so the page does not have to repeat the `?? []`.
 */
export function eventsOn(map: Map<DayKey, DatedEvent[]>, key: DayKey) {
  return map.get(key) ?? [];
}
