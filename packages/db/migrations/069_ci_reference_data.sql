UPDATE ci_class_attributes
SET attr_type = 'reference',
    reference_class = 'User',
    enum_values = NULL
WHERE name IN (
  'assignedUser',
  'assignedUserId',
  'assignedTo',
  'assigned_to',
  'owner',
  'ownerId',
  'businessOwner',
  'businessOwnerId',
  'technicalOwner',
  'technicalOwnerId',
  'supportedBy',
  'supportedById',
  'managedBy',
  'managedById',
  'serviceOwnerId',
  'managerId',
  'openedBy',
  'createdBy',
  'updatedBy',
  'requestedBy'
)
AND (
  attr_type <> 'reference'
  OR reference_class IS DISTINCT FROM 'User'
);

CREATE TABLE IF NOT EXISTS ci_environment_choices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    is_production_like BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ci_environment_choices_active_sort
  ON ci_environment_choices(active, sort_order, name);

INSERT INTO ci_environment_choices (code, name, active, sort_order, is_production_like)
VALUES
  ('development', 'Development', true, 10, false),
  ('test', 'Test', true, 20, false),
  ('uat', 'UAT', true, 30, false),
  ('staging', 'Staging', true, 40, false),
  ('production', 'Production', true, 50, true),
  ('sandbox', 'Sandbox', true, 60, false),
  ('dr', 'Disaster Recovery', true, 70, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  active = EXCLUDED.active,
  sort_order = EXCLUDED.sort_order,
  is_production_like = EXCLUDED.is_production_like,
  updated_at = NOW();
