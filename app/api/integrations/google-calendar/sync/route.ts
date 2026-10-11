import { getRawDb } from "../../../../../db";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { ensureGoogleCalendarSchema } from "../../../../lib/google-calendar";

type Connection = { owner_id: string; calendar_id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null };
type TaskRow = { id: string; title: string; description: string; due_at: string | null; status: string };

async function ownerId() { const user = await getChatGPTUser(); return user?.userId || process.env.FLOWDESK_OWNER_ID || process.env.TELEGRAM_OWNER_ID || null; }
async function accessToken(db: D1Database, connection: Connection) {
  if (connection.access_token && connection.token_expires_at && new Date(connection.token_expires_at).getTime() > Date.now() + 60_000) return connection.access_token;
  if (!connection.refresh_token || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return connection.access_token;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: connection.refresh_token, grant_type: "refresh_token" }) });
  const tokens = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !tokens.access_token) throw new Error("Google không làm mới được quyền truy cập.");
  await db.prepare("UPDATE google_calendar_connections SET access_token = ?, token_expires_at = ?, updated_at = ? WHERE owner_id = ?").bind(tokens.access_token, new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), new Date().toISOString(), connection.owner_id).run();
  return tokens.access_token;
}
function eventBody(task: TaskRow) {
  const due = task.due_at || ""; const description = `${task.description || ""}\n\nFlowdesk task: ${task.id}`.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) { const next = new Date(`${due}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return { summary: task.title, description, start: { date: due }, end: { date: next.toISOString().slice(0, 10) } }; }
  const zonedDue = /(?:Z|[+-]\d{2}:?\d{2})$/.test(due) ? due : `${due}+07:00`;
  const start = new Date(zonedDue); const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { summary: task.title, description, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
}
export async function POST() {
  try {
    const owner = await ownerId(); if (!owner) return Response.json({ ok: false, error: "Chưa xác định được tài khoản Flowdesk." }, { status: 401 });
    const db = getRawDb(); await ensureGoogleCalendarSchema(db);
    const connection = await db.prepare("SELECT owner_id, calendar_id, access_token, refresh_token, token_expires_at FROM google_calendar_connections WHERE owner_id = ? LIMIT 1").bind(owner).first<Connection>();
    if (!connection) return Response.json({ ok: false, error: "Chưa kết nối Google Calendar." }, { status: 409 });
    const token = await accessToken(db, connection); if (!token) return Response.json({ ok: false, error: "Kết nối Google Calendar đã hết hạn. Hãy kết nối lại." }, { status: 401 });
    const tasks = await db.prepare("SELECT id, title, description, due_at, status FROM tasks WHERE owner_id = ? AND deleted_at IS NULL AND due_at IS NOT NULL ORDER BY due_at").bind(owner).all<TaskRow>();
    const calendarId = connection.calendar_id || "primary"; let created = 0; let updated = 0; let skipped = 0;
    for (const task of tasks.results) {
      if (task.status === "done") { skipped += 1; continue; }
      const existing = await db.prepare("SELECT google_event_id FROM google_calendar_sync WHERE owner_id = ? AND task_id = ? LIMIT 1").bind(owner, task.id).first<{ google_event_id: string }>();
      const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${existing?.google_event_id ? `/${encodeURIComponent(existing.google_event_id)}` : ""}`;
      const response = await fetch(endpoint, { method: existing?.google_event_id ? "PUT" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(eventBody(task)) });
      const result = await response.json() as { id?: string; error?: { message?: string } };
      if (!response.ok || !result.id) throw new Error(result.error?.message || `Không đồng bộ được task ${task.title}.`);
      const now = new Date().toISOString();
      await db.prepare("INSERT INTO google_calendar_sync (owner_id, task_id, google_event_id, calendar_id, last_synced_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, task_id) DO UPDATE SET google_event_id = excluded.google_event_id, calendar_id = excluded.calendar_id, last_synced_at = excluded.last_synced_at").bind(owner, task.id, result.id, calendarId, now).run();
      if (existing?.google_event_id) updated += 1; else created += 1;
    }
    return Response.json({ ok: true, created, updated, skipped, total: tasks.results.length });
  } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Không thể đồng bộ Google Calendar." }, { status: 502 }); }
}
