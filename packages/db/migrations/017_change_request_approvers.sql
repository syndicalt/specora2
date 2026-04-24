CREATE TABLE IF NOT EXISTS change_request_approvers (
    change_request_id UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'approver',
    approved_at TIMESTAMPTZ,
    PRIMARY KEY (change_request_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cra_change ON change_request_approvers(change_request_id);
CREATE INDEX IF NOT EXISTS idx_cra_user ON change_request_approvers(user_id);
