export async function ensureGoogleCalendarSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS google_calendar_connections (
      owner_id TEXT PRIMARY KEY NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      calendar_name TEXT NOT NULL DEFAULT 'Lịch chính',
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TEXT,
      scope TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS google_calendar_sync (
      owner_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      google_event_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_id, task_id)
    )`),
  ]);
}

