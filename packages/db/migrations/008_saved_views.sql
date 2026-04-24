CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  root_id TEXT NOT NULL,
  class_filter JSONB DEFAULT '[]',
  environment_filter JSONB DEFAULT '[]',
  relationship_filter JSONB DEFAULT '[]',
  camera_x DOUBLE PRECISION,
  camera_y DOUBLE PRECISION,
  camera_zoom DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_saved_views_user ON saved_views(user_id);
