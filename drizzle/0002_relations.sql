CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON relations(owner_id, source_id, source_type, target_id, target_type, relation_type);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(owner_id, source_type, source_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(owner_id, target_type, target_id, deleted_at);
INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
SELECT 'rel_' || owner_id || '_note_' || source_id || '_relates_to_note_' || target_id, owner_id, source_id, 'note', target_id, 'note', 'relates_to', '{}', created_at, created_at FROM note_links;
INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
SELECT 'rel_' || owner_id || '_task_' || task_id || '_references_note_' || note_id, owner_id, task_id, 'task', note_id, 'note', 'references', '{}', created_at, created_at FROM task_note_links;
INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
SELECT 'rel_' || owner_id || '_project_' || project_id || '_contains_task_' || id, owner_id, project_id, 'project', id, 'task', 'contains', '{}', created_at, created_at FROM tasks WHERE project_id IS NOT NULL;
INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
SELECT 'rel_' || owner_id || '_project_' || project_id || '_contains_note_' || id, owner_id, project_id, 'project', id, 'note', 'contains', '{}', created_at, created_at FROM notes WHERE project_id IS NOT NULL;
