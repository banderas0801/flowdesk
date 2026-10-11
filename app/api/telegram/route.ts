export async function GET() {
  return Response.json({
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    webhookPath: "/api/telegram/webhook",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length < 20) return Response.json({ ok: false, error: "Token Telegram không hợp lệ." }, { status: 400 });
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, { method: "GET", headers: { Accept: "application/json" } });
    const result = await response.json() as { ok?: boolean; result?: { username?: string; first_name?: string }; description?: string };
    if (!response.ok || !result.ok) return Response.json({ ok: false, error: result.description || "Telegram từ chối token." }, { status: 400 });
    return Response.json({ ok: true, bot: result.result ? { username: result.result.username, firstName: result.result.first_name } : null });
  } catch { return Response.json({ ok: false, error: "Không thể kiểm tra Telegram lúc này." }, { status: 503 }); }
}
