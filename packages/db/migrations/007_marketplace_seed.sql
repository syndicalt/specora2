INSERT INTO marketplace_apps (id, name, description, url, icon, version, permissions, react_version, author, author_url, status) VALUES
  ('hello-world', 'Hello World', 'A minimal demo app showcasing the Specora Arc platform.', 'https://unpkg.com/@specora/hello-world@1.0.0/dist/index.js', 'Sparkles', '1.0.0', '["read:cmdb"]', '^18.0.0', 'Specora Team', 'https://specora.dev', 'approved'),
  ('ci-health-dashboard', 'CI Health Dashboard', 'Visual analytics for CMDB health scores and discovery coverage.', 'https://unpkg.com/@specora/ci-health@1.0.0/dist/index.js', 'Activity', '1.0.0', '["read:cmdb", "read:relationships"]', '^18.0.0', 'Specora Team', 'https://specora.dev', 'approved')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  url = EXCLUDED.url,
  icon = EXCLUDED.icon,
  version = EXCLUDED.version,
  permissions = EXCLUDED.permissions,
  react_version = EXCLUDED.react_version,
  author = EXCLUDED.author,
  author_url = EXCLUDED.author_url,
  status = EXCLUDED.status;
