CREATE TABLE IF NOT EXISTS application_events (
  application_id       UUID         PRIMARY KEY,
  anonymised_cohort_id VARCHAR,
  role_bucket          VARCHAR      NOT NULL DEFAULT 'unspecified',
  skill_cluster        VARCHAR,
  ats_score            INTEGER,
  company_size_band    INTEGER,
  ats_platform         VARCHAR      NOT NULL DEFAULT 'unknown',
  outcome              VARCHAR      NOT NULL DEFAULT 'pending',
  response_days        INTEGER,
  applied_at           TIMESTAMP    NOT NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_cohort
  ON application_events (role_bucket, skill_cluster, ats_platform);
