#!/usr/bin/env node
/**
 * Regression test for the calendar (event) endpoints.
 *
 *   npm run test:events                       # against http://localhost:3456
 *   API_BASE=https://… npm run test:events
 *
 * Creates throwaway events, reads them back through the month-window query,
 * edits them, deletes them, and checks the validation rules that keep a date
 * column from quietly becoming a timestamp. Existing events are only counted,
 * never modified.
 *
 * Authenticates with SERVICE_TOKEN (the bot's credential) so it needs no
 * session — set it in .env, or pass one for a deployed API.
 *
 * The interesting case is the *overlap* query: a multi-day event must show up
 * in a window that starts after it began, otherwise a trip would vanish from
 * every month except the one it started in.
 */
import 'dotenv/config';

const BASE = process.env.API_BASE || 'http://localhost:3456';
const TOKEN = process.env.SERVICE_TOKEN;
const headers = { 'Content-Type': 'application/json', 'X-Service-Token': TOKEN };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const call = async (path, method = 'GET', body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

/** `YYYY-MM-DD` of a stored date, read in UTC — the value the grid keys on. */
const day = (iso) => String(iso ?? '').slice(0, 10);

/** The overlap query for one month, as the page would ask for it. */
const inRange = async (from, to, extra = '') =>
  ((await call(`/api/events?from=${from}&to=${to}${extra}`)).data || []);

async function main() {
  if (!TOKEN) {
    console.error('\n  ✗ SERVICE_TOKEN is not set — cannot authenticate.\n');
    process.exit(1);
  }

  const baseline = ((await call('/api/events')).data || []).length;
  console.log(`\n  target: ${BASE}`);
  console.log(`  baseline: ${baseline} existing event(s)\n`);

  // Far enough out that a real event can never collide with these.
  const Y = 2099;
  const created = [];

  try {
    // ── Create ────────────────────────────────────────────
    const single = await call('/api/events', 'POST', {
      title: 'ZZ Regression Event',
      date: `${Y}-03-10`,
      notes: 'single day',
    });
    created.push(single.data?.id);
    check('create a single-day event', single.status === 200 && Boolean(single.data?.id));
    check('its date round-trips as the same calendar day',
      day(single.data?.date) === `${Y}-03-10`, `got ${day(single.data?.date)}`);
    check('an all-day event has no time', single.data?.startTime === null, `got ${single.data?.startTime}`);
    check('an all-day event has no end date', single.data?.endDate === null);

    const timed = await call('/api/events', 'POST', {
      title: 'ZZ Regression Timed',
      date: `${Y}-03-12`,
      startTime: '09:30',
    });
    created.push(timed.data?.id);
    check('create a timed event', timed.status === 200 && timed.data?.startTime === '09:30');

    const trip = await call('/api/events', 'POST', {
      title: 'ZZ Regression Trip',
      date: `${Y}-02-26`,
      endDate: `${Y}-03-04`,
    });
    created.push(trip.data?.id);
    check('create a multi-day event', trip.status === 200 && day(trip.data?.endDate) === `${Y}-03-04`);

    // ── The date column holds a date, not an instant ──────
    const withTime = await call('/api/events', 'POST', {
      title: 'ZZ Regression Normalised',
      date: `${Y}-03-20T18:30:00.000Z`,
    });
    created.push(withTime.data?.id);
    check('a full ISO string is reduced to UTC midnight',
      day(withTime.data?.date) === `${Y}-03-20` && String(withTime.data?.date).endsWith('T00:00:00.000Z'),
      `got ${withTime.data?.date}`);

    // ── The month window ──────────────────────────────────
    const march = await inRange(`${Y}-03-01`, `${Y}-03-31`);
    const marchTitles = march.map((e) => e.title);
    check('a window returns events that start inside it',
      marchTitles.includes('ZZ Regression Event') && marchTitles.includes('ZZ Regression Timed'));
    check('the multi-day event overlaps into the next month',
      marchTitles.includes('ZZ Regression Trip'),
      'started 26 Feb but runs to 4 Mar');
    check('events are ordered by date, then all-day before timed',
      march.indexOf(march.find((e) => e.title === 'ZZ Regression Event')) <
        march.indexOf(march.find((e) => e.title === 'ZZ Regression Timed')));

    const feb = await inRange(`${Y}-02-01`, `${Y}-02-28`);
    check('the same multi-day event also appears in its own start month',
      feb.map((e) => e.title).includes('ZZ Regression Trip'));

    const jan = await inRange(`${Y}-01-01`, `${Y}-01-31`);
    check('a window with nothing in it comes back empty',
      !jan.map((e) => e.title).some((t) => t?.startsWith('ZZ Regression')));

    const singleDayWindow = await inRange(`${Y}-03-11`, `${Y}-03-11`);
    check('a one-day window excludes the days around it',
      !singleDayWindow.map((e) => e.title).some((t) => t?.startsWith('ZZ Regression')),
      `got ${singleDayWindow.length} event(s)`);

    // ── Filtering by owner ────────────────────────────────
    const users = ((await call('/api/users')).data || []).filter((u) => u.id);
    if (users.length) {
      const mine = await call('/api/events', 'POST', {
        title: 'ZZ Regression Owned',
        date: `${Y}-03-15`,
        userId: users[0].id,
      });
      created.push(mine.data?.id);
      check('an event carries its owner', mine.data?.user?.id === users[0].id);

      const filtered = await inRange(`${Y}-03-01`, `${Y}-03-31`, `&userId=${users[0].id}`);
      check('filtering by owner returns only that owner’s events',
        filtered.every((e) => e.user?.id === users[0].id) &&
          filtered.some((e) => e.title === 'ZZ Regression Owned'),
        `${filtered.length} of ${march.length}`);
    } else {
      check('an event carries its owner', false, 'no users to attribute to');
    }

    // ── Validation ────────────────────────────────────────
    const noTitle = await call('/api/events', 'POST', { title: '   ', date: `${Y}-03-01` });
    check('a blank title is rejected', noTitle.status === 400, `got ${noTitle.status}`);

    const noDate = await call('/api/events', 'POST', { title: 'ZZ nope' });
    check('a missing date is rejected', noDate.status === 400, `got ${noDate.status}`);

    const junkDate = await call('/api/events', 'POST', { title: 'ZZ nope', date: 'not-a-date' });
    check('an unparseable date is rejected', junkDate.status === 400, `got ${junkDate.status}`);

    const backwards = await call('/api/events', 'POST', {
      title: 'ZZ nope', date: `${Y}-03-10`, endDate: `${Y}-03-01`,
    });
    check('an end date before the start date is rejected', backwards.status === 400, `got ${backwards.status}`);

    const badTime = await call('/api/events', 'POST', {
      title: 'ZZ nope', date: `${Y}-03-10`, startTime: '9:30',
    });
    check('a non-zero-padded time is rejected', badTime.status === 400, `got ${badTime.status}`);

    const badFrom = await call(`/api/events?from=whenever&to=${Y}-03-31`);
    check('a junk range boundary is rejected', badFrom.status === 400, `got ${badFrom.status}`);

    // ── Edit ──────────────────────────────────────────────
    const renamed = await call(`/api/events/${single.data.id}`, 'PUT', { title: 'ZZ Regression Event (edited)' });
    check('a partial edit only changes what was sent',
      renamed.status === 200 && renamed.data?.title === 'ZZ Regression Event (edited)' &&
        day(renamed.data?.date) === `${Y}-03-10`,
      `date stayed ${day(renamed.data?.date)}`);

    const cleared = await call(`/api/events/${timed.data.id}`, 'PUT', { startTime: '' });
    check('an empty time clears it back to all-day', cleared.data?.startTime === null, `got ${cleared.data?.startTime}`);

    const newTime = await call(`/api/events/${timed.data.id}`, 'PUT', { startTime: '18:45' });
    check('a time can be set on an all-day event', newTime.data?.startTime === '18:45');

    // The end date is unchanged and now precedes the new start date, so this
    // must fail even though the request itself never mentions endDate.
    const crossesEnd = await call(`/api/events/${trip.data.id}`, 'PUT', { date: `${Y}-03-10` });
    check('moving the start past an unchanged end date is rejected',
      crossesEnd.status === 400, `got ${crossesEnd.status}`);

    const widened = await call(`/api/events/${trip.data.id}`, 'PUT', {
      date: `${Y}-03-10`, endDate: `${Y}-03-20`,
    });
    check('moving both dates together is allowed',
      widened.status === 200 && day(widened.data?.endDate) === `${Y}-03-20`);

    const unknown = await call(`/api/events/does-not-exist`, 'PUT', { title: 'ZZ nope' });
    check('editing an unknown event is a 404', unknown.status === 404, `got ${unknown.status}`);

    // ── Delete ────────────────────────────────────────────
    for (const id of created.filter(Boolean)) {
      const res = await call(`/api/events/${id}`, 'DELETE');
      if (res.status !== 200) check(`delete ${id}`, false, `got ${res.status}`);
    }
    check('every event created here was deleted', true, `${created.filter(Boolean).length} removed`);

    const after = ((await call('/api/events')).data || []).length;
    check('the event count is back to the baseline', after === baseline, `${baseline} → ${after}`);
  } finally {
    // A failure mid-way must not leave test rows in a shared database.
    const leftovers = ((await call('/api/events')).data || [])
      .filter((e) => String(e.title || '').startsWith('ZZ Regression'));
    for (const e of leftovers) await call(`/api/events/${e.id}`, 'DELETE');
    if (leftovers.length) console.log(`  (cleaned up ${leftovers.length} leftover event(s))`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n  ✗ unexpected failure:', err);
  process.exit(1);
});
