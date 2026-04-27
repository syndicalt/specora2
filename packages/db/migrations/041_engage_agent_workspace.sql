INSERT INTO app_permissions (role, resource, action)
VALUES
  ('admin', 'engage-agent-workspace', 'read'),
  ('admin', 'engage-agent-workspace', 'write'),
  ('security_admin', 'engage-agent-workspace', 'read'),
  ('security_admin', 'engage-agent-workspace', 'write'),
  ('operator', 'engage-agent-workspace', 'read'),
  ('operator', 'engage-agent-workspace', 'write'),
  ('viewer', 'engage-agent-workspace', 'read')
ON CONFLICT DO NOTHING;
