-- Create fin_events — the shared household calendar.
--
-- Additive and idempotent, so it is safe to re-run against any environment.
-- Applied by hand because the Render build only runs `prisma generate`
-- (see render.yaml) — it never pushes or migrates the schema:
--
--   npx prisma db execute --file prisma/add-events-table.sql
--
-- Column types are matched to the rest of the fin_* tables, which Prisma
-- created as `text`, `timestamp without time zone` and `double precision`
-- (verified against information_schema). `date` is UTC midnight of the
-- intended calendar day, like fin_transactions.date — a date, not an instant.
--
-- `id` has no default: Prisma's cuid() is generated client-side, and every
-- writer here goes through Prisma. `createdAt`/`updatedAt` keep DB defaults so
-- a hand-written INSERT still lands a sane row.

CREATE TABLE IF NOT EXISTS fin_events (
  id          TEXT             NOT NULL,
  title       TEXT             NOT NULL,
  date        TIMESTAMP(3)     NOT NULL,
  "endDate"   TIMESTAMP(3),
  "startTime" TEXT,
  notes       TEXT,
  "userId"    TEXT,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fin_events_pkey PRIMARY KEY (id),
  -- SetNull, not Cascade: deleting a person must not erase the household's
  -- history, and it matches every other optional user relation in this schema.
  CONSTRAINT fin_events_userId_fkey FOREIGN KEY ("userId")
    REFERENCES fin_users (id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- The calendar only ever reads one month (or one agenda window) at a time.
CREATE INDEX IF NOT EXISTS fin_events_date_idx ON fin_events (date);
