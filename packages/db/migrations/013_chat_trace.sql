ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pathlight_trace_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_pathlight_trace ON chat_sessions(pathlight_trace_id) WHERE pathlight_trace_id IS NOT NULL;
