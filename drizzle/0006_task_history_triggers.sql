CREATE TRIGGER task_status_history AFTER UPDATE OF status ON tasks
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO task_history (id, owner_id, task_id, field, old_value, new_value, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.owner_id, NEW.id, 'status', OLD.status, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER task_plan_history AFTER UPDATE OF planned_date ON tasks
WHEN OLD.planned_date IS NOT NEW.planned_date
BEGIN
  INSERT INTO task_history (id, owner_id, task_id, field, old_value, new_value, created_at)
  VALUES (lower(hex(randomblob(16))), NEW.owner_id, NEW.id, 'planned_date', OLD.planned_date, NEW.planned_date, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
