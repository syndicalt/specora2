ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ;
ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS last_status VARCHAR(50);
ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE discovery_sources ADD COLUMN IF NOT EXISTS credential_ref VARCHAR(255);

ALTER TABLE discovery_pipelines ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE discovery_pipelines ADD COLUMN IF NOT EXISTS published_definition JSONB;
ALTER TABLE discovery_pipelines ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;
ALTER TABLE discovery_pipelines ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES discovery_pipelines(id) ON DELETE SET NULL;
ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS pipeline_version INT;
ALTER TABLE discovery_jobs ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_pipeline_id ON discovery_jobs(pipeline_id);
