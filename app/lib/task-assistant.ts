import { dayKey, dueDay, isOverdue, shiftDay, weekStart, type PlannedTask } from "../../components/flowdesk/task-model";

export type TaskQuery = { kind: "today" | "tomorrow" | "week" | "overdue" | "open" | "doing" | "done"; todayOnly?: boolean };
export type AssistantTask = PlannedTask & { project_name: string | null; deleted_at?: string | null };
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
const compact = (value: string, max: number) => value.replace(/\s+/g, " ").slice(0, max);

/** Read-only routing: commands and clear task questions bypass LLM entirely. */
export function taskQueryIntent(text: string): TaskQuery | null {
  const value = normalize(text);
  const command = value.match(/^\/(today|overdue|tasks|doing|done|tomorrow|week)(?:@[\w_]+)?$/)?.[1];
  if (command) return { kind: command === "tasks" ? "open" : command as TaskQuery["kind"] };
  if (/^(tao|them|luu|ghi|nhac|xoa|sua|doi|cap nhat|danh dau|hoan thanh|da xong|done\s*:)(\b|:)/.test(value)) return null;
  if (/\b(viec|task|tasks|ke hoach)\s+la gi\b/.test(value)) return null;
  const dailyQuestion = /\b(hom nay|nay|ngay mai|mai)\b.*\b(can lam gi|lam nhung gi|con gi)\b/.test(value);
  const hasTask = dailyQuestion || /\b(viec|task|tasks|nhiem vu|ke hoach)\b/.test(value);
  const asks = dailyQuestion || /\?|\b(xem|liet ke|kiem tra|danh sach|bao nhieu|tong hop)\b|\b(viec|task|tasks|nhiem vu)\b.*\b(nao|gi|chua xong|chua hoan thanh|con lai)\b|\bco\b.*\b(viec|task|tasks)\b/.test(value);
  if (!hasTask || !asks) return null;
  const today = /\b(hom nay|ngay hom nay|nay)\b/.test(value);
  const tomorrow = /\b(ngay mai|hom sau|mai)\b/.test(value);
  if (/\b(qua han|tre han|lo han|overdue)\b/.test(value)) return { kind: "overdue" };
  if (/\b(dang lam|dang thuc hien|dang xu ly)\b/.test(value)) return { kind: "doing" };
  const unfinished = /\b(chua|khong|con)\b.*\b(hoan thanh|xong)\b|\b(con lai|can lam)\b/.test(value);
  if (!unfinished && /\b(da hoan thanh|da xong|hoan thanh roi|lam xong roi)\b/.test(value)) return { kind: "done", todayOnly: today };
  if (tomorrow) return { kind: "tomorrow" };
  if (/\b(tuan nay|trong tuan)\b/.test(value)) return { kind: "week" };
  if (today) return { kind: "today" };
  return { kind: "open" };
}

export async function readAssistantTasks(db: D1Database, owner: string) {
  // Query all owner tasks for accurate totals, then bound the reply, not the data.
  // The project join is owner-scoped as well as the tasks themselves.
  const rows = await db.prepare(`SELECT t.id, t.title, t.description, t.status, t.priority, t.project_id,
    t.due_at, t.planned_date, t.completed_at, t.checklist, p.name AS project_name
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.owner_id = t.owner_id AND p.deleted_at IS NULL
    WHERE t.owner_id = ? AND t.deleted_at IS NULL`).bind(owner).all<AssistantTask>();
  return rows.results;
}

export function selectAssistantTasks(tasks: AssistantTask[], query: TaskQuery, at = new Date()) {
  const today = dayKey(at), tomorrow = shiftDay(today, 1), start = weekStart(today), end = shiftDay(start, 6);
  const matchDay = (task: AssistantTask, day: string) => task.planned_date === day || dueDay(task.due_at) === day;
  const selected = tasks.filter(task => {
    if (task.deleted_at) return false;
    if (query.kind === "done") return task.status === "done" && (!query.todayOnly || !!task.completed_at && Number.isFinite(Date.parse(task.completed_at)) && dayKey(new Date(task.completed_at)) === today);
    if (task.status === "done") return false;
    if (query.kind === "overdue") return isOverdue(task, at);
    if (query.kind === "doing") return task.status === "doing";
    if (query.kind === "tomorrow") return matchDay(task, tomorrow);
    if (query.kind === "week") return isOverdue(task, at) || [task.planned_date, dueDay(task.due_at)].some(day => !!day && day >= start && day <= end);
    if (query.kind === "today") return matchDay(task, today) || isOverdue(task, at) || task.status === "doing";
    return true;
  });
  const rank: Record<string, number> = { Cao: 0, "Vừa": 1, "Thấp": 2 };
  return selected.sort((a, b) => Number(isOverdue(b, at)) - Number(isOverdue(a, at)) || (a.due_at || a.planned_date || "9999").localeCompare(b.due_at || b.planned_date || "9999") || (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || a.title.localeCompare(b.title, "vi"));
}

function dateText(value: string) {
  if (value.length === 10) return value.split("-").reverse().join("/");
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + "+07:00");
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hourCycle: "h23" }).format(date) : "Ngày chưa hợp lệ";
}

export function taskQueryReply(tasks: AssistantTask[], query: TaskQuery, at = new Date()) {
  const selected = selectAssistantTasks(tasks, query, at);
  const titles = { today: "Việc cần theo dõi hôm nay", tomorrow: "Việc ngày mai", week: "Việc trong tuần này", overdue: "Việc quá hạn", open: "Việc chưa hoàn thành", doing: "Việc đang làm", done: query.todayOnly ? "Việc đã hoàn thành hôm nay" : "Việc đã hoàn thành" };
  const date = dateText(dayKey(at));
  if (!selected.length) return `${titles[query.kind]} · ${date}\n\nKhông có công việc phù hợp trong dữ liệu Flowdesk hiện tại.${query.kind === "today" ? "\nDùng /tasks để xem cả việc chưa đặt lịch hoặc có hạn sau hôm nay." : ""}`;
  const overdue = selected.filter(t => isOverdue(t, at)).length;
  const lines = [`${titles[query.kind]} · ${date}`, `${selected.length} việc${overdue ? ` · ${overdue} quá hạn` : ""}`, ""];
  let displayed = 0;
  for (const task of selected) {
    if (displayed >= 15) break;
    const details = [task.status === "done" ? "Đã xong" : task.status === "doing" ? "Đang làm" : "Chưa làm"];
    if (task.priority === "Cao") details.push("Ưu tiên cao");
    if (task.due_at) details.push(`${isOverdue(task, at) ? "Quá hạn" : "Hạn"}: ${dateText(task.due_at)}`);
    else if (task.planned_date) details.push(`Dự kiến: ${dateText(task.planned_date)}`);
    else details.push("Chưa đặt lịch");
    if (task.project_name) details.push(compact(task.project_name, 60));
    const line = `${displayed + 1}. ${compact(task.title, 140)}\n   ${details.join(" · ")}`;
    if (lines.join("\n").length + line.length > 3400) break;
    lines.push(line); displayed++;
  }
  if (displayed < selected.length) lines.push(`\nCòn ${selected.length - displayed} việc khác; xem đầy đủ ở Công việc trong Flowdesk.`);
  lines.push("\nĐọc trực tiếp từ Flowdesk · Giờ Việt Nam.");
  return lines.join("\n");
}

export async function answerTaskQuery(db: D1Database, owner: string, query: TaskQuery, at = new Date()) {
  return taskQueryReply(await readAssistantTasks(db, owner), query, at);
}
