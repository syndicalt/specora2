CREATE TABLE IF NOT EXISTS number_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(100),
    table_name VARCHAR(100) NOT NULL UNIQUE,
    record_type VARCHAR(100) NOT NULL,
    prefix VARCHAR(20) NOT NULL UNIQUE,
    next_value BIGINT NOT NULL DEFAULT 1,
    padding INT NOT NULL DEFAULT 6,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS record_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    number VARCHAR(80) NOT NULL UNIQUE,
    sequence_id UUID NOT NULL REFERENCES number_sequences(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(table_name, record_id)
);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE prevention_records ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE asset_records ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE discovery_pipelines ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;
ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS number VARCHAR(80) UNIQUE;

INSERT INTO number_sequences (app_id, table_name, record_type, prefix, next_value, padding)
VALUES
  ('incident-manager', 'incidents', 'Incident', 'INC', 1, 6),
  ('change-manager', 'change_requests', 'Change Request', 'CHG', 1, 6),
  ('knowledge-core', 'knowledge_items', 'Knowledge', 'KB', 1, 6),
  ('prevention-center', 'prevention_records', 'Prevention Record', 'PRV', 1, 6),
  ('asset-command', 'asset_records', 'Asset', 'AST', 1, 6),
  ('discovery', 'discovery_pipelines', 'Discovery Pipeline', 'DISC', 1, 6),
  ('discovery', 'discovery_jobs', 'Discovery Job', 'DJOB', 1, 6)
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO app_permissions (role, resource, action)
VALUES
  ('admin', 'number-sequences', 'read'),
  ('admin', 'number-sequences', 'write'),
  ('security_admin', 'number-sequences', 'read'),
  ('security_admin', 'number-sequences', 'write')
ON CONFLICT DO NOTHING;
