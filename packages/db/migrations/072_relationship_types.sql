CREATE TABLE IF NOT EXISTS relationship_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL UNIQUE,
    display_name VARCHAR(160) NOT NULL,
    description TEXT,
    color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
    active BOOLEAN NOT NULL DEFAULT true,
    directed BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO relationship_types (name, display_name, description, color, is_system, sort_order)
VALUES
  ('PART_OF', 'Part Of', 'Composition or membership relationship.', '#a78bfa', true, 10),
  ('DEPENDS_ON', 'Depends On', 'Dependency relationship used for impact analysis.', '#6366f1', true, 20),
  ('HOSTED_ON', 'Hosted On', 'Runtime or infrastructure hosting relationship.', '#2dd4bf', true, 30),
  ('MANAGED_BY', 'Managed By', 'Operational management relationship.', '#fbbf24', true, 40),
  ('OWNED_BY', 'Owned By', 'Ownership relationship.', '#34d399', true, 50),
  ('LOCATED_AT', 'Located At', 'Physical or logical location relationship.', '#fb7185', true, 60)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = COALESCE(relationship_types.description, EXCLUDED.description),
  color = EXCLUDED.color,
  is_system = true,
  active = true,
  updated_at = NOW();
