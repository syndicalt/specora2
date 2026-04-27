CREATE TABLE IF NOT EXISTS audit_head_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    head_hash TEXT NOT NULL,
    checked_rows INTEGER NOT NULL DEFAULT 0,
    legacy_rows INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'manual',
    external_ref TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_digest TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_head_anchors_created
  ON audit_head_anchors(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_head_anchors_hash
  ON audit_head_anchors(head_hash);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('admin', 'audit-log', 'write'),
  ('security_admin', 'audit-log', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;
