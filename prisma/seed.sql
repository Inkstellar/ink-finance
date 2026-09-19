-- ink-finance: Seed default users (Kousi, Preeti) into fin_users table.
-- Run with: npm run db:seed
-- This script is idempotent (ON CONFLICT DO NOTHING).

-- Insert default users if they don't exist
INSERT INTO "fin_users" ("id", "name", "initials", "color", "telegramId")
VALUES
  ('cmu80usrKousi0000000000000001', 'Kousi', 'K', '#2563eb', NULL),
  ('cmu80usrPreeti00000000000001', 'Preeti', 'P', '#dc2626', NULL)
ON CONFLICT DO NOTHING;
