-- Marks throwaway accounts created by POST /auth/demo so a cleanup job can
-- delete them. applications and user_insights reference users ON DELETE
-- CASCADE, so deleting a demo user removes all of their sample data too.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only demo rows are indexed, so the cleanup query is cheap
-- and real users add no index overhead.
CREATE INDEX IF NOT EXISTS idx_users_demo_created
  ON users (created_at)
  WHERE is_demo;
