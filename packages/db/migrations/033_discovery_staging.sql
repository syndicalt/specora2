CREATE TABLE IF NOT EXISTS discovery_staged_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_job_id UUID NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_class VARCHAR(100) NOT NULL,
    ci_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    environment VARCHAR(100),
    attributes JSONB NOT NULL DEFAULT '{}',
    match_keys JSONB NOT NULL DEFAULT '[]',
    errors JSONB NOT NULL DEFAULT '[]',
    warnings JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'staged',
    committed_ci_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_staged_records_job ON discovery_staged_records(discovery_job_id);
CREATE INDEX IF NOT EXISTS idx_discovery_staged_records_status ON discovery_staged_records(status);

CREATE TABLE IF NOT EXISTS discovery_staged_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_job_id UUID NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,
    row_number INT NOT NULL,
    from_class VARCHAR(100) NOT NULL,
    to_class VARCHAR(100) NOT NULL,
    rel_type VARCHAR(50) NOT NULL,
    source_field VARCHAR(255) NOT NULL,
    target_hint VARCHAR(255),
    confidence NUMERIC(5, 4) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'staged',
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_staged_relationships_job ON discovery_staged_relationships(discovery_job_id);
