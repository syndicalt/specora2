INSERT INTO app_permissions (role, resource, action) VALUES
  ('change_manager', 'change-manager', 'read'),
  ('change_manager', 'change-manager', 'write'),
  ('change_manager', 'change-manager', 'approve'),
  ('approver', 'change-manager', 'read'),
  ('approver', 'change-manager', 'approve')
ON CONFLICT (role, resource, action) DO NOTHING;
