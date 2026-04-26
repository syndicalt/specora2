CREATE TABLE IF NOT EXISTS prevention_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(80) NOT NULL DEFAULT 'candidate',
    category VARCHAR(80) NOT NULL DEFAULT 'recurring_incident',
    priority INTEGER NOT NULL DEFAULT 3,
    service VARCHAR(255),
    ci_id VARCHAR(255),
    owner_id UUID REFERENCES users(id),
    recurrence_count INTEGER NOT NULL DEFAULT 0,
    impact_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    estimated_hours_saved NUMERIC(8, 2) NOT NULL DEFAULT 0,
    verified_reduction_pct NUMERIC(5, 2),
    known_error_id UUID REFERENCES knowledge_items(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prevention_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prevention_id UUID NOT NULL REFERENCES prevention_records(id) ON DELETE CASCADE,
    source_type VARCHAR(80) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    summary TEXT,
    weight NUMERIC(5, 2) NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(prevention_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS prevention_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prevention_id UUID NOT NULL REFERENCES prevention_records(id) ON DELETE CASCADE,
    type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(80) NOT NULL DEFAULT 'proposed',
    target_app VARCHAR(80),
    target_id VARCHAR(255),
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prevention_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prevention_id UUID NOT NULL REFERENCES prevention_records(id) ON DELETE CASCADE,
    type VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    actor_id UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prevention_records_status ON prevention_records(status);
CREATE INDEX IF NOT EXISTS idx_prevention_records_category ON prevention_records(category);
CREATE INDEX IF NOT EXISTS idx_prevention_records_ci_id ON prevention_records(ci_id);
CREATE INDEX IF NOT EXISTS idx_prevention_evidence_source ON prevention_evidence(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_prevention_actions_status ON prevention_actions(status);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'prevention-center', 'read'),
  ('operator', 'prevention-center', 'read'),
  ('operator', 'prevention-center', 'write'),
  ('admin', 'prevention-center', 'read'),
  ('admin', 'prevention-center', 'write'),
  ('admin', 'prevention-center', 'govern'),
  ('security_admin', 'prevention-center', 'read'),
  ('security_admin', 'prevention-center', 'write'),
  ('security_admin', 'prevention-center', 'govern'),
  ('incident_manager', 'prevention-center', 'read'),
  ('incident_manager', 'prevention-center', 'write'),
  ('change_manager', 'prevention-center', 'read'),
  ('change_manager', 'prevention-center', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;

COMMENT ON TABLE prevention_records IS 'Reliability prevention candidates and known-error work that replace legacy problem records';
