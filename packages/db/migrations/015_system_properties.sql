CREATE TABLE IF NOT EXISTS system_properties (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default system properties
INSERT INTO system_properties (key, value) VALUES
  ('max_upload_size', '10485760'),
  ('default_discovery_timeout', '300'),
  ('session_ttl_hours', '24'),
  ('change_manager.state_machine', '{"states":["draft","pending_approval","approved","implemented","closed","rejected","rolled_back"],"transitions":[{"from":"draft","to":"pending_approval","roles":["operator","change_manager","admin","security_admin"]},{"from":"pending_approval","to":"approved","roles":["approver","change_manager","admin","security_admin"]},{"from":"pending_approval","to":"rejected","roles":["approver","change_manager","admin","security_admin"]},{"from":"approved","to":"implemented","roles":["change_manager","admin","security_admin"]},{"from":"implemented","to":"closed","roles":["change_manager","admin","security_admin"]},{"from":"implemented","to":"rolled_back","roles":["change_manager","admin","security_admin"]}]}')
ON CONFLICT (key) DO NOTHING;
