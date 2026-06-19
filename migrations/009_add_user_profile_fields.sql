ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name                VARCHAR,
  ADD COLUMN IF NOT EXISTS target_role         VARCHAR,
  ADD COLUMN IF NOT EXISTS target_location     VARCHAR,
  ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;
