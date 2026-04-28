CREATE TABLE IF NOT EXISTS edge_evidence_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(160),
    collector_id UUID NOT NULL REFERENCES discovery_collectors(id) ON DELETE CASCADE,
    upload_id VARCHAR(255) NOT NULL,
    run_id VARCHAR(255) NOT NULL,
    digest VARCHAR(255),
    byte_count BIGINT NOT NULL DEFAULT 0,
    accepted_offset BIGINT NOT NULL DEFAULT 0,
    complete BOOLEAN NOT NULL DEFAULT FALSE,
    storage_class VARCHAR(50) NOT NULL DEFAULT 'database',
    schema_version VARCHAR(120),
    record_count INTEGER NOT NULL DEFAULT 0,
    raw_text TEXT,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    signature TEXT,
    signing_key_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (collector_id, upload_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_evidence_documents_collector
  ON edge_evidence_documents(collector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_edge_evidence_documents_run
  ON edge_evidence_documents(run_id);

CREATE TABLE IF NOT EXISTS discovery_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collector_id UUID NOT NULL REFERENCES discovery_collectors(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES edge_evidence_documents(id) ON DELETE CASCADE,
    run_id VARCHAR(255) NOT NULL,
    source_type VARCHAR(120) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    subject_type VARCHAR(120) NOT NULL,
    subject_id VARCHAR(255) NOT NULL,
    entity_type VARCHAR(120) NOT NULL,
    natural_key VARCHAR(500) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    facts JSONB NOT NULL DEFAULT '{}',
    relationships JSONB NOT NULL DEFAULT '[]',
    confidence NUMERIC(5,4),
    metadata JSONB NOT NULL DEFAULT '{}',
    freshness_status VARCHAR(50) NOT NULL DEFAULT 'current',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_observations_collector
  ON discovery_observations(collector_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_observations_document
  ON discovery_observations(document_id);

CREATE INDEX IF NOT EXISTS idx_discovery_observations_entity
  ON discovery_observations(entity_type, natural_key);
