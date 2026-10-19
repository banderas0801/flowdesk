import { getRawDb } from "../../../db";
import { validDay } from "../../../components/flowdesk/task-model";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureInboxSchema } from "../../lib/telegram-inbox";
import { addRelation, listRelations, migrateLegacyRelations, removeRelation, syncProjectMembership } from "../../lib/relations";
import { ensureGoogleCalendarSchema } from "../../lib/google-calendar";
import { ensureGraphitiSchema, recordEpisode } from "../../lib/graphiti";

type Entity = "project" | "task" | "note" | "inbox";
type Data = Record<string, unknown>;
const entityTable: Record<Entity, string> = { project: "projects", task: "tasks", note: "notes", inbox: "inbox_items" };

async function currentOwner() {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  return process.env.NODE_ENV !== "production" ? "local-preview" : null;
}
const uid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const clean = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const optional = (value: unknown) => clean(value) || null;
const encode = (value: unknown) => { try { return JSON.stringify(value ?? []); } catch { return "[]"; } };
async function syncTaskToGoogle(db: D1Database, owner: string, task: { id: string; title: string; description: string; dueAt: string | null; status: string }) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return;
  try {
    await ensureGoogleCalendarSchema(db);
    const connection = await db.prepare("SELECT owner_id, calendar_id, access_token, refresh_token, token_expires_at FROM google_calendar_connections WHERE owner_id = ? LIMIT 1").bind(owner).first<{ owner_id: string; calendar_id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null }>();
    if (!connection) return;
    let token = connection.access_token;
    if ((!token || !connection.token_expires_at || new Date(connection.token_expires_at).getTime() <= Date.now() + 60_000) && connection.refresh_token) {
      const refreshed = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: connection.refresh_token, grant_type: "refresh_token" }) });
      const tokens = await refreshed.json() as { access_token?: string; expires_in?: number };
      if (!refreshed.ok || !tokens.access_token) return;
      token = tokens.access_token;
      await db.prepare("UPDATE google_calendar_connections SET access_token = ?, token_expires_at = ?, updated_at = ? WHERE owner_id = ?").bind(token, new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), new Date().toISOString(), owner).run();
    }
    if (!token) return;
    const existing = await db.prepare("SELECT google_event_id FROM google_calendar_sync WHERE owner_id = ? AND task_id = ? LIMIT 1").bind(owner, task.id).first<{ google_event_id: string }>();
    if (task.status === "done" || !task.dueAt) {
      if (existing?.google_event_id && token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id || "primary")}/events/${encodeURIComponent(existing.google_event_id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      await db.prepare("DELETE FROM google_calendar_sync WHERE owner_id = ? AND task_id = ?").bind(owner, task.id).run();
      return;
    }
    const due = task.dueAt; const description = `${task.description || ""}\n\nFlowdesk task: ${task.id}`.trim();
    let event: Record<string, unknown>;
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) { const next = new Date(`${due}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); event = { summary: task.title, description, start: { date: due }, end: { date: next.toISOString().slice(0, 10) } }; }
    else { const start = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(due) ? due : `${due}+07:00`); event = { summary: task.title, description, start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3600000).toISOString() } }; }
    const calendarId = connection.calendar_id || "primary";
    const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${existing?.google_event_id ? `/${encodeURIComponent(existing.google_event_id)}` : ""}`;
    const response = await fetch(endpoint, { method: existing?.google_event_id ? "PUT" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
    const result = await response.json() as { id?: string };
    if (!response.ok || !result.id) return;
    await db.prepare("INSERT INTO google_calendar_sync (owner_id, task_id, google_event_id, calendar_id, last_synced_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, task_id) DO UPDATE SET google_event_id = excluded.google_event_id, calendar_id = excluded.calendar_id, last_synced_at = excluded.last_synced_at").bind(owner, task.id, result.id, calendarId, new Date().toISOString()).run();
  } catch (error) { console.error("google calendar auto-sync failed", error); }
}
async function syncWikiLinks(db: D1Database, owner: string, noteId: string, body: string) {
  const titles = [...body.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)].map((match) => clean(match[1]));
  if (!titles.length) return;
  const notes = await db.prepare("SELECT id, title FROM notes WHERE owner_id = ? AND deleted_at IS NULL").bind(owner).all<{ id: string; title: string }>();
  const byTitle = new Map(notes.results.map((note) => [note.title.trim().toLowerCase(), note.id]));
  const at = stamp();
  const links: D1PreparedStatement[] = [];
  for (const title of titles) {
    const targetId = byTitle.get(title.toLowerCase());
    if (!targetId || targetId === noteId) continue;
    const [sourceId, orderedTargetId] = [noteId, targetId].sort();
    links.push(db.prepare("INSERT OR IGNORE INTO note_links (owner_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, sourceId, orderedTargetId, at));
  }
  if (links.length) await db.batch(links);
}
async function backfillKnowledgeMap(db: D1Database, owner: string) {
  const at = stamp();
  await db.batch([
    db.prepare("UPDATE tasks SET project_id = 'project-content' WHERE owner_id = ? AND project_id IS NULL AND (lower(title) LIKE '%kịch bản%' OR lower(title) LIKE '%ý tưởng%')").bind(owner),
    db.prepare("UPDATE tasks SET project_id = 'project-microdrama' WHERE owner_id = ? AND project_id IS NULL AND lower(title) LIKE '%storyboard%'").bind(owner),
    db.prepare("UPDATE tasks SET project_id = 'project-prompts' WHERE owner_id = ? AND project_id IS NULL AND lower(title) LIKE '%prompt%'").bind(owner),
    db.prepare("UPDATE notes SET project_id = 'project-content' WHERE owner_id = ? AND project_id IS NULL AND lower(tag) IN ('video', 'nội dung')").bind(owner),
    db.prepare("UPDATE notes SET project_id = 'project-prompts' WHERE owner_id = ? AND project_id IS NULL AND lower(tag) = 'hệ thống'").bind(owner),
    db.prepare("UPDATE notes SET project_id = 'project-microdrama' WHERE owner_id = ? AND project_id IS NULL AND lower(tag) IN ('thử nghiệm', 'sản xuất')").bind(owner),
    db.prepare("INSERT OR IGNORE INTO task_note_links (owner_id, task_id, note_id, created_at) SELECT ?, 'task-script', 'note-decision', ? WHERE EXISTS (SELECT 1 FROM tasks WHERE owner_id = ? AND id = 'task-script') AND EXISTS (SELECT 1 FROM notes WHERE owner_id = ? AND id = 'note-decision')").bind(owner, at, owner, owner),
    db.prepare("INSERT OR IGNORE INTO task_note_links (owner_id, task_id, note_id, created_at) SELECT ?, 'task-storyboard', 'note-pov', ? WHERE EXISTS (SELECT 1 FROM tasks WHERE owner_id = ? AND id = 'task-storyboard') AND EXISTS (SELECT 1 FROM notes WHERE owner_id = ? AND id = 'note-pov')").bind(owner, at, owner, owner),
  ]);
}
const legacyProjectId = (value: unknown) => {
  const label = clean(value).toLowerCase();
  if (label.includes("sản xuất")) return "project-microdrama";
  if (label.includes("hệ thống") || label.includes("prompt")) return "project-prompts";
  if (label.includes("nội dung") || label.includes("ý tưởng") || label.includes("video")) return "project-content";
  return null;
};

async function readAll(db: D1Database, owner: string) {
  const relationRows = await listRelations(db, owner);
  const queries = [
    "SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at",
    "SELECT * FROM tasks WHERE owner_id = ? ORDER BY status, position, created_at DESC",
    "SELECT * FROM notes WHERE owner_id = ? ORDER BY updated_at DESC",
    "SELECT * FROM note_links WHERE owner_id = ?",
    "SELECT * FROM task_note_links WHERE owner_id = ?",
    "SELECT id, source, content_type, raw_input, captured_at, processed_at FROM episodes WHERE owner_id = ? ORDER BY captured_at DESC LIMIT 30",
    "SELECT * FROM inbox_items WHERE owner_id = ? ORDER BY created_at DESC",
    "SELECT * FROM focus_sessions WHERE owner_id = ? ORDER BY started_at DESC LIMIT 100",
    "SELECT * FROM task_history WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500",
  ];
  const results = await Promise.all(queries.map((query) => db.prepare(query).bind(owner).all()));
  return { projects: results[0].results, tasks: results[1].results, notes: results[2].results, noteLinks: results[3].results, taskNoteLinks: results[4].results, relations: relationRows.results, episodes: results[5].results, inbox: results[6].results, focusSessions: results[7].results, taskHistory: results[8].results };
}

const defaults = {
  projects: [
    ["project-microdrama", "Sản xuất Micro-drama", "Sản xuất", "coral", "Hoàn thiện tập thử nghiệm có thể xuất bản"],
    ["project-prompts", "Thư viện Prompt", "Hệ thống", "blue", "Chuẩn hóa prompt nhân vật và ánh sáng"],
    ["project-content", "Kênh nội dung 14 ngày", "Nội dung", "lime", "Duy trì nhịp xuất bản trong 14 ngày"],
  ],
  tasks: [
    ["task-script", "Hoàn thiện kịch bản video tuần này", "project-content", "Cao", "doing"],
    ["task-ideas", "Chọn 3 ý tưởng để thử nghiệm", "project-content", "Vừa", "todo"],
    ["task-storyboard", "Rà soát storyboard cảnh mở đầu", "project-microdrama", "Vừa", "todo"],
    ["task-prompts", "Cập nhật kho prompt nhân vật", "project-prompts", "Thấp", "done"],
  ],
  notes: [
    ["note-decision", "Series: một quyết định thay đổi tất cả", "Mỗi tập mở bằng khoảnh khắc nhân vật đứng trước hai lựa chọn trái ngược.", "Video", "coral", "project-content"],
    ["note-light", "Thư viện ánh sáng theo cảm xúc", "Lưu từng setup ánh sáng kèm ảnh tham chiếu và prompt có hiệu quả.", "Hệ thống", "blue", "project-prompts"],
    ["note-pov", "Cảnh quay POV ngoài đời", "Thử camera điện thoại, hành động bắt đầu giữa chừng, ít dàn dựng.", "Thử nghiệm", "lime", "project-microdrama"],
  ],
};

async function bootstrap(db: D1Database, owner: string, payload: Data = {}) {
  const count = await db.prepare("SELECT (SELECT COUNT(*) FROM projects WHERE owner_id = ?) + (SELECT COUNT(*) FROM tasks WHERE owner_id = ?) + (SELECT COUNT(*) FROM notes WHERE owner_id = ?) AS total").bind(owner, owner, owner).first<{ total: number }>();
  if ((count?.total ?? 0) > 0) { await backfillKnowledgeMap(db, owner); return; }
  const at = stamp();
  const legacyTasks = Array.isArray(payload.tasks) ? payload.tasks as Data[] : [];
  const legacyNotes = Array.isArray(payload.notes) ? payload.notes as Data[] : [];
  const tasks = legacyTasks.length ? legacyTasks.map((task) => [uid(), clean(task.title, "Công việc mới"), legacyProjectId(task.project), clean(task.priority, "Vừa"), clean(task.status, "todo")]) : defaults.tasks;
  const notes = legacyNotes.length ? legacyNotes.map((note) => [uid(), clean(note.title, "Ý tưởng mới"), clean(note.note ?? note.body), clean(note.tag, "Ý tưởng"), clean(note.color, "blue"), legacyProjectId(note.project ?? note.tag)]) : defaults.notes;
  const statements = [
    ...defaults.projects.map((p) => db.prepare("INSERT INTO projects (id, owner_id, name, area, color, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(p[0], owner, p[1], p[2], p[3], p[4], at, at)),
    ...tasks.map((task, i) => db.prepare("INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, position, checklist, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?, ?, '[]', ?, ?)").bind(task[0], owner, task[2], task[1], task[4], task[3], i, at, at)),
    ...notes.map((note) => db.prepare("INSERT INTO notes (id, owner_id, project_id, title, body, tag, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(note[0], owner, note[5], note[1], note[2], note[3], note[4], at, at)),
  ];
  await db.batch(statements);
  if (!legacyNotes.length) await db.batch([
    db.prepare("INSERT INTO note_links (owner_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, "note-decision", "note-pov", at),
    db.prepare("INSERT INTO task_note_links (owner_id, task_id, note_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, "task-script", "note-decision", at),
    db.prepare("INSERT INTO task_note_links (owner_id, task_id, note_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, "task-storyboard", "note-pov", at),
  ]);
  else {
    const relationKeys = new Set<string>();
    const relations: D1PreparedStatement[] = [];
    legacyNotes.forEach((source, sourceIndex) => {
      const sourceId = String(notes[sourceIndex][0]);
      const linkTitles = Array.isArray(source.links) ? source.links.map((value) => clean(value)) : [];
      for (const title of linkTitles) {
        const noteIndex = legacyNotes.findIndex((candidate) => clean(candidate.title) === title);
        if (noteIndex >= 0 && noteIndex !== sourceIndex) {
          const [a, b] = [sourceId, String(notes[noteIndex][0])].sort(), key = `note:${a}:${b}`;
          if (!relationKeys.has(key)) { relationKeys.add(key); relations.push(db.prepare("INSERT OR IGNORE INTO note_links (owner_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, a, b, at)); }
        }
        const taskIndex = legacyTasks.findIndex((candidate) => clean(candidate.title) === title || clean(candidate.title).includes(title) || title.includes(clean(candidate.title)));
        if (taskIndex >= 0) {
          const taskId = String(tasks[taskIndex][0]), key = `task:${taskId}:${sourceId}`;
          if (!relationKeys.has(key)) { relationKeys.add(key); relations.push(db.prepare("INSERT OR IGNORE INTO task_note_links (owner_id, task_id, note_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, taskId, sourceId, at)); }
        }
      }
    });
    if (relations.length) await db.batch(relations);
  }
}

export async function GET() {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Bạn cần đăng nhập để mở không gian làm việc." }, { status: 401 });
  try { const db = getRawDb(); await ensureInboxSchema(db); await ensureGraphitiSchema(db); return Response.json(await readAll(db, owner)); }
  catch (error) { console.error("workspace read failed", error); return Response.json({ error: "Không thể tải dữ liệu lúc này." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Bạn cần đăng nhập để thay đổi dữ liệu." }, { status: 401 });
  try {
    const body = await request.json() as { action?: string; entity?: Entity; id?: string; payload?: Data };
    const db = getRawDb(), at = stamp(), p = body.payload || {};
    await ensureInboxSchema(db);
      await ensureGraphitiSchema(db);
    await migrateLegacyRelations(db, owner);
    if (body.action === "updateTask" && body.id) {
      const previous = await db.prepare("SELECT * FROM tasks WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(body.id, owner).first<Record<string, unknown>>();
      if (!previous) return Response.json({ error: "Không tìm thấy công việc." }, { status: 404 });
      const fields: Record<string,string> = { title:"title", priority:"priority", status:"status", projectId:"project_id", plannedDate:"planned_date", dueAt:"due_at" };
      const entries = Object.entries(p);
      if (!entries.length || entries.some(([key]) => !fields[key])) return Response.json({ error: "Thuộc tính công việc không hợp lệ." }, { status: 400 });
      if ("title" in p && !clean(p.title)) return Response.json({ error: "Tên công việc không được để trống." }, { status: 400 });
      if ("status" in p && !["todo","doing","done"].includes(String(p.status))) return Response.json({ error: "Trạng thái không hợp lệ." }, { status: 400 });
      if ("priority" in p && !["Cao","Vừa","Thấp"].includes(String(p.priority))) return Response.json({ error: "Ưu tiên không hợp lệ." }, { status: 400 });
      if (p.plannedDate && (typeof p.plannedDate !== "string" || !validDay(p.plannedDate))) return Response.json({ error: "Ngày dự kiến không hợp lệ." }, { status: 400 });
      if (p.dueAt && (typeof p.dueAt !== "string" || !validDay(p.dueAt.slice(0,10)) || !Number.isFinite(Date.parse(p.dueAt)))) return Response.json({ error: "Hạn hoàn thành không hợp lệ." }, { status: 400 });
      if (p.projectId) {
        const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(p.projectId,owner).first();
        if (!project) return Response.json({ error: "Dự án không tồn tại trong không gian của anh." }, { status: 400 });
      }
      const values = entries.map(([key,value]) => ["plannedDate","dueAt","projectId"].includes(key) ? optional(value) : clean(value));
      const guard = p.status === "doing" ? " AND (status = 'doing' OR (SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND status = 'doing' AND deleted_at IS NULL) < 3)" : "";
      const bind = [...values,at,body.id,owner,...(p.status === "doing" ? [owner] : [])];
      const saved = await db.prepare(`UPDATE tasks SET ${entries.map(([key]) => fields[key]+" = ?").join(", ")}, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL${guard}`).bind(...bind).run();
      if (!saved.meta.changes) return Response.json({ error: "Đang đủ 3 việc. Hoàn thành hoặc tạm dừng một việc trước." }, { status: 409 });
      const next = { ...previous, ...Object.fromEntries(entries.map(([key],i) => [fields[key],values[i]])) };
      if ("projectId" in p) await syncProjectMembership(db,owner,body.id,"task",next.project_id as string | null);
      if ("dueAt" in p || "status" in p || "title" in p) await syncTaskToGoogle(db,owner,{id:body.id,title:String(next.title),description:String(next.description||""),dueAt:next.due_at as string|null,status:String(next.status)});
      return Response.json(await readAll(db,owner));
    }
    if (body.action === "bootstrap") await bootstrap(db, owner, p);
    else if (body.action === "upsert" && body.entity === "project") {
      await db.prepare("INSERT INTO projects (id, owner_id, name, area, color, goal, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, area=excluded.area, color=excluded.color, goal=excluded.goal, due_date=excluded.due_date, updated_at=excluded.updated_at WHERE owner_id=excluded.owner_id").bind(body.id || uid(), owner, clean(p.name, "Dự án mới"), clean(p.area, "Cá nhân"), clean(p.color, "blue"), clean(p.goal), optional(p.dueDate), at, at).run();
    } else if (body.action === "upsert" && body.entity === "task") {
      const taskId = body.id || uid();
      const previous = await db.prepare("SELECT status, planned_date, completed_at FROM tasks WHERE id = ? AND owner_id = ?").bind(taskId, owner).first<{ status: string; planned_date: string | null; completed_at: string | null }>();
      const planned = Object.hasOwn(p, "plannedDate") ? optional(p.plannedDate) : previous?.planned_date || null;
      const status = clean(p.status, "todo");
      if (!["todo", "doing", "done"].includes(status) || (planned && !validDay(planned))) return Response.json({ error: "Trạng thái hoặc ngày dự kiến không hợp lệ." }, { status: 400 });
      const completedAt = status === "done" ? previous?.completed_at || (previous?.status !== "done" ? at : null) : null;
      const episodeId = await recordEpisode(db, owner, { source: "web", contentType: "text", rawInput: JSON.stringify({ title: p.title, description: p.description, dueAt: p.dueAt, status: p.status }), metadata: { entity: "task", entityId: taskId } });
      const taskSave = await db.prepare("INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, due_at, position, checklist, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (? <> 'doing' OR (SELECT COUNT(*) FROM tasks WHERE owner_id = ? AND status = 'doing' AND deleted_at IS NULL) < 3 OR EXISTS (SELECT 1 FROM tasks WHERE id = ? AND owner_id = ? AND status = 'doing')) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title, description=excluded.description, status=excluded.status, priority=excluded.priority, due_at=excluded.due_at, position=excluded.position, checklist=excluded.checklist, updated_at=excluded.updated_at WHERE owner_id=excluded.owner_id").bind(taskId, owner, optional(p.projectId), clean(p.title, "Công việc mới"), clean(p.description), clean(p.status, "todo"), clean(p.priority, "Vừa"), optional(p.dueAt), Number(p.position || 0), encode(p.checklist), at, at, status, owner, taskId, owner).run();
      if (!taskSave.meta.changes) return Response.json({ error: "Đang đủ 3 việc. Hoàn thành hoặc tạm dừng một việc trước." }, { status: 409 });
      const changes = [db.prepare("UPDATE tasks SET planned_date = ?, completed_at = ? WHERE id = ? AND owner_id = ?").bind(planned, completedAt, taskId, owner)];
      await db.batch(changes);
      await syncProjectMembership(db, owner, taskId, "task", optional(p.projectId));
      await db.prepare("UPDATE relations SET source_episode_id = ?, confidence = ?, valid_from = COALESCE(valid_from, ?), status = 'active' WHERE owner_id = ? AND target_id = ? AND target_type = 'task' AND deleted_at IS NULL").bind(episodeId, 1, at, owner, taskId).run();
      await syncTaskToGoogle(db, owner, { id: taskId, title: clean(p.title, "Công việc mới"), description: clean(p.description), dueAt: optional(p.dueAt), status: clean(p.status, "todo") });
    } else if (body.action === "upsert" && body.entity === "note") {
      const noteId = body.id || uid();
      const noteBody = clean(p.body);
      const episodeId = await recordEpisode(db, owner, { source: "web", contentType: "text", rawInput: JSON.stringify({ title: p.title, body: noteBody, tag: p.tag }), metadata: { entity: "note", entityId: noteId } });
      await db.prepare("INSERT INTO notes (id, owner_id, project_id, title, body, tag, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=excluded.title, body=excluded.body, tag=excluded.tag, color=excluded.color, updated_at=excluded.updated_at WHERE owner_id=excluded.owner_id").bind(noteId, owner, optional(p.projectId), clean(p.title, "Ý tưởng mới"), noteBody, clean(p.tag, "Ý tưởng"), clean(p.color, "blue"), at, at).run();
      await syncProjectMembership(db, owner, noteId, "note", optional(p.projectId));
      await db.prepare("UPDATE relations SET source_episode_id = ?, confidence = ?, valid_from = COALESCE(valid_from, ?), status = 'active' WHERE owner_id = ? AND target_id = ? AND target_type = 'note' AND deleted_at IS NULL").bind(episodeId, 1, at, owner, noteId).run();
      await syncWikiLinks(db, owner, noteId, noteBody);
    } else if (body.action === "upsert" && body.entity === "inbox") {
      await db.prepare("INSERT INTO inbox_items (id, owner_id, kind, title, body, processed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, body=excluded.body, processed_at=excluded.processed_at, updated_at=excluded.updated_at WHERE owner_id=excluded.owner_id").bind(body.id || uid(), owner, clean(p.kind, "note"), clean(p.title, "Mục mới"), clean(p.body), optional(p.processedAt), at, at).run();
    } else if (body.action === "rejectInbox" && body.id) {
      await db.prepare("UPDATE inbox_items SET status = 'rejected', processed_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind(at, at, body.id, owner).run();
    } else if ((body.action === "trash" || body.action === "restore") && body.entity && body.id) {
      await db.prepare(`UPDATE ${entityTable[body.entity]} SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(body.action === "trash" ? at : null, at, body.id, owner).run();
    } else if (body.action === "purge" && body.entity && body.id) {
      if (body.entity === "task") await db.batch([
        db.prepare("DELETE FROM task_note_links WHERE task_id = ? AND owner_id = ?").bind(body.id, owner),
        db.prepare("DELETE FROM focus_sessions WHERE task_id = ? AND owner_id = ?").bind(body.id, owner),
      ]);
      if (body.entity === "note") await db.batch([
        db.prepare("DELETE FROM note_links WHERE owner_id = ? AND (source_id = ? OR target_id = ?)").bind(owner, body.id, body.id),
        db.prepare("DELETE FROM task_note_links WHERE note_id = ? AND owner_id = ?").bind(body.id, owner),
      ]);
      if (body.entity === "project") await db.batch([
        db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ? AND owner_id = ?").bind(body.id, owner),
        db.prepare("UPDATE notes SET project_id = NULL WHERE project_id = ? AND owner_id = ?").bind(body.id, owner),
      ]);
      await db.prepare("DELETE FROM relations WHERE owner_id = ? AND (source_id = ? OR target_id = ?)").bind(owner, body.id, body.id).run();
      await db.prepare(`DELETE FROM ${entityTable[body.entity]} WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL`).bind(body.id, owner).run();
    } else if ((body.action === "linkNotes" || body.action === "unlinkNotes") && p.sourceId && p.targetId) {
      const [a, b] = [clean(p.sourceId), clean(p.targetId)].sort();
      if (a === b) return Response.json({ error: "Không thể tự liên kết một ghi chú." }, { status: 400 });
      if (body.action === "linkNotes") {
        await db.prepare("INSERT OR IGNORE INTO note_links (owner_id, source_id, target_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, a, b, at).run();
        await addRelation(db, owner, a, "note", b, "note", "relates_to");
      } else {
        await db.prepare("DELETE FROM note_links WHERE owner_id = ? AND source_id = ? AND target_id = ?").bind(owner, a, b).run();
        await removeRelation(db, owner, a, "note", b, "note", "relates_to");
      }
    } else if (body.action === "linkTaskNote") {
      const taskId = clean(p.taskId), noteId = clean(p.noteId);
      await db.prepare("INSERT OR IGNORE INTO task_note_links (owner_id, task_id, note_id, created_at) VALUES (?, ?, ?, ?)").bind(owner, taskId, noteId, at).run();
      await addRelation(db, owner, taskId, "task", noteId, "note", "references");
    }
    else if (body.action === "logFocus") await db.prepare("INSERT INTO focus_sessions (id, owner_id, task_id, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)").bind(uid(), owner, optional(p.taskId), clean(p.startedAt, at), clean(p.endedAt, at), Number(p.durationSeconds || 0)).run();
    else return Response.json({ error: "Thao tác không được hỗ trợ." }, { status: 400 });
    return Response.json(await readAll(db, owner));
  } catch (error) {
    console.error("workspace write failed", error);
    return Response.json({ error: "Không thể lưu thay đổi. Hãy thử lại." }, { status: 503 });
  }
}
