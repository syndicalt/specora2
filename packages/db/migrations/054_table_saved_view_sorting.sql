ALTER TABLE table_saved_views
  ADD COLUMN IF NOT EXISTS sort_field TEXT,
  ADD COLUMN IF NOT EXISTS sort_direction TEXT NOT NULL DEFAULT 'asc';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_saved_views_sort_direction_check'
  ) THEN
    ALTER TABLE table_saved_views
      ADD CONSTRAINT table_saved_views_sort_direction_check
      CHECK (sort_direction IN ('asc', 'desc')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_table_saved_views_table_name ON table_saved_views(table_id, name);
