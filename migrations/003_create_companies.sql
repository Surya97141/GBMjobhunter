CREATE TABLE IF NOT EXISTS companies (
  id                UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              VARCHAR   NOT NULL,
  ats_platform      VARCHAR,
  ghost_rate        FLOAT,
  avg_response_days FLOAT,
  size_band         INTEGER
);
