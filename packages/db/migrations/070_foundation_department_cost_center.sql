INSERT INTO ci_classes (name, display_name, description, parent_class, icon, color, is_system)
VALUES
  ('Department', 'Department', 'Organizational department or function', NULL, 'Building2', '#38bdf8', true),
  ('CostCenter', 'Cost Center', 'Financial cost center used for ownership, chargeback, and reporting', NULL, 'BadgeDollarSign', '#22c55e', true)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  is_system = true,
  updated_at = NOW();

WITH attrs AS (
  SELECT class_name, name, display_name, attr_type, is_mandatory, is_health_required, is_key_attribute, enum_values, reference_class, sort_order
  FROM (VALUES
    ('Department', 'departmentCode', 'Department Code', 'string', false, true, true, NULL::text[], NULL::varchar, 1),
    ('Department', 'managerId', 'Manager', 'reference', false, true, false, NULL::text[], 'User'::varchar, 2),
    ('Department', 'parentDepartmentId', 'Parent Department', 'reference', false, false, false, NULL::text[], 'Department'::varchar, 3),
    ('Department', 'costCenterId', 'Cost Center', 'reference', false, true, false, NULL::text[], 'CostCenter'::varchar, 4),
    ('CostCenter', 'code', 'Code', 'string', true, false, true, NULL::text[], NULL::varchar, 1),
    ('CostCenter', 'ownerId', 'Owner', 'reference', false, true, false, NULL::text[], 'User'::varchar, 2),
    ('CostCenter', 'departmentId', 'Department', 'reference', false, true, false, NULL::text[], 'Department'::varchar, 3),
    ('CostCenter', 'status', 'Status', 'enum', false, true, false, ARRAY['active','inactive']::text[], NULL::varchar, 4)
  ) AS value(class_name, name, display_name, attr_type, is_mandatory, is_health_required, is_key_attribute, enum_values, reference_class, sort_order)
)
INSERT INTO ci_class_attributes
  (class_id, name, display_name, attr_type, is_mandatory, is_health_required, is_key_attribute, enum_values, reference_class, sort_order)
SELECT c.id, attrs.name, attrs.display_name, attrs.attr_type, attrs.is_mandatory, attrs.is_health_required, attrs.is_key_attribute, attrs.enum_values, attrs.reference_class, attrs.sort_order
FROM attrs
JOIN ci_classes c ON c.name = attrs.class_name
ON CONFLICT (class_id, name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  attr_type = EXCLUDED.attr_type,
  is_mandatory = EXCLUDED.is_mandatory,
  is_health_required = EXCLUDED.is_health_required,
  is_key_attribute = EXCLUDED.is_key_attribute,
  enum_values = EXCLUDED.enum_values,
  reference_class = EXCLUDED.reference_class,
  sort_order = EXCLUDED.sort_order;

UPDATE ci_class_attributes AS attr
SET reference_class = updates.reference_class,
    attr_type = 'reference',
    enum_values = NULL
FROM (
  SELECT c.id AS class_id, value.name, value.reference_class
  FROM ci_classes c
  JOIN (VALUES
    ('User', 'departmentId', 'Department'),
    ('User', 'costCenterId', 'CostCenter')
  ) AS value(class_name, name, reference_class) ON value.class_name = c.name
) AS updates
WHERE attr.class_id = updates.class_id
  AND attr.name = updates.name;
