CREATE TABLE IF NOT EXISTS auth_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    return_to TEXT NOT NULL DEFAULT '/',
    provider TEXT,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_handoffs_code_hash ON auth_handoffs(code_hash);
CREATE INDEX IF NOT EXISTS idx_auth_handoffs_expiry ON auth_handoffs(expires_at) WHERE used_at IS NULL;
