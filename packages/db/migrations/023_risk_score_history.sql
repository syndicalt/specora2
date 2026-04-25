-- Migration 023: Risk score history tracking

CREATE TABLE IF NOT EXISTS change_request_risk_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  risk_score INTEGER NOT NULL,
  blast_radius INTEGER NOT NULL,
  priority VARCHAR(20) NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  computed_by VARCHAR(255) -- user ID or 'system'
);

CREATE INDEX IF NOT EXISTS idx_risk_history_rfc_id ON change_request_risk_history(change_request_id);
CREATE INDEX IF NOT EXISTS idx_risk_history_computed_at ON change_request_risk_history(computed_at);
