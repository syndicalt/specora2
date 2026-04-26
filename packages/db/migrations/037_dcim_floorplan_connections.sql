CREATE TABLE IF NOT EXISTS dcim_floorplan_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floorplan_id UUID NOT NULL REFERENCES dcim_floorplans(id) ON DELETE CASCADE,
    source_object_id UUID NOT NULL REFERENCES dcim_floorplan_objects(id) ON DELETE CASCADE,
    target_object_id UUID NOT NULL REFERENCES dcim_floorplan_objects(id) ON DELETE CASCADE,
    connection_type VARCHAR(80) NOT NULL DEFAULT 'network',
    label VARCHAR(255),
    status VARCHAR(40) NOT NULL DEFAULT 'operational',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(floorplan_id, source_object_id, target_object_id, connection_type)
);

CREATE INDEX IF NOT EXISTS idx_dcim_floorplan_connections_floorplan ON dcim_floorplan_connections(floorplan_id);
CREATE INDEX IF NOT EXISTS idx_dcim_floorplan_connections_source ON dcim_floorplan_connections(source_object_id);
CREATE INDEX IF NOT EXISTS idx_dcim_floorplan_connections_target ON dcim_floorplan_connections(target_object_id);

WITH objects AS (
  SELECT id, object_type, object_id, label
  FROM dcim_floorplan_objects
  WHERE floorplan_id = '77777777-7777-4777-8777-777777777771'
)
INSERT INTO dcim_floorplan_connections (id, floorplan_id, source_object_id, target_object_id, connection_type, label, status, metadata)
VALUES
  (
    '99999999-9999-4999-8999-999999999991',
    '77777777-7777-4777-8777-777777777771',
    (SELECT id FROM objects WHERE label = 'UPS-A'),
    (SELECT id FROM objects WHERE label = 'A12'),
    'power',
    'UPS-A / PDU-A12-A',
    'operational',
    '{"role":"A","redundancyGroup":"A12"}'
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    '77777777-7777-4777-8777-777777777771',
    (SELECT id FROM objects WHERE label = 'UPS-A'),
    (SELECT id FROM objects WHERE label = 'B07'),
    'power',
    'UPS-A / PDU-B07-A',
    'warning',
    '{"role":"A","redundancyGroup":"B07"}'
  ),
  (
    '99999999-9999-4999-8999-999999999993',
    '77777777-7777-4777-8777-777777777771',
    (SELECT id FROM objects WHERE label = 'CRAC-1'),
    (SELECT id FROM objects WHERE label = 'A12'),
    'cooling',
    'Cold aisle influence',
    'operational',
    '{"mode":"thermal-zone"}'
  )
ON CONFLICT (floorplan_id, source_object_id, target_object_id, connection_type) DO UPDATE SET
  label = EXCLUDED.label,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
