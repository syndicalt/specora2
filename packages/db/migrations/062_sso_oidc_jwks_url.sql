ALTER TABLE sso_configs
    ADD COLUMN IF NOT EXISTS oidc_jwks_url TEXT;
