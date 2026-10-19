type EntityType = "project" | "task" | "note" | "idea" | "decision" | "document" | "inbox";

export type RelationType = "contains" | "belongs_to" | "requires" | "blocks" | "references" | "results_in" | "relates_to" | "supersedes";

export type RelationRow = {
  id: string;
  owner_id: string;
  source_id: string;
  source_type: EntityType;
  target_id: string;
  target_type: EntityType;
  relation_type: RelationType;
  metadata: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  source_episode_id: string | null;
  confidence: number | null;
  status: string;
};

const relationTable = `
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
  )
`;

export async function ensureRelationsSchema(db: D1Database) {
  await db.batch([
    db.prepare(relationTable),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique ON relations(owner_id, source_id, source_type, target_id, target_type, relation_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(owner_id, source_type, source_id, deleted_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(owner_id, target_type, target_id, deleted_at)"),
  ]);
  const columns = [["valid_from", "TEXT"], ["valid_until", "TEXT"], ["source_episode_id", "TEXT"], ["confidence", "REAL"], ["status", "TEXT NOT NULL DEFAULT 'active'"]] as const;
  const current = await db.prepare("PRAGMA table_info(relations)").all<{ name: string }>();
  const present = new Set(current.results.map((column) => column.name));
  for (const [name, definition] of columns) {
    if (!present.has(name)) {
      try { await db.prepare(`ALTER TABLE relations ADD COLUMN ${name} ${definition}`).run(); } catch { /* concurrent upgrade */ }
    }
  }
}

const relationId = (owner: string, sourceId: string, sourceType: string, targetId: string, targetType: string, relationType: string) =>
  `rel_${owner}_${sourceType}_${sourceId}_${relationType}_${targetType}_${targetId}`.slice(0, 180);

function insertRelation(db: D1Database, owner: string, sourceId: string, sourceType: EntityType, targetId: string, targetType: EntityType, relationType: RelationType, at: string) {
  return db.prepare(`INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`)
    .bind(relationId(owner, sourceId, sourceType, targetId, targetType, relationType), owner, sourceId, sourceType, targetId, targetType, relationType, at, at);
}

/** Idempotent bridge from the legacy link tables to the polymorphic ontology. */
export async function migrateLegacyRelations(db: D1Database, owner: string) {
  await ensureRelationsSchema(db);
  const at = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
      SELECT 'rel_' || owner_id || '_note_' || source_id || '_relates_to_note_' || target_id, owner_id, source_id, 'note', target_id, 'note', 'relates_to', '{}', created_at, ? FROM note_links WHERE owner_id = ?`).bind(at, owner),
    db.prepare(`INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
      SELECT 'rel_' || owner_id || '_task_' || task_id || '_references_note_' || note_id, owner_id, task_id, 'task', note_id, 'note', 'references', '{}', created_at, ? FROM task_note_links WHERE owner_id = ?`).bind(at, owner),
    db.prepare(`INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
      SELECT 'rel_' || owner_id || '_project_' || project_id || '_contains_task_' || id, owner_id, project_id, 'project', id, 'task', 'contains', '{}', created_at, ? FROM tasks WHERE owner_id = ? AND project_id IS NOT NULL`).bind(at, owner),
    db.prepare(`INSERT OR IGNORE INTO relations (id, owner_id, source_id, source_type, target_id, target_type, relation_type, metadata, created_at, updated_at)
      SELECT 'rel_' || owner_id || '_project_' || project_id || '_contains_note_' || id, owner_id, project_id, 'project', id, 'note', 'contains', '{}', created_at, ? FROM notes WHERE owner_id = ? AND project_id IS NOT NULL`).bind(at, owner),
  ];
  if (statements.length) await db.batch(statements);
}

export async function addRelation(db: D1Database, owner: string, sourceId: string, sourceType: EntityType, targetId: string, targetType: EntityType, relationType: RelationType) {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error("Quan hệ không hợp lệ.");
  await ensureRelationsSchema(db);
  const at = new Date().toISOString();
  await insertRelation(db, owner, sourceId, sourceType, targetId, targetType, relationType, at).run();
}

export async function removeRelation(db: D1Database, owner: string, sourceId: string, sourceType: EntityType, targetId: string, targetType: EntityType, relationType: RelationType) {
  await ensureRelationsSchema(db);
  await db.prepare("UPDATE relations SET deleted_at = ?, updated_at = ? WHERE owner_id = ? AND source_id = ? AND source_type = ? AND target_id = ? AND target_type = ? AND relation_type = ?")
    .bind(new Date().toISOString(), new Date().toISOString(), owner, sourceId, sourceType, targetId, targetType, relationType).run();
}

export async function syncProjectMembership(db: D1Database, owner: string, entityId: string, entityType: "task" | "note", projectId: string | null) {
  await ensureRelationsSchema(db);
  const at = new Date().toISOString();
  await db.prepare("UPDATE relations SET deleted_at = ?, updated_at = ? WHERE owner_id = ? AND target_id = ? AND target_type = ? AND source_type = 'project' AND relation_type = 'contains' AND deleted_at IS NULL")
    .bind(at, at, owner, entityId, entityType).run();
  if (projectId) await insertRelation(db, owner, projectId, "project", entityId, entityType, "contains", at).run();
}

export async function listRelations(db: D1Database, owner: string) {
  await migrateLegacyRelations(db, owner);
  return db.prepare(`SELECT relations.*, episodes.source AS source_label, episodes.raw_input AS source_input, episodes.captured_at AS source_captured_at
    FROM relations LEFT JOIN episodes ON episodes.id = relations.source_episode_id AND episodes.owner_id = relations.owner_id
    WHERE relations.owner_id = ? AND relations.deleted_at IS NULL ORDER BY relations.created_at ASC`).bind(owner).all<RelationRow & { source_label?: string | null; source_input?: string | null; source_captured_at?: string | null }>();
}
