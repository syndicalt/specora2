ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS planned_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_end_at TIMESTAMPTZ;

-- Migrate existing scheduled_at values to planned_start_at
UPDATE change_requests SET planned_start_at = scheduled_at WHERE planned_start_at IS NULL;

-- Keep scheduled_at for backward compatibility; new code uses planned_start_at / planned_end_at
