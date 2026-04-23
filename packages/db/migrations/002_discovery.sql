CREATE TABLE IF NOT EXISTS discovery_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discovery_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES discovery_sources(id),
    file_path VARCHAR(500),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    stats JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status ON discovery_jobs(status);

CREATE TABLE IF NOT EXISTS reconciliation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ci_class VARCHAR(100) NOT NULL,
    match_keys JSONB NOT NULL,
    conflict_strategy JSONB,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_rules_class ON reconciliation_rules(ci_class);

CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discovery_job_id UUID REFERENCES discovery_jobs(id),
    ci_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
