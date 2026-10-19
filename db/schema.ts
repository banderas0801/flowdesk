import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
};

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(),
  area: text("area").notNull().default("Cá nhân"), color: text("color").notNull().default("blue"),
  goal: text("goal").notNull().default(""), dueDate: text("due_date"), ...timestamps,
}, (table) => [index("idx_projects_owner_deleted").on(table.ownerId, table.deletedAt)]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(), description: text("description").notNull().default(""),
  status: text("status", { enum: ["todo", "doing", "done"] }).notNull().default("todo"),
  priority: text("priority", { enum: ["Cao", "Vừa", "Thấp"] }).notNull().default("Vừa"),
  plannedDate: text("planned_date"), completedAt: text("completed_at"), dueAt: text("due_at"), position: integer("position").notNull().default(0), checklist: text("checklist").notNull().default("[]"), ...timestamps,
}, (table) => [index("idx_tasks_owner_status_deleted").on(table.ownerId, table.status, table.deletedAt), index("idx_tasks_project").on(table.projectId)]);

export const taskHistory = sqliteTable("task_history", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), taskId: text("task_id").notNull(),
  field: text("field").notNull(), oldValue: text("old_value"), newValue: text("new_value"), createdAt: text("created_at").notNull(),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(), body: text("body").notNull().default(""), tag: text("tag").notNull().default("Ý tưởng"),
  color: text("color").notNull().default("blue"), ...timestamps,
}, (table) => [index("idx_notes_owner_deleted").on(table.ownerId, table.deletedAt), index("idx_notes_project").on(table.projectId)]);

export const noteLinks = sqliteTable("note_links", {
  ownerId: text("owner_id").notNull(), sourceId: text("source_id").notNull().references(() => notes.id),
  targetId: text("target_id").notNull().references(() => notes.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.ownerId, table.sourceId, table.targetId] }), index("idx_note_links_target").on(table.ownerId, table.targetId)]);

export const taskNoteLinks = sqliteTable("task_note_links", {
  ownerId: text("owner_id").notNull(), taskId: text("task_id").notNull().references(() => tasks.id),
  noteId: text("note_id").notNull().references(() => notes.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.ownerId, table.taskId, table.noteId] })]);

export const relations = sqliteTable("relations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), sourceId: text("source_id").notNull(),
  sourceType: text("source_type").notNull(), targetId: text("target_id").notNull(), targetType: text("target_type").notNull(),
  relationType: text("relation_type").notNull(), metadata: text("metadata").notNull().default("{}"),
  validFrom: text("valid_from"), validUntil: text("valid_until"), sourceEpisodeId: text("source_episode_id"),
  confidence: text("confidence"), relationStatus: text("status").notNull().default("active"), ...timestamps,
}, (table) => [
  index("idx_relations_source").on(table.ownerId, table.sourceType, table.sourceId, table.deletedAt),
  index("idx_relations_target").on(table.ownerId, table.targetType, table.targetId, table.deletedAt),
]);

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), source: text("source").notNull(),
  contentType: text("content_type").notNull().default("text"), rawInput: text("raw_input").notNull(),
  metadata: text("metadata").notNull().default("{}"), capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_episodes_owner_captured").on(table.ownerId, table.capturedAt)]);

export const inboxItems = sqliteTable("inbox_items", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), kind: text("kind", { enum: ["task", "note"] }).notNull().default("note"),
  title: text("title").notNull(), body: text("body").notNull().default(""), processedAt: text("processed_at"), ...timestamps,
  source: text("source").notNull().default("manual"), contentType: text("content_type").notNull().default("text"), rawInput: text("raw_input"),
  telegramMessageId: text("telegram_message_id"), telegramChatId: text("telegram_chat_id"), episodeId: text("episode_id"), parsedJson: text("parsed_json"),
  status: text("status", { enum: ["pending", "awaiting_confirmation", "confirmed", "rejected", "failed"] }).notNull().default("pending"), errorMessage: text("error_message"),
}, (table) => [index("idx_inbox_owner_processed").on(table.ownerId, table.processedAt, table.deletedAt)]);

export const focusSessions = sqliteTable("focus_sessions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), taskId: text("task_id").references(() => tasks.id),
  startedAt: text("started_at").notNull(), endedAt: text("ended_at").notNull(), durationSeconds: integer("duration_seconds").notNull(),
}, (table) => [index("idx_focus_owner_started").on(table.ownerId, table.startedAt)]);

export const googleCalendarConnections = sqliteTable("google_calendar_connections", {
  ownerId: text("owner_id").primaryKey(), calendarId: text("calendar_id").notNull().default("primary"),
  calendarName: text("calendar_name").notNull().default("Lịch chính"), accessToken: text("access_token"),
  refreshToken: text("refresh_token"), tokenExpiresAt: text("token_expires_at"), scope: text("scope").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const googleCalendarSync = sqliteTable("google_calendar_sync", {
  ownerId: text("owner_id").notNull(), taskId: text("task_id").notNull(), googleEventId: text("google_event_id").notNull(),
  calendarId: text("calendar_id").notNull().default("primary"), lastSyncedAt: text("last_synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.ownerId, table.taskId] })]);
