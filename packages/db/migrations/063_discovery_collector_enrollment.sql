CREATE TABLE IF NOT EXISTS discovery_collector_enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    token_prefix VARCHAR(20) NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    site VARCHAR(160),
    labels JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    collector_id UUID REFERENCES discovery_collectors(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_enrollment_tokens_active
  ON discovery_collector_enrollment_tokens(expires_at, revoked_at, uses);

CREATE INDEX IF NOT EXISTS idx_discovery_enrollment_tokens_collector
  ON discovery_collector_enrollment_tokens(collector_id);
