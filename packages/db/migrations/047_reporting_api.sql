CREATE TABLE IF NOT EXISTS report_saved_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    query JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, dataset_id, name)
);

CREATE INDEX IF NOT EXISTS idx_report_saved_definitions_user_dataset
  ON report_saved_definitions(user_id, dataset_id, updated_at DESC);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'reporting', 'read'),
  ('viewer', 'reporting', 'write'),
  ('operator', 'reporting', 'read'),
  ('operator', 'reporting', 'write'),
  ('admin', 'reporting', 'read'),
  ('admin', 'reporting', 'write'),
  ('security_admin', 'reporting', 'read'),
  ('security_admin', 'reporting', 'write'),
  ('incident_manager', 'reporting', 'read'),
  ('incident_manager', 'reporting', 'write'),
  ('change_manager', 'reporting', 'read'),
  ('change_manager', 'reporting', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;
