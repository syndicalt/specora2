ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS requester_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_incidents_requester ON incidents(requester_id);

UPDATE incidents
SET requester_id = owner_id,
    owner_id = NULL
WHERE requester_id IS NULL
  AND source = 'customer-portal'
  AND owner_id IS NOT NULL;
