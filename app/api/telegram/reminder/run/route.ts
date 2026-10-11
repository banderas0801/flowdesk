import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";

async function ownerId(db: D1Database) {
  const user = await getChatGPTUser();
  if (user?.userId) return user.userId;
  const configured = process.env.FLOWDESK_OWNER_ID || process.env.TELEGRAM_OWNER_ID;
  if (configured?.trim()) return configured.trim();
  return (await db.prepare("SELECT owner_id FROM projects WHERE deleted_at IS NULL GROUP BY owner_id ORDER BY MIN(created_at) LIMIT 1").first<{ owner_id: string }>())?.owner_id || null;
}

export async function POST(request: Request) {
  const cronSecret = process.env.FLOWDESK_CRON_SECRET?.trim();
  const suppliedSecret = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || new URL(request.url).searchParams.get("secret")?.trim();
  const isCron = Boolean(cronSecret && suppliedSecret && suppliedSecret === cronSecret);
  const db = env.DB;
  if (!db) return Response.json({ ok: false, error: "D1 chưa sẵn sàng." }, { status: 503 });
  const owner = await ownerId(db);
  if (!owner) return Response.json({ ok: false, error: "Chưa xác định được owner Flowdesk." }, { status: 401 });
  if (!isCron && !await getChatGPTUser()) return Response.json({ ok: false, error: "Bạn cần đăng nhập hoặc cung cấp cron secret." }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Response.json({ ok: false, error: "Cần cấu hình TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID trong Site Secrets." }, { status: 503 });
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS telegram_reminder_log (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, task_id TEXT NOT NULL, reminder_key TEXT NOT NULL, sent_at TEXT NOT NULL, UNIQUE(owner_id, task_id, reminder_key))").run();
    const tasks = await db.prepare("SELECT id, title, priority, due_at FROM tasks WHERE owner_id = ? AND deleted_at IS NULL AND status != 'done' AND due_at IS NOT NULL AND due_at <= datetime('now', '+1 day') ORDER BY due_at ASC LIMIT 30").bind(owner).all<{ id: string; title: string; priority: string; due_at: string }>();
    const day = new Date().toISOString().slice(0, 10);
    const pending = [];
    for (const task of tasks.results) {
      const exists = await db.prepare("SELECT 1 FROM telegram_reminder_log WHERE owner_id = ? AND task_id = ? AND reminder_key = ? LIMIT 1").bind(owner, task.id, day).first();
      if (!exists) pending.push(task);
    }
    if (!pending.length) return Response.json({ ok: true, sent: 0, skipped: tasks.results.length });
    const lines = pending.map((task, index) => `${index + 1}. ${task.title}${task.priority === "Cao" ? " · Ưu tiên cao" : ""} · ${new Date(task.due_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}`);
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: `Nhắc việc hôm nay\n\n${lines.join("\n")}\n\nKhi hoàn thành, gửi “Đã xong: tên việc”.` }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || !result.ok) return Response.json({ ok: false, error: result.description || "Telegram không nhận được lời nhắc." }, { status: 502 });
    const at = new Date().toISOString();
    await db.batch(pending.map((task) => db.prepare("INSERT OR IGNORE INTO telegram_reminder_log (id, owner_id, task_id, reminder_key, sent_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), owner, task.id, day, at)));
    return Response.json({ ok: true, sent: pending.length, skipped: tasks.results.length - pending.length });
  } catch (error) { console.error("telegram reminder failed", error); return Response.json({ ok: false, error: "Không thể chạy nhắc việc phía máy chủ." }, { status: 503 }); }
}
