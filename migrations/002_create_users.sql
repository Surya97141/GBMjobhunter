CREATE TABLE IF NOT EXISTS users (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            VARCHAR     UNIQUE NOT NULL,
  hashed_password  VARCHAR     NOT NULL,
  resume_json      JSONB,
  ats_score_cache  INTEGER,
  created_at       TIMESTAMP   NOT NULL DEFAULT NOW()
);
