INSERT INTO ci_classes (name, display_name, description, parent_class, icon, color, is_system)
VALUES ('Computer', 'Computer', 'End-user laptop, desktop, or workstation device', NULL, 'Laptop', '#06b6d4', true)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  is_system = true,
  updated_at = NOW();

WITH computer AS (
  SELECT id FROM ci_classes WHERE name = 'Computer'
), attrs AS (
  SELECT * FROM (VALUES
    ('ipAddress', 'IP Address', 'string', true, false, true, NULL::text[], NULL::varchar, 1),
    ('os', 'Operating System', 'string', false, true, true, NULL::text[], NULL::varchar, 2),
    ('osVersion', 'OS Version', 'string', false, true, false, NULL::text[], NULL::varchar, 3),
    ('deviceType', 'Device Type', 'enum', false, true, true, ARRAY['laptop','desktop','workstation','tablet','thin_client','unknown']::text[], NULL::varchar, 4),
    ('assignedUser', 'Assigned User', 'string', false, true, false, NULL::text[], NULL::varchar, 5),
    ('serialNumber', 'Serial Number', 'string', false, true, false, NULL::text[], NULL::varchar, 6),
    ('assetTag', 'Asset Tag', 'string', false, true, false, NULL::text[], NULL::varchar, 7),
    ('memoryGB', 'Memory (GB)', 'number', false, true, false, NULL::text[], NULL::varchar, 8)
  ) AS value(name, display_name, attr_type, is_mandatory, is_health_required, is_key_attribute, enum_values, reference_class, sort_order)
)
INSERT INTO ci_class_attributes
  (class_id, name, display_name, attr_type, is_mandatory, is_health_required, is_key_attribute, enum_values, reference_class, sort_order)
SELECT computer.id, attrs.name, attrs.display_name, attrs.attr_type, attrs.is_mandatory, attrs.is_health_required, attrs.is_key_attribute, attrs.enum_values, attrs.reference_class, attrs.sort_order
FROM computer
CROSS JOIN attrs
ON CONFLICT (class_id, name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  attr_type = EXCLUDED.attr_type,
  is_mandatory = EXCLUDED.is_mandatory,
  is_health_required = EXCLUDED.is_health_required,
  is_key_attribute = EXCLUDED.is_key_attribute,
  enum_values = EXCLUDED.enum_values,
  reference_class = EXCLUDED.reference_class,
  sort_order = EXCLUDED.sort_order;
