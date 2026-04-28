CREATE TABLE IF NOT EXISTS edge_discovery_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(160),
    collector_id UUID NOT NULL REFERENCES discovery_collectors(id) ON DELETE CASCADE,
    capability VARCHAR(160) NOT NULL,
    edge_collector_id VARCHAR(160) NOT NULL DEFAULT 'osquery',
    collector_version VARCHAR(80) NOT NULL DEFAULT '1.0.0',
    timeout_seconds INTEGER NOT NULL DEFAULT 30,
    priority INTEGER NOT NULL DEFAULT 10,
    credential_scope_id VARCHAR(255) NOT NULL DEFAULT '',
    network_scope_id VARCHAR(255) NOT NULL DEFAULT '',
    expected_schema VARCHAR(160) NOT NULL DEFAULT 'specora.evidence.v1',
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    attempt INTEGER NOT NULL DEFAULT 0,
    lease_deadline TIMESTAMPTZ,
    failure_code VARCHAR(120),
    detail TEXT,
    issued_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    nonce VARCHAR(160),
    signing_key_id VARCHAR(255),
    signature TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edge_discovery_jobs_collector_status
  ON edge_discovery_jobs(collector_id, status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_edge_discovery_jobs_run_status
  ON edge_discovery_jobs(status, updated_at DESC);
