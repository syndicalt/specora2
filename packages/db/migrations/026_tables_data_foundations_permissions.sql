INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'tables', 'read'),
  ('operator', 'tables', 'read'),
  ('operator', 'tables', 'write'),
  ('admin', 'tables', 'read'),
  ('admin', 'tables', 'write'),
  ('security_admin', 'tables', 'read'),
  ('security_admin', 'tables', 'write'),
  ('viewer', 'data-foundations', 'read'),
  ('operator', 'data-foundations', 'read'),
  ('admin', 'data-foundations', 'read'),
  ('admin', 'data-foundations', 'write'),
  ('security_admin', 'data-foundations', 'read'),
  ('security_admin', 'data-foundations', 'write')
ON CONFLICT (role, resource, action) DO NOTHING;
