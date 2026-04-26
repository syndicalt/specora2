CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    external_ref VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    service VARCHAR(255),
    ci_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    severity VARCHAR(50) NOT NULL DEFAULT 'medium',
    priority INTEGER NOT NULL DEFAULT 3,
    assignment_group VARCHAR(255),
    owner_id UUID REFERENCES users(id),
    commander_id UUID REFERENCES users(id),
    ai_state VARCHAR(80) NOT NULL DEFAULT 'queued',
    ai_confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ai_summary TEXT,
    ai_next_action TEXT,
    ai_decision VARCHAR(80),
    auto_remediation_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source, external_ref)
);

CREATE TABLE IF NOT EXISTS incident_cis (
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    ci_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'affected',
    distance INTEGER,
    PRIMARY KEY (incident_id, ci_id)
);

CREATE TABLE IF NOT EXISTS incident_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    type VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    actor_id UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(80) NOT NULL DEFAULT 'recommendation',
    status VARCHAR(80) NOT NULL DEFAULT 'proposed',
    risk_level VARCHAR(50) NOT NULL DEFAULT 'medium',
    confidence NUMERIC(5, 2) NOT NULL DEFAULT 0,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by UUID REFERENCES users(id),
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incident_roles (
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(80) NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (incident_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS incident_postmortems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    summary TEXT NOT NULL,
    root_cause TEXT,
    prevention_items JSONB NOT NULL DEFAULT '[]',
    generated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_ci_id ON incidents(ci_id);
CREATE INDEX IF NOT EXISTS idx_incidents_external_ref ON incidents(source, external_ref);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_incident_actions_incident ON incident_actions(incident_id, status);
CREATE INDEX IF NOT EXISTS idx_incident_cis_ci ON incident_cis(ci_id);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'incident-manager', 'read'),
  ('operator', 'incident-manager', 'read'),
  ('operator', 'incident-manager', 'write'),
  ('operator', 'incident-manager', 'remediate'),
  ('admin', 'incident-manager', 'read'),
  ('admin', 'incident-manager', 'write'),
  ('admin', 'incident-manager', 'remediate'),
  ('admin', 'incident-manager', 'command'),
  ('security_admin', 'incident-manager', 'read'),
  ('security_admin', 'incident-manager', 'write'),
  ('security_admin', 'incident-manager', 'remediate'),
  ('security_admin', 'incident-manager', 'command'),
  ('incident_manager', 'incident-manager', 'read'),
  ('incident_manager', 'incident-manager', 'write'),
  ('incident_manager', 'incident-manager', 'remediate'),
  ('incident_manager', 'incident-manager', 'command')
ON CONFLICT (role, resource, action) DO NOTHING;

COMMENT ON TABLE incidents IS 'AI-native incident records; ci_id references Neo4j ConfigurationItem.id';
