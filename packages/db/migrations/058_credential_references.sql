CREATE TABLE IF NOT EXISTS credential_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    provider VARCHAR(80) NOT NULL DEFAULT 'env',
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    description TEXT,
    scope VARCHAR(80) NOT NULL DEFAULT 'discovery',
    secret_env_key VARCHAR(255),
    external_ref VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    last_tested_at TIMESTAMPTZ,
    last_status VARCHAR(80),
    last_error TEXT,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credential_references_provider ON credential_references(provider);
CREATE INDEX IF NOT EXISTS idx_credential_references_status ON credential_references(status);
CREATE INDEX IF NOT EXISTS idx_credential_references_scope ON credential_references(scope);

INSERT INTO app_permissions (role, resource, action)
VALUES
    ('admin', 'credentials', 'read'),
    ('admin', 'credentials', 'write'),
    ('admin', 'credentials', 'test'),
    ('security_admin', 'credentials', 'read'),
    ('security_admin', 'credentials', 'write'),
    ('security_admin', 'credentials', 'test')
ON CONFLICT (role, resource, action) DO NOTHING;
