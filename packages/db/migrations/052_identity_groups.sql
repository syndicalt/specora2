CREATE TABLE IF NOT EXISTS identity_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    external_id TEXT,
    cmdb_ci_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS identity_group_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES identity_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS identity_group_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES identity_groups(id) ON DELETE CASCADE,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_identity_group_memberships_user ON identity_group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_group_permissions_group ON identity_group_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_identity_group_permissions_target ON identity_group_permissions(resource, action);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('security_admin', 'identity-groups', 'read'),
  ('security_admin', 'identity-groups', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;
