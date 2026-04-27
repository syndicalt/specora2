CREATE TABLE IF NOT EXISTS discovery_mapping_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    description TEXT,
    source_type VARCHAR(80) NOT NULL DEFAULT 'generic',
    target_classes JSONB NOT NULL DEFAULT '[]',
    mapping JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_discovery_mapping_profiles_source_type
  ON discovery_mapping_profiles(source_type, updated_at DESC);
