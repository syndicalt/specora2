ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT,
  ADD COLUMN IF NOT EXISTS integrity_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_audit_log_entry_hash ON audit_log(entry_hash);

CREATE OR REPLACE FUNCTION specora_audit_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION specora_audit_log_append_only();

DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_log;
CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION specora_audit_log_append_only();
