type ReminderTask = { title?: string; dueAt?: string | null; priority?: string; status?: string };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; chatId?: number | string; tasks?: ReminderTask[] };
    const token = body.token?.trim();
    if (!token || !body.chatId) return Response.json({ ok: false, error: "Thiếu Telegram token hoặc chat ID." }, { status: 400 });
    const now = Date.now();
    const tasks = (body.tasks || []).filter((task) => {
      if (task.status === "done" || !task.title?.trim()) return false;
      if (task.priority === "Cao" && !task.dueAt) return true;
      if (!task.dueAt) return false;
      const due = new Date(task.dueAt).getTime();
      return Number.isFinite(due) && due <= now + 24 * 60 * 60 * 1000;
    });
    if (!tasks.length) return Response.json({ ok: true, sent: false, reason: "no_tasks" });
    const lines = tasks.slice(0, 12).map((task, index) => `${index + 1}. ${task.title}${task.priority === "Cao" ? " · Ưu tiên cao" : ""}${task.dueAt ? ` · ${new Date(task.dueAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}` : ""}`);
    const text = `Nhắc việc hôm nay\n\n${lines.join("\n")}\n\nKhi xong, gửi “Đã xong: tên việc”.`;
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: body.chatId, text }), signal: AbortSignal.timeout(8000) });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || !result.ok) return Response.json({ ok: false, error: result.description || "Telegram không nhận được lời nhắc." }, { status: 502 });
    return Response.json({ ok: true, sent: true, count: tasks.length });
  } catch { return Response.json({ ok: false, error: "Không thể gửi lời nhắc Telegram lúc này." }, { status: 503 }); }
}
