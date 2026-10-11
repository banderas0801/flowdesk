export async function POST(request: Request) {
  let body: { token?: unknown } = {};
  try { body = await request.json() as { token?: unknown }; } catch { /* use Site Secret */ }
  const supplied = typeof body.token === "string" ? body.token.trim() : "";
  const token = supplied || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ ok: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN trong Site Secret." }, { status: 503 });
  const origin = new URL(request.url).origin;
  const secret = process.env.FLOWDESK_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, error: "Chưa cấu hình FLOWDESK_WEBHOOK_SECRET trong Site Secret." }, { status: 503 });
  const webhookUrl = `${origin}/api/telegram/webhook`;
  try { const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"] }) }); const result = await response.json() as { ok?: boolean; description?: string }; if (!response.ok || !result.ok) return Response.json({ ok: false, error: result.description || "Telegram từ chối đăng ký webhook." }, { status: 502 }); return Response.json({ ok: true, webhookUrl }); } catch { return Response.json({ ok: false, error: "Máy chủ không gọi được Telegram API." }, { status: 502 }); }
}
