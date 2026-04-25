-- Add cmdb:admin permission for CI Class Manager
INSERT INTO app_permissions (role, resource, action) VALUES
  ('security_admin', 'cmdb', 'admin'),
  ('admin', 'cmdb', 'admin')
ON CONFLICT DO NOTHING;
