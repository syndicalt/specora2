CREATE TABLE IF NOT EXISTS discovery_rollbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_job_id UUID NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'available',
    summary JSONB NOT NULL DEFAULT '{}',
    records JSONB NOT NULL DEFAULT '[]',
    relationships JSONB NOT NULL DEFAULT '[]',
    created_by UUID REFERENCES users(id),
    applied_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_rollbacks_job ON discovery_rollbacks(discovery_job_id);
CREATE INDEX IF NOT EXISTS idx_discovery_rollbacks_status ON discovery_rollbacks(status, created_at DESC);
