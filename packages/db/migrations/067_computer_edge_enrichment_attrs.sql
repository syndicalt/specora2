WITH computer AS (
  SELECT id FROM ci_classes WHERE name = 'Computer'
), attrs AS (
  SELECT * FROM (VALUES
    ('manufacturer', 'Manufacturer', 'string', false, true, false, NULL::text[], NULL::varchar, 9),
    ('model', 'Model', 'string', false, true, false, NULL::text[], NULL::varchar, 10),
    ('hardwareVersion', 'Hardware Version', 'string', false, false, false, NULL::text[], NULL::varchar, 11),
    ('healthSummary', 'Health Summary', 'json', false, true, false, NULL::text[], NULL::varchar, 12)
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
