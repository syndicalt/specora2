CREATE TABLE IF NOT EXISTS table_cleanup_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_label TEXT,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT table_cleanup_reviews_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT table_cleanup_reviews_status_check CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  CONSTRAINT table_cleanup_reviews_unique_record UNIQUE (table_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_table_cleanup_reviews_table_status
  ON table_cleanup_reviews(table_id, status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_table_cleanup_reviews_requested_by
  ON table_cleanup_reviews(requested_by, updated_at DESC);
