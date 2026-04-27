CREATE INDEX IF NOT EXISTS idx_jobs_status_updated_at ON jobs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_running_stale ON jobs(updated_at ASC)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_jobs_failed_dead_letter ON jobs(updated_at DESC)
  WHERE status = 'failed';
