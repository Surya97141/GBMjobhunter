CREATE TABLE IF NOT EXISTS user_insights (
  id          UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID      NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  pattern_id  UUID      NOT NULL REFERENCES cohort_patterns(id),
  headline    VARCHAR   NOT NULL,
  action      VARCHAR   NOT NULL,
  seen        BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, pattern_id)
);
