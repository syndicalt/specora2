CREATE TABLE IF NOT EXISTS knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(80) NOT NULL DEFAULT 'article',
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    status VARCHAR(80) NOT NULL DEFAULT 'draft',
    audience VARCHAR(80) NOT NULL DEFAULT 'internal',
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    source_ref VARCHAR(255),
    owner_id UUID REFERENCES users(id),
    service VARCHAR(255),
    ci_id VARCHAR(255),
    tags TEXT[] NOT NULL DEFAULT '{}',
    trust_score NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    health_score NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    ai_confidence NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    reuse_count INTEGER NOT NULL DEFAULT 0,
    deflection_count INTEGER NOT NULL DEFAULT 0,
    last_validated_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    target_type VARCHAR(80) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    relationship VARCHAR(80) NOT NULL DEFAULT 'related',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(knowledge_id, target_type, target_id, relationship)
);

CREATE TABLE IF NOT EXISTS knowledge_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    helpful BOOLEAN,
    outcome VARCHAR(80),
    comment TEXT,
    context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(80) NOT NULL DEFAULT 'open',
    demand_count INTEGER NOT NULL DEFAULT 1,
    proposed_knowledge_id UUID REFERENCES knowledge_items(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(query)
);

CREATE TABLE IF NOT EXISTS knowledge_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id UUID REFERENCES knowledge_items(id) ON DELETE CASCADE,
    type VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    actor_id UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_ci_id ON knowledge_items(ci_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source ON knowledge_items(source, source_ref);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_tags ON knowledge_items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_links_target ON knowledge_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_item ON knowledge_feedback(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_status ON knowledge_gaps(status);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'knowledge-core', 'read'),
  ('operator', 'knowledge-core', 'read'),
  ('operator', 'knowledge-core', 'write'),
  ('admin', 'knowledge-core', 'read'),
  ('admin', 'knowledge-core', 'write'),
  ('admin', 'knowledge-core', 'govern'),
  ('security_admin', 'knowledge-core', 'read'),
  ('security_admin', 'knowledge-core', 'write'),
  ('security_admin', 'knowledge-core', 'govern'),
  ('incident_manager', 'knowledge-core', 'read'),
  ('incident_manager', 'knowledge-core', 'write'),
  ('change_manager', 'knowledge-core', 'read'),
  ('change_manager', 'knowledge-core', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;

COMMENT ON TABLE knowledge_items IS 'AI-governed ITSM knowledge objects including articles, runbooks, known errors, decisions, and service guides';
