CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  raw_input TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_episodes_owner_captured ON episodes(owner_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_owner_source ON episodes(owner_id, source, content_type);
ALTER TABLE relations ADD COLUMN valid_from TEXT;
ALTER TABLE relations ADD COLUMN valid_until TEXT;
ALTER TABLE relations ADD COLUMN source_episode_id TEXT;
ALTER TABLE relations ADD COLUMN confidence REAL;
ALTER TABLE relations ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
