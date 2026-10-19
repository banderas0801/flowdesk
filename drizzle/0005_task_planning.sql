ALTER TABLE tasks ADD COLUMN planned_date TEXT;
ALTER TABLE tasks ADD COLUMN completed_at TEXT;
CREATE TABLE IF NOT EXISTS task_history (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, task_id TEXT NOT NULL, field TEXT NOT NULL, old_value TEXT, new_value TEXT, created_at TEXT NOT NULL);
CREATE TRIGGER task_completion_stamp AFTER UPDATE OF status ON tasks
WHEN OLD.status <> NEW.status
BEGIN
  UPDATE tasks SET completed_at = CASE WHEN NEW.status = 'done' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id = NEW.id AND owner_id = NEW.owner_id;
END;
