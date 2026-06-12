CREATE TABLE IF NOT EXISTS skill_demand (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill         VARCHAR NOT NULL,
  region        VARCHAR NOT NULL,
  open_roles    INTEGER NOT NULL,
  applicant_pool INTEGER NOT NULL,
  heat_score    FLOAT   NOT NULL,
  week          DATE    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_demand_skill_region ON skill_demand(skill, region);
