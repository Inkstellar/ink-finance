/**
 * Pure helpers for the ink-finance database backup format.
 *
 * No database, no filesystem, no Prisma — everything here is a pure function so
 * `scripts/backup-format.test.mjs` can exercise it without touching live data.
 *
 * Why this exists: on 2026-09-21 a set of loans turned out to be unrecoverable.
 * Neon refused `pageinspect` (no superuser), Render keeps only a few hours of
 * deploy logs, and the point-in-time window is not readable from SQL — so there
 * was no backup and no way back. This module is the encode/decode half of
 * making the next incident recoverable.
 *
 * The delicate part is types. Postgres hands back `Date`, `BigInt`, `Buffer`
 * and `Decimal`, none of which survive `JSON.stringify` intact, and a timestamp
 * that round-trips through JSON as a local-time string would shift the day —
 * the exact class of bug this codebase keeps hitting (dates are calendar days
 * stored as UTC midnight; see `src/lib/format.ts` and `src/lib/calendar.ts`).
 */

/** Postgres types that must round-trip as an exact instant. */
const TIMESTAMP_TYPES = new Set([
  'timestamp without time zone',
  'timestamp with time zone',
  'date',
]);

/** Integer types too wide for a JS number to hold exactly. */
const BIGINT_TYPES = new Set(['bigint']);

/** Binary columns are carried as base64 so the JSON stays text. */
const BINARY_TYPES = new Set(['bytea']);

/** Exact numerics are carried as strings — a float would round them. */
const NUMERIC_TYPES = new Set(['numeric', 'decimal']);

/** Marker key for base64-encoded binary values. */
export const BYTEA_MARKER = '__bytea';

/** True for a value that looks like a decimal.js `Decimal` from Prisma. */
function isDecimalLike(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.toFixed === 'function' &&
    typeof value.toSign === 'function'
  );
}

/**
 * Turn one database value into something `JSON.stringify` can carry losslessly.
 * The column's Postgres data type decides how.
 */
export function encodeValue(value, dataType) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { [BYTEA_MARKER]: Buffer.from(value).toString('base64') };
  }
  if (isDecimalLike(value)) return value.toString();

  // number / string / boolean / plain JSON objects pass through.
  return value;
}

/**
 * Inverse of {@link encodeValue}. The data type is what turns a bare string
 * back into a `Date`, `BigInt` or `Buffer`.
 */
export function decodeValue(value, dataType) {
  if (value === null || value === undefined) return null;

  if (TIMESTAMP_TYPES.has(dataType) && typeof value === 'string') {
    return new Date(value);
  }

  if (BIGINT_TYPES.has(dataType)) {
    if (typeof value === 'bigint') return value;
    return BigInt(String(value));
  }

  if (BINARY_TYPES.has(dataType) && value && typeof value === 'object') {
    const b64 = value[BYTEA_MARKER];
    if (typeof b64 === 'string') return Buffer.from(b64, 'base64');
    return null;
  }

  // Decimal is handed to Prisma as a string, which it accepts.
  if (NUMERIC_TYPES.has(dataType)) return String(value);

  return value;
}

/** Encode every column of a row, guided by a `{ column: dataType }` map. */
export function encodeRow(row, columnTypes) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = encodeValue(value, columnTypes[key]);
  }
  return out;
}

/** Decode every column of a row, guided by a `{ column: dataType }` map. */
export function decodeRow(row, columnTypes) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = decodeValue(value, columnTypes[key]);
  }
  return out;
}

/**
 * Tables in an order that satisfies the foreign keys between them.
 *
 * Rows are inserted in this order on restore: `fin_loan_payments` references
 * `fin_loans`, which references `fin_users` and `fin_accounts`, so payments must
 * come last or the insert fails on a foreign key.
 *
 * Tables not named here are appended alphabetically. That is the best guess
 * available without walking `pg_constraint`, and this schema has no such table.
 */
const FK_ORDER = [
  'fin_users',
  'fin_accounts',
  'fin_categories',
  'fin_budgets',
  'fin_transactions',
  'fin_investments',
  'fin_loans',
  'fin_loan_payments',
  'fin_events',
];

export function orderTables(tableNames) {
  const known = FK_ORDER.filter((t) => tableNames.includes(t));
  const unknown = tableNames.filter((t) => !FK_ORDER.includes(t)).sort();
  return [...known, ...unknown];
}

/** Build the header written at the top of every backup file. */
export function makeBackup({ tables, columnTypes, source, appVersion }) {
  return {
    format: 'ink-finance-backup',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    source,
    appVersion,
    tables,
    columnTypes,
  };
}

/**
 * Validate the shape of a parsed backup file. Returns an error string, or null
 * when the file is usable. Deliberately strict: a restore that half-works is
 * worse than one that refuses.
 */
export function validateBackup(data) {
  if (!data || typeof data !== 'object') return 'not an object';
  if (data.format !== 'ink-finance-backup') {
    return `unexpected format ${JSON.stringify(data.format)}`;
  }
  if (data.formatVersion !== 1) return `unsupported formatVersion ${data.formatVersion}`;
  if (!data.tables || typeof data.tables !== 'object') return 'missing tables';
  if (!data.columnTypes || typeof data.columnTypes !== 'object') {
    return 'missing columnTypes';
  }
  for (const [name, rows] of Object.entries(data.tables)) {
    if (!Array.isArray(rows)) return `table ${name} is not an array`;
  }
  return null;
}

/** A one-line-per-table summary of what a backup holds. */
export function summarise(data) {
  const names = orderTables(Object.keys(data.tables || {}));
  return names.map((name) => ({
    table: name,
    rows: data.tables[name].length,
  }));
}
