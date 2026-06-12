CREATE TABLE IF NOT EXISTS applications (
  id                  UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID      NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  company_id          UUID      NOT NULL REFERENCES companies(id),
  role_title          VARCHAR   NOT NULL,
  jd_fingerprint_hash VARCHAR,
  ats_score_at_apply  INTEGER,
  outcome             VARCHAR   NOT NULL DEFAULT 'pending'
                      CHECK (outcome IN ('pending', 'ghosted', 'rejected', 'interview', 'offer')),
  response_days       INTEGER,
  applied_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id    ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_company_id ON applications(company_id);
