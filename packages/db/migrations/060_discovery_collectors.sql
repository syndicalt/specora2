CREATE TABLE IF NOT EXISTS discovery_collectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'registered',
    site VARCHAR(160),
    version VARCHAR(80),
    labels JSONB NOT NULL DEFAULT '{}',
    config JSONB NOT NULL DEFAULT '{}',
    last_heartbeat_at TIMESTAMPTZ,
    last_seen_ip VARCHAR(80),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS collector_id UUID REFERENCES discovery_collectors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_discovery_collectors_status ON discovery_collectors(status, last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_sources_collector ON discovery_sources(collector_id);
