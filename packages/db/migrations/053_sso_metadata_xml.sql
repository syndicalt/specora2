ALTER TABLE sso_configs
    ADD COLUMN IF NOT EXISTS metadata_xml TEXT;
