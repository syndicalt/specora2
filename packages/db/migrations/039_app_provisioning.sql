CREATE TABLE IF NOT EXISTS app_installations (
    app_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'installed',
    installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    installed_at TIMESTAMPTZ,
    uninstalled_at TIMESTAMPTZ,
    clear_data_on_uninstall BOOLEAN NOT NULL DEFAULT FALSE,
    data_retention_policy VARCHAR(50) NOT NULL DEFAULT 'retain',
    last_job_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_provisioning_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    clear_data_on_uninstall BOOLEAN NOT NULL DEFAULT FALSE,
    data_retention_policy VARCHAR(50) NOT NULL DEFAULT 'retain',
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_provisioning_jobs_app ON app_provisioning_jobs(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_provisioning_jobs_status ON app_provisioning_jobs(status);

INSERT INTO app_installations (app_id, status, installed_at, metadata)
VALUES ('it-visibility-dcim', 'installed', NOW(), '{"seeded": true, "packageId": "it-visibility"}')
ON CONFLICT (app_id) DO NOTHING;
