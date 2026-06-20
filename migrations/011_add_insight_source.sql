ALTER TABLE user_insights
  ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'templated';
