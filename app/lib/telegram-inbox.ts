import { telegramIntentReply } from "./telegram-intents";
import { callGemini } from "./gemini";
import { completeEpisode, ensureGraphitiSchema, recordEpisode } from "./graphiti";

type ParsedInput = {
  kind: "task" | "note" | "chat";
  title: string;
  body: string;
  dueAt: string | null;
  priority: "Cao" | "Vừa" | "Thấp";
  projectName: string | null;
  checklist: string[];
  confidence: number;
  reply?: string;
};

type InboxRow = {
  id: string;
  owner_id: string;
  kind: "task" | "note";
  title: string;
  body: string;
  raw_input: string | null;
  parsed_json: string | null;
  status: string | null;
  telegram_chat_id: string | null;
  processed_at: string | null;
};

const now = () => new Date().toISOString();
const clean = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const uid = () => crypto.randomUUID();

/** Additive migration for the already deployed D1 database. */
export async function ensureInboxSchema(db: D1Database) {
  const result = await db.prepare("PRAGMA table_info(inbox_items)").all<{ name: string }>();
  const columns = new Set(result.results.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["source", "TEXT NOT NULL DEFAULT 'manual'"],
    ["content_type", "TEXT NOT NULL DEFAULT 'text'"],
    ["raw_input", "TEXT"],
    ["telegram_message_id", "TEXT"],
    ["telegram_chat_id", "TEXT"],
    ["parsed_json", "TEXT"],
    ["status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["error_message", "TEXT"],
    ["episode_id", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) await db.prepare(`ALTER TABLE inbox_items ADD COLUMN ${name} ${definition}`).run();
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_telegram_update ON inbox_items(owner_id, telegram_message_id) WHERE telegram_message_id IS NOT NULL").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_inbox_telegram_pending ON inbox_items(owner_id, telegram_chat_id, status, created_at)").run();
}

async function resolveOwner(db: D1Database) {
  const configured = process.env.FLOWDESK_OWNER_ID || process.env.TELEGRAM_OWNER_ID;
  if (configured?.trim()) return configured.trim();
  const row = await db.prepare("SELECT owner_id FROM projects WHERE deleted_at IS NULL GROUP BY owner_id ORDER BY MIN(created_at) LIMIT 1").first<{ owner_id: string }>();
  return row?.owner_id || null;
}

function parseJson(raw: string) {
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(fenced) as Record<string, unknown>; } catch { return null; }
}

function normalizeParsed(value: Record<string, unknown>, input: string): ParsedInput {
  const kind = value.kind === "task" ? "task" : value.kind === "chat" ? "chat" : "note";
  const priority = value.priority === "Cao" || value.priority === "Thấp" ? value.priority : "Vừa";
  const dueAt = typeof value.dueAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.dueAt) ? value.dueAt.slice(0, 16) : null;
  const checklist = Array.isArray(value.checklist) ? value.checklist.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  return {
    kind,
    title: clean(value.title, input.slice(0, 100)),
    body: clean(value.body, input),
    dueAt,
    priority,
    projectName: typeof value.projectName === "string" ? value.projectName.trim() || null : null,
    checklist,
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : 0.7,
    reply: typeof value.reply === "string" ? value.reply.trim() : undefined,
  };
}

async function parseWithOpenRouter(input: string, suppliedKey?: string, media?: { data: string; mimeType: string }): Promise<{ parsed: ParsedInput | null; error?: string }> {
  const key = suppliedKey?.trim() || process.env.OPENROUTER_API_KEY;
  if (!key) return { parsed: null, error: "Chưa cấu hình OPENROUTER_API_KEY." };
  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = media ? (process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.5-flash") : (process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash-0731");
  const userContent = media ? [{ type: "text", text: input }, { type: "image_url", image_url: { url: media.data } }] : `Ngày hiện tại: ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })}. Đầu vào: ${input}`;
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://idea-workbench.kh-ng-gian-l-0906.chatgpt.site", "X-Title": "Flowdesk Telegram Inbox" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: "Bạn là trợ lý Flowdesk. Trả về đúng một JSON, không markdown. Schema: {kind:'task'|'note'|'chat',title:string,body:string,dueAt:string|null,priority:'Cao'|'Vừa'|'Thấp',projectName:string|null,checklist:string[],confidence:number,reply?:string}. Câu xã giao, câu hỏi kiểm tra bot, hỏi đáp chung hoặc yêu cầu xem dữ liệu là chat: trả lời ngắn trong reply và không tạo task/note. Tin có hành động cụ thể là task; kiến thức/ý tưởng lâu dài là note. dueAt dùng giờ Việt Nam Asia/Ho_Chi_Minh, định dạng YYYY-MM-DDTHH:mm; nếu không xác định thì null." },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!response.ok) return { parsed: null, error: result.error?.message || `OpenRouter trả về HTTP ${response.status}.` };
  const content = result.choices?.[0]?.message?.content;
  const json = content ? parseJson(content) : null;
  return json ? { parsed: normalizeParsed(json, input) } : { parsed: null, error: "LLM không trả về JSON hợp lệ." };
}

async function parseWithGemini(input: string, suppliedKey?: string, media?: { data: string; mimeType: string }): Promise<{ parsed: ParsedInput | null; error?: string }> {
  const key = suppliedKey?.trim() || process.env.GEMINI_API_KEY;
  if (!key) return { parsed: null, error: "Chưa cấu hình GEMINI_API_KEY cho nội dung đa phương thức." };
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const content = await callGemini({ apiKey: key, model, media, prompt: `Ngày hiện tại: ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })}. ${input}\n\nBạn là trợ lý Flowdesk. Trả về đúng một JSON, không markdown. Schema: {kind:'task'|'note'|'chat',title:string,body:string,dueAt:string|null,priority:'Cao'|'Vừa'|'Thấp',projectName:string|null,checklist:string[],confidence:number,reply?:string}. Câu xã giao hoặc hỏi đáp là chat và chỉ trả lời trong reply, không tạo Inbox. Tin có hành động cụ thể là task; kiến thức lâu dài là note.` });
    const json = parseJson(content);
    return json ? { parsed: normalizeParsed(json, input) } : { parsed: null, error: "Gemini không trả về JSON hợp lệ." };
  } catch (error) { return { parsed: null, error: error instanceof Error ? error.message : "Không thể gọi Gemini." }; }
}

function preview(parsed: ParsedInput) {
  const type = parsed.kind === "task" ? "Tạo công việc" : "Lưu ghi chú";
  const due = parsed.dueAt ? `\nHạn: ${parsed.dueAt.replace("T", " ")}` : "";
  const project = parsed.projectName ? `\nDự án: ${parsed.projectName}` : "";
  return `${type}: ${parsed.title}\nƯu tiên: ${parsed.priority}${due}${project}\n\nTrả lời /confirm để lưu hoặc /reject để bỏ.`;
}

async function latestPending(db: D1Database, owner: string, chatId: number) {
  return db.prepare("SELECT id, owner_id, kind, title, body, raw_input, parsed_json, status, telegram_chat_id, processed_at FROM inbox_items WHERE owner_id = ? AND telegram_chat_id = ? AND status = 'awaiting_confirmation' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(owner, String(chatId)).first<InboxRow>();
}

async function confirm(db: D1Database, owner: string, chatId: number) {
  const item = await latestPending(db, owner, chatId);
  if (!item?.parsed_json) return "Mình không tìm thấy bản nháp nào đang chờ xác nhận.";
  const parsed = normalizeParsed(JSON.parse(item.parsed_json) as Record<string, unknown>, item.raw_input || item.body);
  const at = now();
  let projectId: string | null = null;
  if (parsed.projectName) projectId = (await db.prepare("SELECT id FROM projects WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) LIMIT 1").bind(owner, parsed.projectName).first<{ id: string }>())?.id || null;
  const create = parsed.kind === "task"
    ? db.prepare("INSERT INTO tasks (id, owner_id, project_id, title, description, status, priority, due_at, position, checklist, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, 0, ?, ?, ?)").bind(uid(), owner, projectId, parsed.title, parsed.body, parsed.priority, parsed.dueAt, JSON.stringify(parsed.checklist), at, at)
    : db.prepare("INSERT INTO notes (id, owner_id, project_id, title, body, tag, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Inbox', 'blue', ?, ?)").bind(uid(), owner, projectId, parsed.title, parsed.body, at, at);
  const result = await db.batch([
    db.prepare("UPDATE inbox_items SET status = 'confirmed', processed_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'awaiting_confirmation'").bind(at, at, item.id, owner),
    create,
  ]);
  if (!result[0]?.meta?.changes) return "Bản nháp này đã được xử lý trước đó.";
  return `Đã lưu ${parsed.kind === "task" ? "công việc" : "ghi chú"}: ${parsed.title}`;
}

async function reject(db: D1Database, owner: string, chatId: number) {
  const item = await latestPending(db, owner, chatId);
  if (!item) return "Không có bản nháp nào đang chờ để bỏ.";
  await db.prepare("UPDATE inbox_items SET status = 'rejected', processed_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind(now(), now(), item.id, owner).run();
  return "Đã bỏ bản nháp.";
}

export async function processTelegramText(db: D1Database, chatId: number, text: string, options: { suppliedKey?: string; geminiKey?: string; messageId?: number; contentType?: string; rawInput?: string; media?: { data: string; mimeType: string } } = {}) {
  await ensureInboxSchema(db);
  await ensureGraphitiSchema(db);
  const normalized = text.trim();
  const owner = await resolveOwner(db);
  if (!owner) return "Chưa xác định được chủ sở hữu Flowdesk để lưu Inbox.";
  if (normalized === "/confirm" || normalized.toLowerCase() === "confirm") return confirm(db, owner, chatId);
  if (["/reject", "/cancel", "reject", "hủy", "huỷ"].includes(normalized.toLowerCase())) return reject(db, owner, chatId);
  const deterministic = telegramIntentReply(normalized);
  if (deterministic) return deterministic;
  if (typeof options.messageId === "number") {
    const duplicate = await db.prepare("SELECT id, status FROM inbox_items WHERE owner_id = ? AND telegram_message_id = ? LIMIT 1").bind(owner, String(options.messageId)).first<{ id: string; status: string }>();
    if (duplicate) return duplicate.status === "awaiting_confirmation" ? "Tin này đã có bản nháp đang chờ /confirm." : "Tin nhắn này đã được xử lý trước đó.";
  }
  const parsedResult = options.media ? await parseWithGemini(normalized, options.geminiKey, options.media) : await parseWithOpenRouter(normalized, options.suppliedKey);
  const parsed = parsedResult.parsed;
  if (parsed?.kind === "chat") return parsed.reply || "Mình nghe đây. Anh muốn Flowdesk hỗ trợ việc gì?";
  const at = now();
  const id = uid();
  const episodeId = await recordEpisode(db, owner, { source: "telegram", contentType: (options.contentType || "text") as "text" | "image" | "audio" | "video" | "document", rawInput: options.rawInput || normalized, metadata: { chatId, messageId: options.messageId ?? null, parsedKind: parsed?.kind || null } });
  const inserted = await db.prepare("INSERT OR IGNORE INTO inbox_items (id, owner_id, kind, title, body, processed_at, created_at, updated_at, source, content_type, raw_input, telegram_message_id, telegram_chat_id, parsed_json, status, error_message, episode_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, owner, parsed?.kind || "note", parsed?.title || normalized.slice(0, 100), normalized, at, at, options.contentType || "text", options.rawInput || normalized, options.messageId == null ? null : String(options.messageId), String(chatId), parsed ? JSON.stringify(parsed) : null, parsed ? "awaiting_confirmation" : "pending", parsedResult.error || null, episodeId).run();
  if (!inserted.meta.changes) return "Tin nhắn này đã được xử lý trước đó.";
  if (parsed) await completeEpisode(db, owner, episodeId);
  if (!parsed) return `Đã lưu vào Inbox nhưng chưa phân loại được. ${parsedResult.error || "Hãy xử lý trong Flowdesk."}`;
  return preview(parsed);
}
