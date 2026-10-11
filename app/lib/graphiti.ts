import { ensureRelationsSchema } from "./relations";

export type EpisodeInput = {
  source: "web" | "telegram" | "import" | "calendar";
  contentType: "text" | "image" | "audio" | "video" | "document" | "event";
  rawInput: string;
  metadata?: Record<string, unknown>;
};

const uid = () => `episode_${crypto.randomUUID()}`;

/** Immutable observations used for provenance and replay. D1 remains canonical. */
export async function ensureGraphitiSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    source TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    raw_input TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS idx_episodes_owner_captured ON episodes(owner_id, captured_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_episodes_owner_source ON episodes(owner_id, source, content_type)"),
  ]);
  await ensureRelationsSchema(db);
}

export async function recordEpisode(db: D1Database, owner: string, input: EpisodeInput) {
  await ensureGraphitiSchema(db);
  const id = uid();
  const at = new Date().toISOString();
  await db.prepare("INSERT INTO episodes (id, owner_id, source, content_type, raw_input, metadata, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, owner, input.source, input.contentType, input.rawInput, JSON.stringify(input.metadata || {}), at, at).run();
  return id;
}

export async function completeEpisode(db: D1Database, owner: string, id: string) {
  await db.prepare("UPDATE episodes SET processed_at = ? WHERE id = ? AND owner_id = ? AND processed_at IS NULL")
    .bind(new Date().toISOString(), id, owner).run();
}
