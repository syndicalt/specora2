ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS package_id VARCHAR(120);
ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS package_name VARCHAR(255);
ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS entitlement_mode VARCHAR(40) NOT NULL DEFAULT 'included';
ALTER TABLE marketplace_apps ADD COLUMN IF NOT EXISTS bundled_with_platform BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS package_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id VARCHAR(120) NOT NULL,
    tenant_id VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'placeholder',
    source VARCHAR(80) NOT NULL DEFAULT 'manual',
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(package_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS dcim_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    capacity_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    used_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    cooling_capacity_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dcim_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES dcim_sites(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    floor_label VARCHAR(80),
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    temperature_c NUMERIC(5,2),
    humidity_percent NUMERIC(5,2),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dcim_racks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES dcim_rooms(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    row_label VARCHAR(80),
    position_label VARCHAR(80),
    ru_total INTEGER NOT NULL DEFAULT 42,
    ru_used INTEGER NOT NULL DEFAULT 0,
    power_capacity_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    power_used_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    weight_capacity_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
    weight_used_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
    redundancy VARCHAR(40) NOT NULL DEFAULT 'A/B',
    risk_score INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dcim_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rack_id UUID REFERENCES dcim_racks(id) ON DELETE SET NULL,
    ci_id VARCHAR(255),
    asset_id UUID,
    name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(80) NOT NULL DEFAULT 'server',
    vendor VARCHAR(120),
    model VARCHAR(120),
    ru_start INTEGER,
    ru_height INTEGER NOT NULL DEFAULT 1,
    power_draw_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    network_ports INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dcim_power_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID REFERENCES dcim_sites(id) ON DELETE CASCADE,
    rack_id UUID REFERENCES dcim_racks(id) ON DELETE CASCADE,
    source_name VARCHAR(255) NOT NULL,
    source_type VARCHAR(80) NOT NULL,
    path_role VARCHAR(40) NOT NULL DEFAULT 'primary',
    capacity_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    load_kw NUMERIC(10,2) NOT NULL DEFAULT 0,
    redundancy_group VARCHAR(80),
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dcim_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(120) NOT NULL,
    external_ref VARCHAR(255),
    severity VARCHAR(40) NOT NULL DEFAULT 'info',
    status VARCHAR(40) NOT NULL DEFAULT 'open',
    event_type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    site_id UUID REFERENCES dcim_sites(id) ON DELETE SET NULL,
    room_id UUID REFERENCES dcim_rooms(id) ON DELETE SET NULL,
    rack_id UUID REFERENCES dcim_racks(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES dcim_assets(id) ON DELETE SET NULL,
    correlated_event_ids UUID[] NOT NULL DEFAULT '{}',
    ai_summary TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source, external_ref)
);

CREATE TABLE IF NOT EXISTS dcim_floorplans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES dcim_rooms(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    width INTEGER NOT NULL DEFAULT 1200,
    height INTEGER NOT NULL DEFAULT 720,
    unit VARCHAR(40) NOT NULL DEFAULT 'px',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(room_id, name)
);

CREATE TABLE IF NOT EXISTS dcim_floorplan_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floorplan_id UUID NOT NULL REFERENCES dcim_floorplans(id) ON DELETE CASCADE,
    object_type VARCHAR(80) NOT NULL,
    object_id UUID,
    label VARCHAR(255) NOT NULL,
    x NUMERIC(10,2) NOT NULL DEFAULT 0,
    y NUMERIC(10,2) NOT NULL DEFAULT 0,
    width NUMERIC(10,2) NOT NULL DEFAULT 120,
    height NUMERIC(10,2) NOT NULL DEFAULT 80,
    rotation NUMERIC(6,2) NOT NULL DEFAULT 0,
    layer VARCHAR(80) NOT NULL DEFAULT 'default',
    style JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(floorplan_id, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_dcim_rooms_site ON dcim_rooms(site_id);
CREATE INDEX IF NOT EXISTS idx_dcim_racks_room ON dcim_racks(room_id);
CREATE INDEX IF NOT EXISTS idx_dcim_assets_rack ON dcim_assets(rack_id);
CREATE INDEX IF NOT EXISTS idx_dcim_assets_ci ON dcim_assets(ci_id);
CREATE INDEX IF NOT EXISTS idx_dcim_events_status_severity ON dcim_events(status, severity);
CREATE INDEX IF NOT EXISTS idx_dcim_events_rack ON dcim_events(rack_id);
CREATE INDEX IF NOT EXISTS idx_dcim_floorplans_room ON dcim_floorplans(room_id);
CREATE INDEX IF NOT EXISTS idx_dcim_floorplan_objects_floorplan ON dcim_floorplan_objects(floorplan_id);

INSERT INTO app_permissions (role, resource, action) VALUES
  ('viewer', 'it-visibility', 'read'),
  ('operator', 'it-visibility', 'read'),
  ('admin', 'it-visibility', 'read'),
  ('admin', 'it-visibility', 'write'),
  ('admin', 'it-visibility', 'operate'),
  ('security_admin', 'it-visibility', 'read'),
  ('security_admin', 'it-visibility', 'write'),
  ('security_admin', 'it-visibility', 'operate')
ON CONFLICT (role, resource, action) DO NOTHING;

INSERT INTO package_entitlements (package_id, tenant_id, status, source, metadata)
VALUES ('it-visibility', NULL, 'placeholder', 'system', '{"note":"Payment and subscription enforcement hook placeholder"}')
ON CONFLICT (package_id, tenant_id) DO UPDATE SET
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

WITH site AS (
  INSERT INTO dcim_sites (id, name, location, capacity_kw, used_kw, cooling_capacity_kw, metadata)
  VALUES ('11111111-1111-4111-8111-111111111111', 'Dallas DC1', 'Dallas, TX', 1200, 742, 1350, '{"tier":"III","package":"it-visibility"}')
  ON CONFLICT (id) DO UPDATE SET used_kw = EXCLUDED.used_kw, updated_at = NOW()
  RETURNING id
), room AS (
  INSERT INTO dcim_rooms (id, site_id, name, floor_label, temperature_c, humidity_percent)
  VALUES ('22222222-2222-4222-8222-222222222222', (SELECT id FROM site), 'Compute Hall A', 'L1', 22.4, 44.2)
  ON CONFLICT (id) DO UPDATE SET temperature_c = EXCLUDED.temperature_c, updated_at = NOW()
  RETURNING id
), racks AS (
  INSERT INTO dcim_racks (id, room_id, name, row_label, position_label, ru_total, ru_used, power_capacity_kw, power_used_kw, weight_capacity_kg, weight_used_kg, redundancy, risk_score, status)
  VALUES
    ('33333333-3333-4333-8333-333333333331', (SELECT id FROM room), 'A12', 'A', '12', 42, 31, 18, 13.8, 1200, 880, 'A/B', 34, 'warning'),
    ('33333333-3333-4333-8333-333333333332', (SELECT id FROM room), 'A13', 'A', '13', 42, 24, 18, 9.2, 1200, 710, 'A/B', 12, 'operational'),
    ('33333333-3333-4333-8333-333333333333', (SELECT id FROM room), 'B07', 'B', '07', 42, 38, 24, 22.6, 1200, 1090, 'N+1', 71, 'critical')
  ON CONFLICT (id) DO UPDATE SET power_used_kw = EXCLUDED.power_used_kw, risk_score = EXCLUDED.risk_score, status = EXCLUDED.status, updated_at = NOW()
  RETURNING id
)
INSERT INTO dcim_assets (id, rack_id, ci_id, name, asset_type, vendor, model, ru_start, ru_height, power_draw_kw, network_ports, status)
VALUES
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333331', 'demo-server-0001', 'checkout-app-01', 'server', 'Dell', 'R760', 18, 2, 0.82, 4, 'operational'),
  ('44444444-4444-4444-8444-444444444442', '33333333-3333-4333-8333-333333333332', 'demo-server-0002', 'checkout-app-02', 'server', 'Dell', 'R760', 22, 2, 0.78, 4, 'operational'),
  ('44444444-4444-4444-8444-444444444443', '33333333-3333-4333-8333-333333333333', 'demo-database-0001', 'orders-db-01', 'server', 'HPE', 'DL380', 12, 2, 1.15, 6, 'warning')
ON CONFLICT (id) DO UPDATE SET rack_id = EXCLUDED.rack_id, status = EXCLUDED.status, updated_at = NOW();

INSERT INTO dcim_power_paths (id, site_id, rack_id, source_name, source_type, path_role, capacity_kw, load_kw, redundancy_group, status)
VALUES
  ('55555555-5555-4555-8555-555555555551', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', 'UPS-A / PDU-A12-A', 'pdu', 'A', 9, 6.9, 'A12', 'operational'),
  ('55555555-5555-4555-8555-555555555552', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', 'UPS-B / PDU-A12-B', 'pdu', 'B', 9, 6.9, 'A12', 'operational'),
  ('55555555-5555-4555-8555-555555555553', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'UPS-A / PDU-B07-A', 'pdu', 'A', 12, 11.8, 'B07', 'warning')
ON CONFLICT (id) DO UPDATE SET load_kw = EXCLUDED.load_kw, status = EXCLUDED.status, updated_at = NOW();

INSERT INTO dcim_events (id, source, external_ref, severity, status, event_type, title, description, site_id, room_id, rack_id, ai_summary)
VALUES
  ('66666666-6666-4666-8666-666666666661', 'pdu', 'PDU-B07-A-load', 'critical', 'open', 'power', 'PDU B07-A load above redundancy threshold', 'PDU load has exceeded safe failover threshold for N+1 redundancy.', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'Rack B07 cannot safely absorb A-side failure. Freeze non-emergency installs and rebalance load.'),
  ('66666666-6666-4666-8666-666666666662', 'sensor', 'A12-inlet-temp', 'warning', 'open', 'thermal', 'A12 inlet temperature trending high', 'Temperature drift detected near upper warning band.', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333331', 'Thermal drift is isolated to Row A. Check airflow blanking and CRAC setpoint before incident escalation.')
ON CONFLICT (source, external_ref) DO UPDATE SET
  severity = EXCLUDED.severity,
  status = EXCLUDED.status,
  last_seen_at = NOW(),
  ai_summary = EXCLUDED.ai_summary,
  updated_at = NOW();

WITH floorplan AS (
  INSERT INTO dcim_floorplans (id, room_id, name, width, height, metadata)
  VALUES ('77777777-7777-4777-8777-777777777771', '22222222-2222-4222-8222-222222222222', 'Compute Hall A Floorplan', 1200, 720, '{"hotAisle":"north","coldAisle":"south"}')
  ON CONFLICT (room_id, name) DO UPDATE SET width = EXCLUDED.width, height = EXCLUDED.height, updated_at = NOW()
  RETURNING id
)
INSERT INTO dcim_floorplan_objects (id, floorplan_id, object_type, object_id, label, x, y, width, height, layer, style)
VALUES
  ('88888888-8888-4888-8888-888888888881', (SELECT id FROM floorplan), 'rack', '33333333-3333-4333-8333-333333333331', 'A12', 140, 180, 120, 180, 'rack', '{"fill":"#1d4ed8"}'),
  ('88888888-8888-4888-8888-888888888882', (SELECT id FROM floorplan), 'rack', '33333333-3333-4333-8333-333333333332', 'A13', 300, 180, 120, 180, 'rack', '{"fill":"#047857"}'),
  ('88888888-8888-4888-8888-888888888883', (SELECT id FROM floorplan), 'rack', '33333333-3333-4333-8333-333333333333', 'B07', 140, 430, 120, 180, 'rack', '{"fill":"#b91c1c"}'),
  ('88888888-8888-4888-8888-888888888884', (SELECT id FROM floorplan), 'cooling', '99999999-9999-4999-8999-999999999984', 'CRAC-1', 720, 120, 180, 100, 'cooling', '{"fill":"#0891b2"}'),
  ('88888888-8888-4888-8888-888888888885', (SELECT id FROM floorplan), 'power', '99999999-9999-4999-8999-999999999985', 'UPS-A', 720, 430, 180, 100, 'power', '{"fill":"#ca8a04"}')
ON CONFLICT (floorplan_id, object_type, object_id) DO UPDATE SET
  x = EXCLUDED.x,
  y = EXCLUDED.y,
  width = EXCLUDED.width,
  height = EXCLUDED.height,
  style = EXCLUDED.style,
  updated_at = NOW();
