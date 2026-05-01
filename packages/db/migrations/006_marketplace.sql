CREATE TABLE IF NOT EXISTS marketplace_apps (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    icon VARCHAR(255) NOT NULL DEFAULT 'Compass',
    icon_color VARCHAR(32),
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    permissions JSONB NOT NULL DEFAULT '[]',
    react_version VARCHAR(50) NOT NULL DEFAULT '^18.0.0',
    author VARCHAR(255) NOT NULL,
    author_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_apps_status ON marketplace_apps(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_apps_name ON marketplace_apps(name);
