-- ── Missing indices identified in Phase 10 hardening ──────────────────────
--
-- user_insights: every "get my insights" query filters by user_id.
-- Without this index the query does a full table scan; becomes slow once
-- the table has tens of thousands of rows from many users.
CREATE INDEX IF NOT EXISTS idx_user_insights_user_id
  ON user_insights(user_id);

-- cohort_patterns: pattern lookup filters by role_bucket to find which
-- patterns apply to a given role category. The existing UNIQUE constraint on
-- (role_bucket, skill_cluster, pattern_type) does create an index, but its
-- leading column is role_bucket so it already covers this access pattern.
-- Adding a dedicated single-column index would be redundant — no change needed.
--
-- applications: applied_at is used in streak calculation and history views
-- sorted by date. An index on (user_id, applied_at DESC) is a covering index
-- for both the filter and the sort; faster than the existing single-column
-- user_id index for date-ordered queries.
CREATE INDEX IF NOT EXISTS idx_applications_user_applied
  ON applications(user_id, applied_at DESC);
