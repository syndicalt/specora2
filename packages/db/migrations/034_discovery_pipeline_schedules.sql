CREATE TABLE IF NOT EXISTS discovery_pipeline_schedules (
    pipeline_id UUID PRIMARY KEY REFERENCES discovery_pipelines(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    interval VARCHAR(50) NOT NULL DEFAULT 'manual',
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    last_discovery_job_id UUID REFERENCES discovery_jobs(id) ON DELETE SET NULL,
    last_status VARCHAR(50),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_pipeline_schedules_due
  ON discovery_pipeline_schedules(enabled, next_run_at)
  WHERE enabled = TRUE;
