-- Add profile-picture columns to fin_users.
--
-- Additive and idempotent, so it is safe to re-run against any environment.
-- Applied by hand because the Render build only runs `prisma generate`
-- (see render.yaml) — it never pushes or migrates the schema:
--
--   npx prisma db execute --file prisma/add-avatar-columns.sql
--
-- Why inline base64 and not a file on disk: Render's filesystem is ephemeral,
-- so an avatar written at runtime would vanish on the next deploy. The browser
-- downscales to ~256px before upload, keeping rows small.

ALTER TABLE fin_users ADD COLUMN IF NOT EXISTS avatar     TEXT;
ALTER TABLE fin_users ADD COLUMN IF NOT EXISTS "avatarMime" TEXT;
