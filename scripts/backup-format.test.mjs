/**
 * Tests for the database backup format — the encode/decode half of
 * `scripts/db-backup.mjs`.
 *
 *   npm run test:backup
 *
 * These are pure: no database, no files, no network. The interesting risk is
 * not the JSON plumbing, it is that a timestamp must survive the round trip as
 * the *same instant*. This codebase stores dates as UTC midnight of the
 * intended calendar day, so an encoder that reached for a local-time formatter
 * would silently shift every date by a day — the same bug that has bitten
 * `todayIST()`, `formatDate` and the calendar grid. That is checked two ways
 * below, the way `scripts/calendar.test.ts` checks its grid: a static scan of
 * the source for local-time APIs, and a dynamic comparison in child processes
 * pinned to extreme timezones.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  encodeValue,
  decodeValue,
  encodeRow,
  decodeRow,
  orderTables,
  makeBackup,
  validateBackup,
  summarise,
  BYTEA_MARKER,
} from './backup-format.mjs';

let pass = 0;
let fail = 0;

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/**
 * A comparison-safe rendering. `JSON.stringify` alone throws on a BigInt and
 * flattens a Buffer to `{"0":0,...}` — the very hazards the module under test
 * exists to handle, so the harness has to cope with them too.
 */
const show = (v) =>
  JSON.stringify(v, (_k, x) => {
    if (typeof x === 'bigint') return `${x}n`;
    if (x instanceof Date) return `Date(${x.toISOString()})`;
    if (Buffer.isBuffer(x)) return `Buffer(${x.toString('hex')})`;
    return x;
  });

const eq = (name, got, want) => {
  const same = show(got) === show(want);
  check(name, same, same ? '' : `got ${show(got)}, want ${show(want)}`);
};

console.log('\n  backup format\n');

// ── encodeValue ────────────────────────────────────────────
const TS = 'timestamp without time zone';
const BIG = 'bigint';

eq('null encodes to null', encodeValue(null, TS), null);
eq('undefined encodes to null', encodeValue(undefined, TS), null);

const d = new Date('2026-09-21T00:00:00.000Z');
const encD = encodeValue(d, TS);
check('a Date encodes to a string', typeof encD === 'string', typeof encD);
check('the encoded Date is UTC (ends in Z)', String(encD).endsWith('Z'), encD);
eq('the encoded Date is the exact instant', encD, '2026-09-21T00:00:00.000Z');

eq('a bigint encodes to a string', encodeValue(42n, BIG), '42');
eq('a large bigint keeps every digit',
  encodeValue(9007199254740993n, BIG), '9007199254740993');

const buf = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
eq('a Buffer encodes to a base64 marker',
  encodeValue(buf, 'bytea'), { [BYTEA_MARKER]: 'AAH//g==' });
check('a Uint8Array also encodes to the marker',
  encodeValue(new Uint8Array([1, 2, 3]), 'bytea')?.[BYTEA_MARKER] === 'AQID');

// Prisma hands `numeric`/`decimal` columns back as decimal.js instances.
const decimalLike = { toFixed: () => '0', toSign: () => 1, toString: () => '123.45' };
eq('a Decimal-like value encodes to a string',
  encodeValue(decimalLike, 'numeric'), '123.45');

eq('a number passes through', encodeValue(1234.5, 'double precision'), 1234.5);
eq('a string passes through', encodeValue('hello', 'text'), 'hello');
eq('a boolean passes through', encodeValue(false, 'boolean'), false);
eq('a json object passes through',
  encodeValue({ a: 1 }, 'jsonb'), { a: 1 });

// ── decodeValue ────────────────────────────────────────────
const decD = decodeValue('2026-09-21T00:00:00.000Z', TS);
check('a timestamp string decodes to a Date', decD instanceof Date);
eq('the decoded Date is the same instant', decD.getTime(), d.getTime());
eq('the decoded Date re-encodes identically', decD.toISOString(), '2026-09-21T00:00:00.000Z');

check('timestamp with time zone also decodes',
  decodeValue('2026-09-21T05:30:00.000Z', 'timestamp with time zone') instanceof Date);
check('a date column also decodes',
  decodeValue('2026-09-21T00:00:00.000Z', 'date') instanceof Date);

eq('a bigint string decodes to a bigint', decodeValue('42', BIG), 42n);
check('that bigint really is a bigint', typeof decodeValue('42', BIG) === 'bigint');
eq('a bigint number decodes to a bigint', decodeValue(42, BIG), 42n);
eq('an existing bigint is left alone', decodeValue(42n, BIG), 42n);

const decBuf = decodeValue({ [BYTEA_MARKER]: 'AAH//g==' }, 'bytea');
check('a bytea marker decodes to a Buffer', Buffer.isBuffer(decBuf));
eq('the bytes survive the round trip', [...decBuf], [0x00, 0x01, 0xff, 0xfe]);
eq('a bytea object with no marker decodes to null', decodeValue({}, 'bytea'), null);

eq('a numeric string stays a string', decodeValue('123.45', 'numeric'), '123.45');
eq('null decodes to null', decodeValue(null, TS), null);
eq('a plain string in a text column is untouched',
  decodeValue('2026-09-21', 'text'), '2026-09-21');

// ── rows ───────────────────────────────────────────────────
const types = {
  id: 'text',
  date: 'timestamp without time zone',
  amount: 'double precision',
  userId: 'text',
  big: 'bigint',
};
const row = { id: 'x1', date: d, amount: 12.5, userId: null, big: 7n };
const encoded = encodeRow(row, types);
eq('encodeRow encodes the Date', encoded.date, '2026-09-21T00:00:00.000Z');
eq('encodeRow encodes the bigint', encoded.big, '7');
eq('encodeRow keeps null', encoded.userId, null);

const back = decodeRow(encoded, types);
eq('decodeRow restores the Date instant', back.date.getTime(), d.getTime());
eq('decodeRow restores the bigint', back.big, 7n);
eq('decodeRow restores the number', back.amount, 12.5);
eq('decodeRow keeps null', back.userId, null);
eq('decodeRow keeps the id', back.id, 'x1');

// ── orderTables ────────────────────────────────────────────
eq('tables are ordered so foreign keys resolve',
  orderTables(['fin_loan_payments', 'fin_loans', 'fin_users', 'fin_accounts']),
  ['fin_users', 'fin_accounts', 'fin_loans', 'fin_loan_payments']);

eq('an unknown table is appended, not dropped',
  orderTables(['fin_loans', 'fin_newthing', 'fin_users']),
  ['fin_users', 'fin_loans', 'fin_newthing']);

eq('several unknown tables are appended alphabetically',
  orderTables(['fin_zeta', 'fin_alpha']), ['fin_alpha', 'fin_zeta']);

eq('an empty list stays empty', orderTables([]), []);

eq('all nine known tables come back in FK order',
  orderTables([
    'fin_events', 'fin_loan_payments', 'fin_loans', 'fin_investments',
    'fin_transactions', 'fin_budgets', 'fin_categories', 'fin_accounts',
    'fin_users',
  ]),
  [
    'fin_users', 'fin_accounts', 'fin_categories', 'fin_budgets',
    'fin_transactions', 'fin_investments', 'fin_loans', 'fin_loan_payments',
    'fin_events',
  ]);

// ── makeBackup / validateBackup ────────────────────────────
const made = makeBackup({
  tables: { fin_loans: [] },
  columnTypes: { fin_loans: {} },
  source: { host: 'h', database: 'd' },
  appVersion: '0.1.0',
});
eq('makeBackup stamps the format', made.format, 'ink-finance-backup');
eq('makeBackup stamps version 1', made.formatVersion, 1);
check('makeBackup stamps an ISO timestamp',
  made.createdAt === new Date(made.createdAt).toISOString());
eq('makeBackup carries the source', made.source, { host: 'h', database: 'd' });

eq('a well-formed backup validates', validateBackup(made), null);
eq('null is rejected', validateBackup(null), 'not an object');
eq('a string is rejected', validateBackup('nope'), 'not an object');
eq('a foreign format is rejected',
  validateBackup({ ...made, format: 'something-else' }),
  'unexpected format "something-else"');
eq('a future formatVersion is rejected',
  validateBackup({ ...made, formatVersion: 2 }),
  'unsupported formatVersion 2');
eq('a missing tables block is rejected',
  validateBackup({ ...made, tables: null }), 'missing tables');
eq('a missing columnTypes block is rejected',
  validateBackup({ ...made, columnTypes: undefined }), 'missing columnTypes');
eq('a table that is not an array is rejected',
  validateBackup({ ...made, tables: { fin_loans: {} } }),
  'table fin_loans is not an array');

// ── summarise ──────────────────────────────────────────────
eq('summarise reports in FK order with counts',
  summarise({
    tables: { fin_loan_payments: [1, 2], fin_users: [1], fin_loans: [1, 2, 3] },
  }),
  [
    { table: 'fin_users', rows: 1 },
    { table: 'fin_loans', rows: 3 },
    { table: 'fin_loan_payments', rows: 2 },
  ]);

// ── the whole thing through JSON ───────────────────────────
const full = makeBackup({
  tables: { fin_loans: [encodeRow(row, types)] },
  columnTypes: { fin_loans: types },
  source: { host: 'h', database: 'd' },
  appVersion: '0.1.0',
});
const revived = JSON.parse(JSON.stringify(full));
eq('a serialised backup still validates', validateBackup(revived), null);
const revivedRow = decodeRow(revived.tables.fin_loans[0], revived.columnTypes.fin_loans);
eq('the Date survives stringify → parse', revivedRow.date.toISOString(), '2026-09-21T00:00:00.000Z');
eq('the bigint survives stringify → parse', revivedRow.big, 7n);
eq('the null survives stringify → parse', revivedRow.userId, null);

// ── timezone independence, part 1: the source cannot use local time ──
const source = readFileSync(new URL('./backup-format.mjs', import.meta.url), 'utf8');
// Strip comments so the prose above does not trip the scan.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const LOCAL_API = [
  'getFullYear', 'getMonth(', 'getDate(', 'getHours(', 'getMinutes(',
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString',
];
const offenders = LOCAL_API.filter((api) => code.includes(api));
eq('backup-format.mjs uses no local-time API', offenders, []);

// ── timezone independence, part 2: prove it at extreme offsets ──
const moduleUrl = new URL('./backup-format.mjs', import.meta.url).href;
const probe = `
import { encodeValue, decodeValue } from ${JSON.stringify(moduleUrl)};
const d = new Date('2026-09-21T00:00:00.000Z');
const enc = encodeValue(d, 'timestamp without time zone');
const dec = decodeValue(enc, 'timestamp without time zone');
console.log(JSON.stringify([enc, dec.getTime(), dec.toISOString()]));
`;
const zones = ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway', 'America/New_York'];
const results = zones.map((tz) => {
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
    }).trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
});
const allSame = results.every((r) => r === results[0]);
check('the encoded Date is identical in every timezone', allSame,
  allSame ? '' : results.map((r, i) => `${zones[i]}=${r}`).join(' | '));
eq('and it is still the intended day', JSON.parse(results[0])[0], '2026-09-21T00:00:00.000Z');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
