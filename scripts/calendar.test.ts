/**
 * Tests for src/lib/calendar.ts — the month grid and day bucketing.
 *
 *   npm run test:calendar
 *
 * Pure: no React, no network, no database. Three things are pinned down here,
 * and only the first is ordinary:
 *
 *   1. The grid is right — 7 cells per week, Sunday-first, contiguous, with the
 *      month's own days marked and the neighbouring ones borrowed to fill.
 *   2. Multi-day events land on *every* day they span, and the window clips
 *      them, so a trip is visible across its whole length while a typo'd end
 *      date in 2099 cannot blow the grid up.
 *   3. The whole thing is timezone-independent. That is checked two ways: by
 *      scanning the source for local-time date APIs, and by recomputing the
 *      grid in child processes at UTC+14 and UTC−11 and requiring byte-identical
 *      output. A grid that shifted with the device's clock would pass every
 *      other assertion in this file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  dayDelta,
  dayKey,
  daysInMonth,
  eventsByDay,
  formatDayLong,
  formatDayShort,
  formatMonth,
  formatTime,
  gridRange,
  monthMatrix,
  monthRange,
  parseDayKey,
  relativeDayLabel,
  toDayKey,
} from '../src/lib/calendar.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? '✅' : '❌'} ${name}${
      ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`
    }`,
  );
  ok ? pass++ : fail++;
};
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/** Weekday of a day key, 0 = Sunday. The test's own independent reckoning. */
const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

/**
 * The canonical computation, used both for the local run and for the
 * child-process comparisons under extreme timezones.
 */
function gridFingerprint() {
  const months = [
    [2026, 1], [2026, 2], [2026, 3], [2026, 9], [2026, 12],
    [2027, 1], [2028, 2], [2024, 2], [2099, 12], [2000, 1],
  ] as const;

  const grids = months.map(([y, m]) => ({
    ym: [y, m],
    weeks: monthMatrix(y, m).map((w) => w.map((c) => `${c.key}${c.inMonth ? '' : '~'}`).join(',')),
    range: gridRange(y, m),
  }));

  const events = [
    { id: 'trip', date: '2026-08-28', endDate: '2026-09-03' },
    { id: 'single', date: '2026-09-21' },
    { id: 'open', date: '2026-09-30', endDate: null },
    { id: 'forever', date: '2026-09-10', endDate: '2099-01-01' },
    // The form the API actually returns: a full ISO timestamp, not a day key.
    { id: 'iso', date: '2026-09-05T00:00:00.000Z', endDate: '2026-09-07T00:00:00.000Z' },
  ];
  const bucketed = [...eventsByDay(events, '2026-08-30', '2026-10-03').entries()]
    .map(([k, v]) => `${k}:${v.map((e) => e.id).join('+')}`)
    .sort();

  return JSON.stringify({ grids, bucketed });
}

// ── Dump mode: the child processes just print the fingerprint ──
if (process.argv.includes('--dump')) {
  process.stdout.write(gridFingerprint());
  process.exit(0);
}

console.log('\n  calendar.ts — grid, bucketing and timezone independence\n');

// ── parseDayKey ────────────────────────────────────────────
console.log('  parseDayKey');
eq('a real date parses', parseDayKey('2026-09-21'), { year: 2026, month: 9, day: 21 });
eq('a leap day parses', parseDayKey('2028-02-29'), { year: 2028, month: 2, day: 29 });
eq('29 Feb in a common year is rejected', parseDayKey('2027-02-29'), null);
eq('30 Feb is rejected', parseDayKey('2026-02-30'), null);
eq('month 13 is rejected', parseDayKey('2026-13-01'), null);
eq('month 00 is rejected', parseDayKey('2026-00-10'), null);
eq('day 00 is rejected', parseDayKey('2026-09-00'), null);
eq('day 32 is rejected', parseDayKey('2026-09-32'), null);
eq('an unpadded key is rejected', parseDayKey('2026-9-21'), null);
eq('a full ISO timestamp is rejected', parseDayKey('2026-09-21T00:00:00.000Z'), null);
eq('empty is rejected', parseDayKey(''), null);
eq('junk is rejected', parseDayKey('not-a-date'), null);

// ── toDayKey ───────────────────────────────────────────────
// The API does not send `2026-09-21`; it sends `2026-09-21T00:00:00.000Z`,
// because the column is a DateTime. Accepting only the bare form is what left
// the grid empty on first render, so this is the regression that matters most.
console.log('\n  toDayKey');
eq('a bare day key passes through', toDayKey('2026-09-21'), '2026-09-21');
eq('the API’s ISO form reduces to its day', toDayKey('2026-09-21T00:00:00.000Z'), '2026-09-21');
eq('a non-midnight timestamp keeps its UTC day', toDayKey('2026-09-21T18:30:00.000Z'), '2026-09-21');
eq('null is null', toDayKey(null), null);
eq('undefined is null', toDayKey(undefined), null);
eq('junk is null', toDayKey('not-a-date'), null);
eq('a truncated string is null', toDayKey('2026-09'), null);
eq('an impossible day is null', toDayKey('2026-02-30T00:00:00.000Z'), null);

// ── dayKey / addDays / addMonths / dayDelta ────────────────
console.log('\n  arithmetic');
eq('dayKey pads', dayKey(2026, 9, 1), '2026-09-01');
eq('dayKey normalises an overflowing day', dayKey(2026, 9, 31), '2026-10-01');
eq('addDays forward within a month', addDays('2026-09-21', 5), '2026-09-26');
eq('addDays rolls over a month end', addDays('2026-09-30', 1), '2026-10-01');
eq('addDays rolls over a year end', addDays('2026-12-31', 1), '2027-01-01');
eq('addDays rolls backwards over a year start', addDays('2027-01-01', -1), '2026-12-31');
eq('addDays crosses February in a leap year', addDays('2028-02-28', 1), '2028-02-29');
eq('addDays crosses February in a common year', addDays('2027-02-28', 1), '2027-03-01');
eq('addDays by a whole year is 365 days', addDays('2027-01-01', 365), '2028-01-01');
eq('addDays is reversible', addDays(addDays('2026-09-21', 400), -400), '2026-09-21');
eq('addDays on a bad key is a no-op', addDays('nonsense', 3), 'nonsense');

eq('addMonths forward', addMonths(2026, 9, 1), { year: 2026, month: 10 });
eq('addMonths rolls the year', addMonths(2026, 12, 1), { year: 2027, month: 1 });
eq('addMonths backwards rolls the year', addMonths(2026, 1, -1), { year: 2025, month: 12 });
eq('addMonths by 12 is a year', addMonths(2026, 9, 12), { year: 2027, month: 9 });
eq('addMonths by -24 is two years back', addMonths(2026, 9, -24), { year: 2024, month: 9 });

eq('dayDelta forward', dayDelta('2026-09-21', '2026-09-26'), 5);
eq('dayDelta backwards', dayDelta('2026-09-26', '2026-09-21'), -5);
eq('dayDelta across a leap day', dayDelta('2028-02-28', '2028-03-01'), 2);
eq('dayDelta across a common February', dayDelta('2027-02-28', '2027-03-01'), 1);
eq('dayDelta is null on junk', dayDelta('x', '2026-09-21'), null);

eq('daysInMonth — September', daysInMonth(2026, 9), 30);
eq('daysInMonth — February in a common year', daysInMonth(2027, 2), 28);
eq('daysInMonth — February in a leap year', daysInMonth(2028, 2), 29);
eq('daysInMonth — December', daysInMonth(2026, 12), 31);
eq('monthRange spans the month', monthRange(2028, 2), { from: '2028-02-01', to: '2028-02-29' });

// ── monthMatrix ────────────────────────────────────────────
console.log('\n  monthMatrix');

// Sweep every month in a six-year span — including two leap years and a
// century-adjacent one — and assert the invariants hold everywhere.
const shapeProblems: string[] = [];
const contiguityProblems: string[] = [];
const duplicateProblems: string[] = [];
const weekdayProblems: string[] = [];
const countProblems: string[] = [];

for (let year = 2024; year <= 2029; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    const weeks = monthMatrix(year, month);
    const label = `${year}-${String(month).padStart(2, '0')}`;
    const cells = weeks.flat();

    if (weeks.length < 4 || weeks.length > 6 || weeks.some((w) => w.length !== 7)) {
      shapeProblems.push(`${label} (${weeks.length} weeks)`);
    }
    if (cells.some((c, i) => i > 0 && dayDelta(cells[i - 1].key, c.key) !== 1)) {
      contiguityProblems.push(label);
    }
    if (new Set(cells.map((c) => c.key)).size !== cells.length) {
      duplicateProblems.push(label);
    }
    // Every week must hold each weekday exactly once, and start on Sunday.
    if (weeks.some((w) => w.some((c, i) => weekdayOf(c.key) !== i))) {
      weekdayProblems.push(label);
    }
    if (weeks.some((w) => w.some((c) => c.weekend !== [0, 6].includes(weekdayOf(c.key))))) {
      weekdayProblems.push(`${label} weekend flag`);
    }
    if (cells.filter((c) => c.inMonth).length !== daysInMonth(year, month)) {
      countProblems.push(label);
    }
    if (cells.some((c) => c.day !== Number(c.key.slice(8)))) {
      countProblems.push(`${label} day number`);
    }
  }
}

check('72 months all come out as 4–6 weeks of exactly 7 days',
  shapeProblems.length === 0, shapeProblems.slice(0, 4).join(', '));
check('every cell is exactly one day after the one before it',
  contiguityProblems.length === 0, contiguityProblems.slice(0, 4).join(', '));
check('no day appears twice in a grid',
  duplicateProblems.length === 0, duplicateProblems.slice(0, 4).join(', '));
check('every week runs Sunday → Saturday, with weekends flagged',
  weekdayProblems.length === 0, weekdayProblems.slice(0, 4).join(', '));
check('the in-month cells are exactly the month’s own days, correctly numbered',
  countProblems.length === 0, countProblems.slice(0, 4).join(', '));

eq('the grid is Sunday-first', WEEKDAY_LABELS[0], 'Sun');

// A month starting on a Sunday needs no leading padding at all — the case an
// off-by-one in the lead calculation would hide behind every other month.
const feb2026 = monthMatrix(2026, 2);
eq('February 2026 starts on a Sunday', feb2026[0][0].key, '2026-02-01');
eq('and borrows no leading days', feb2026[0][0].inMonth, true);
eq('February 2026 is exactly 4 weeks', feb2026.length, 4);

// September 2026 starts on a Tuesday: two borrowed days, then 30, then three
// borrowed again → 5 weeks.
const sep2026 = monthMatrix(2026, 9);
eq('September 2026 borrows two leading days',
  sep2026[0].slice(0, 2).map((c) => c.key), ['2026-08-30', '2026-08-31']);
eq('September 2026 starts on Tuesday', sep2026[0][2].key, '2026-09-01');
eq('September 2026 is 5 weeks', sep2026.length, 5);
eq('and ends on Saturday 3 October', sep2026[4][6].key, '2026-10-03');
eq('the three trailing days are marked as outside the month',
  sep2026[4].slice(4).map((c) => c.inMonth), [false, false, false]);
eq('the 21st sits in the row starting 20 September', sep2026[3][1].key, '2026-09-21');

eq('gridRange covers the whole grid, not just the month',
  gridRange(2026, 9), { from: '2026-08-30', to: '2026-10-03' });
check('gridRange is strictly wider than monthRange',
  gridRange(2026, 9).from < monthRange(2026, 9).from && gridRange(2026, 9).to > monthRange(2026, 9).to);

// ── Formatting ─────────────────────────────────────────────
console.log('\n  formatting');
eq('formatMonth', formatMonth(2026, 9), 'September 2026');
eq('formatMonth — December', formatMonth(2026, 12), 'December 2026');
eq('formatDayLong', formatDayLong('2026-09-21'), 'Monday, 21 September');
// en-IN abbreviates September as "Sept", not "Sep" — the same as the app's
// existing formatDate, which already renders "21 Sept 2026" in the table.
eq('formatDayShort', formatDayShort('2026-09-21'), '21 Sept');
eq('formatDayShort — a short month', formatDayShort('2026-01-05'), '5 Jan');
eq('formatDayShort — December', formatDayShort('2026-12-31'), '31 Dec');
eq('formatDayLong on a bad key returns it unchanged', formatDayLong('oops'), 'oops');

eq('formatTime — midnight', formatTime('00:00'), '12:00 am');
eq('formatTime — morning', formatTime('09:30'), '9:30 am');
eq('formatTime — noon is pm, not am', formatTime('12:00'), '12:00 pm');
eq('formatTime — afternoon', formatTime('13:05'), '1:05 pm');
eq('formatTime — last minute of the day', formatTime('23:59'), '11:59 pm');
eq('formatTime — null is empty, not "Invalid Date"', formatTime(null), '');
eq('formatTime — undefined is empty', formatTime(undefined), '');
eq('formatTime — an unpadded time is empty', formatTime('9:30'), '');

eq('relativeDayLabel — today', relativeDayLabel('2026-09-21', '2026-09-21'), 'Today');
eq('relativeDayLabel — tomorrow', relativeDayLabel('2026-09-22', '2026-09-21'), 'Tomorrow');
eq('relativeDayLabel — yesterday', relativeDayLabel('2026-09-20', '2026-09-21'), 'Yesterday');
eq('relativeDayLabel — next week is null', relativeDayLabel('2026-09-28', '2026-09-21'), null);
eq('relativeDayLabel — tomorrow across a month end', relativeDayLabel('2026-10-01', '2026-09-30'), 'Tomorrow');

// ── eventsByDay ────────────────────────────────────────────
console.log('\n  eventsByDay');

const trip = { id: 'trip', date: '2026-08-28', endDate: '2026-09-03' };
const single = { id: 'single', date: '2026-09-21' };
const byDay = eventsByDay([trip, single], '2026-08-30', '2026-10-03');
const idsOn = (key: string) => (byDay.get(key) ?? []).map((e) => e.id);

eq('a single-day event lands on its day', idsOn('2026-09-21'), ['single']);
eq('and nowhere else', idsOn('2026-09-20'), []);
eq('a multi-day event lands on the day it starts', idsOn('2026-08-30'), ['trip']);
eq('and on every day it spans', idsOn('2026-09-01'), ['trip']);
eq('and on the day it ends', idsOn('2026-09-03'), ['trip']);
eq('but not the day after it ends', idsOn('2026-09-04'), []);
eq('days before the window are not bucketed', byDay.has('2026-08-28'), false);
eq('a two-day event covers exactly two days',
  eventsByDay([{ date: '2026-09-10', endDate: '2026-09-11' }], '2026-09-01', '2026-09-30').size, 2);
eq('a same-day start and end covers one day',
  eventsByDay([{ date: '2026-09-10', endDate: '2026-09-10' }], '2026-09-01', '2026-09-30').size, 1);
eq('an event wholly before the window is ignored',
  eventsByDay([{ date: '2026-08-01', endDate: '2026-08-05' }], '2026-09-01', '2026-09-30').size, 0);
eq('an event wholly after the window is ignored',
  eventsByDay([{ date: '2026-11-01' }], '2026-09-01', '2026-09-30').size, 0);
eq('an event starting in the window and running past it is clipped',
  eventsByDay([{ date: '2026-09-28', endDate: '2099-01-01' }], '2026-09-01', '2026-09-30').size, 3);
eq('an event starting before the window and running into it is clipped',
  eventsByDay([{ date: '2020-01-01', endDate: '2026-09-02' }], '2026-09-01', '2026-09-30').size, 2);
eq('an invalid date is skipped rather than throwing',
  eventsByDay([{ date: 'nonsense' }, single], '2026-09-01', '2026-09-30').size, 1);

// The exact shape GET /api/events returns — the case that was broken.
eq('eventsByDay accepts the ISO form the API sends',
  eventsByDay([{ date: '2026-09-21T00:00:00.000Z' }], '2026-09-01', '2026-09-30').size, 1);
eq('and reads a multi-day event’s ISO end date too',
  eventsByDay(
    [{ date: '2026-09-21T00:00:00.000Z', endDate: '2026-09-23T00:00:00.000Z' }],
    '2026-09-01',
    '2026-09-30',
  ).size, 3);
eq('and the ISO form lands on the right day, not the day before',
  [...eventsByDay([{ date: '2026-09-21T00:00:00.000Z' }], '2026-09-01', '2026-09-30').keys()],
  ['2026-09-21']);
eq('an invalid window yields an empty map', eventsByDay([single], 'x', 'y').size, 0);
eq('input order is preserved within a day',
  (eventsByDay(
    [{ id: 'a', date: '2026-09-01' }, { id: 'b', date: '2026-08-30', endDate: '2026-09-02' }],
    '2026-09-01',
    '2026-09-30',
  ).get('2026-09-01') ?? []).map((e) => e.id),
  ['a', 'b']);

// The bound that keeps a typo'd year from exploding the grid: the work is
// proportional to the days rendered, never to the span of the event.
const exploded = eventsByDay([{ date: '2026-09-10', endDate: '2099-01-01' }], '2026-09-01', '2026-09-30');
eq('a 2099 end date produces only the window’s days, not 26,000', exploded.size, 21);
eq('and the total bucket count stays bounded by the grid',
  [...exploded.values()].reduce((n, v) => n + v.length, 0), 21);

// ── Timezone independence ──────────────────────────────────
console.log('\n  timezone independence');

// 1. Static: no local-time date API may appear. The doc comments discuss them,
//    so strip comments before scanning. The `new Date(…)` pattern is written to
//    match a *local* constructor only — `new Date(Date.UTC(y, m, d))` and
//    `new Date(ms)` must not trip it, since those are exactly the correct forms.
const source = readFileSync(resolve(HERE, '../src/lib/calendar.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const forbidden: [string, RegExp][] = [
  ['getDate()', /\.getDate\s*\(/],
  ['getMonth()', /\.getMonth\s*\(/],
  ['getDay()', /\.getDay\s*\(/],
  ['getFullYear()', /\.getFullYear\s*\(/],
  ['getHours()', /\.getHours\s*\(/],
  ['getMinutes()', /\.getMinutes\s*\(/],
  ['getTimezoneOffset()', /getTimezoneOffset/],
  ['toLocaleDateString()', /toLocaleDateString/],
  ['toISOString()', /toISOString/],
  ['a local-time Date constructor', /new Date\s*\(\s*(?:\d{4}|[a-zA-Z_$][\w$]*)\s*,/],
];
const offenders = forbidden.filter(([, re]) => re.test(code)).map(([name]) => name);
check('the source uses no local-time date APIs', offenders.length === 0, offenders.join(', '));
check('and it does use the UTC ones',
  /getUTCDate\s*\(/.test(code) && /Date\.UTC\s*\(/.test(code));
check('the scan is looking at real code, not an empty string',
  code.includes('monthMatrix') && code.includes('eventsByDay'), `${code.length} chars`);

// 2. Dynamic: recompute the grid at the two most extreme offsets on earth and
//    require byte-identical output. UTC+14 (Kiritimati) and UTC−11 (Midway) are
//    25 hours apart, so any leak of the device's clock into a day key shifts a
//    day and shows up immediately.
const local = gridFingerprint();
const tsx = resolve(HERE, '../node_modules/.bin/tsx');
for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway', 'UTC']) {
  let out = '';
  try {
    out = execFileSync(tsx, [resolve(HERE, 'calendar.test.ts'), '--dump'], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    check(`the grid is identical at ${tz}`, false, `child process failed: ${(err as Error).message}`);
    continue;
  }
  check(`the grid is identical at ${tz}`, out === local, out === local ? '' : 'output differed');
}
check('the fingerprint actually contains the grid, so the comparison is not vacuous',
  local.length > 2000 && local.includes('2026-09-21') && local.includes(':trip'),
  `${local.length} bytes`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
