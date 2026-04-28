CREATE TABLE IF NOT EXISTS discovery_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collector_id UUID REFERENCES discovery_collectors(id) ON DELETE CASCADE,
    source_type VARCHAR(80) NOT NULL DEFAULT 'edge',
    source_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ready',
    observed_start_at TIMESTAMPTZ,
    observed_end_at TIMESTAMPTZ,
    document_ids JSONB NOT NULL DEFAULT '[]',
    run_ids JSONB NOT NULL DEFAULT '[]',
    entity_counts JSONB NOT NULL DEFAULT '{}',
    profiles JSONB NOT NULL DEFAULT '[]',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_datasets_collector
  ON discovery_datasets(collector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_datasets_status
  ON discovery_datasets(status, created_at DESC);
