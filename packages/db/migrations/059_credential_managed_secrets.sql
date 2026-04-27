ALTER TABLE credential_references ADD COLUMN IF NOT EXISTS encrypted_secret JSONB;

UPDATE credential_references
SET provider = 'managed'
WHERE provider = 'none';
