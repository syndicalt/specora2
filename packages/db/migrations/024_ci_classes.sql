CREATE TABLE IF NOT EXISTS ci_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    parent_class VARCHAR(100) REFERENCES ci_classes(name),
    icon VARCHAR(50),
    color VARCHAR(20),
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_by_app_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ci_class_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES ci_classes(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    attr_type VARCHAR(20) NOT NULL
        CHECK (attr_type IN ('string','number','boolean','enum','date','json','reference')),
    is_mandatory BOOLEAN NOT NULL DEFAULT false,
    is_health_required BOOLEAN NOT NULL DEFAULT false,
    is_key_attribute BOOLEAN NOT NULL DEFAULT false,
    default_value TEXT,
    validation_regex TEXT,
    enum_values TEXT[],
    reference_class VARCHAR(100),
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE(class_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ci_classes_name ON ci_classes(name);
CREATE INDEX IF NOT EXISTS idx_ci_class_attrs_class ON ci_class_attributes(class_id);
