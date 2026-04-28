ALTER TABLE ci_classes
  ADD COLUMN IF NOT EXISTS display_field VARCHAR(100),
  ADD COLUMN IF NOT EXISTS secondary_display_fields TEXT[] NOT NULL DEFAULT '{}';

UPDATE ci_classes
SET display_field = COALESCE(display_field, 'name')
WHERE display_field IS NULL;

UPDATE ci_classes
SET secondary_display_fields = ARRAY['email']
WHERE name = 'User'
  AND (secondary_display_fields IS NULL OR secondary_display_fields = '{}');

UPDATE ci_classes
SET secondary_display_fields = ARRAY['departmentCode']
WHERE name = 'Department'
  AND (secondary_display_fields IS NULL OR secondary_display_fields = '{}');

UPDATE ci_classes
SET secondary_display_fields = ARRAY['code']
WHERE name = 'CostCenter'
  AND (secondary_display_fields IS NULL OR secondary_display_fields = '{}');
