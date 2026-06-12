CREATE TABLE IF NOT EXISTS cohort_patterns (
  id           UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_bucket  VARCHAR   NOT NULL,
  skill_cluster VARCHAR  NOT NULL,
  pattern_type VARCHAR   NOT NULL,
  finding      JSONB     NOT NULL,
  cohort_size  INTEGER   NOT NULL,
  computed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (role_bucket, skill_cluster, pattern_type)
);
