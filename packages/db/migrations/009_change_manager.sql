CREATE TABLE IF NOT EXISTS change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ci_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    requester_id UUID REFERENCES users(id),
    approver_id UUID REFERENCES users(id),
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_change_requests_ci_id ON change_requests(ci_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_requester ON change_requests(requester_id);

-- Add comment noting ci_id references ConfigurationItem.id in Neo4j
COMMENT ON TABLE change_requests IS 'ITSM Change Requests; ci_id references Neo4j ConfigurationItem.id';
