CREATE TABLE IF NOT EXISTS change_request_cis (
    change_request_id UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
    ci_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'affected',
    PRIMARY KEY (change_request_id, ci_id)
);

CREATE INDEX IF NOT EXISTS idx_change_request_cis_ci ON change_request_cis(ci_id);
