CREATE TABLE IF NOT EXISTS change_cab_brief_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_request_id UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
    generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    grade JSONB NOT NULL DEFAULT '{}',
    conflicts JSONB NOT NULL DEFAULT '{}',
    health JSONB NOT NULL DEFAULT '{}',
    impact_path JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_cab_brief_snapshots_rfc_created
  ON change_cab_brief_snapshots(change_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_cab_brief_snapshots_generated_by
  ON change_cab_brief_snapshots(generated_by);
