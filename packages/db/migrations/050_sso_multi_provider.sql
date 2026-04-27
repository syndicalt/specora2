ALTER TABLE sso_configs
    ADD COLUMN IF NOT EXISTS client_id TEXT,
    ADD COLUMN IF NOT EXISTS client_secret_ref TEXT,
    ADD COLUMN IF NOT EXISTS issuer_url TEXT,
    ADD COLUMN IF NOT EXISTS authorization_url TEXT,
    ADD COLUMN IF NOT EXISTS token_url TEXT,
    ADD COLUMN IF NOT EXISTS userinfo_url TEXT,
    ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["openid","email","profile"]'::jsonb,
    ADD COLUMN IF NOT EXISTS enforce_sso BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS default_role TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS attribute_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"name","groups":"groups"}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sso_configs_enforce ON sso_configs(enforce_sso) WHERE status = 'active';
