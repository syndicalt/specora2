CREATE TABLE IF NOT EXISTS table_saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    name VARCHAR(120) NOT NULL,
    search_query TEXT NOT NULL DEFAULT '',
    filters JSONB NOT NULL DEFAULT '[]'::jsonb,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    density VARCHAR(20) NOT NULL DEFAULT 'comfortable',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, table_id, name)
);

CREATE INDEX IF NOT EXISTS idx_table_saved_views_user_table ON table_saved_views(user_id, table_id, updated_at DESC);
