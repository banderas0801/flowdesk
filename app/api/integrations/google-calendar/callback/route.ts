import { getRawDb } from "../../../../../db";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { ensureGoogleCalendarSchema } from "../../../../lib/google-calendar";

function cookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) return Response.json({ ok: false, error: `Google từ chối cấp quyền: ${error}` }, { status: 400 });
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== cookie(request, "flowdesk_google_oauth_state")) return Response.json({ ok: false, error: "Phiên OAuth Google không hợp lệ hoặc đã hết hạn." }, { status: 400 });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.json({ ok: false, error: "Flowdesk chưa được cấu hình Google OAuth." }, { status: 503 });
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/integrations/google-calendar/callback`;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!tokenResponse.ok || !tokens.access_token) return Response.json({ ok: false, error: tokens.error || "Google không trả về access token." }, { status: 502 });
    const user = await getChatGPTUser();
    const owner = user?.userId || process.env.FLOWDESK_OWNER_ID || process.env.TELEGRAM_OWNER_ID;
    if (!owner) return Response.json({ ok: false, error: "Không xác định được chủ sở hữu Flowdesk." }, { status: 401 });
    const db = getRawDb();
    await ensureGoogleCalendarSchema(db);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO google_calendar_connections (owner_id, access_token, refresh_token, token_expires_at, scope, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET access_token = excluded.access_token, refresh_token = COALESCE(excluded.refresh_token, google_calendar_connections.refresh_token), token_expires_at = excluded.token_expires_at, scope = excluded.scope, updated_at = excluded.updated_at`).bind(owner, tokens.access_token, tokens.refresh_token || null, new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), tokens.scope || "", now).run();
    return new Response(null, { status: 302, headers: { Location: "/?calendar=connected", "Set-Cookie": "flowdesk_google_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
  } catch { return Response.json({ ok: false, error: "Không thể hoàn tất kết nối Google Calendar." }, { status: 502 }); }
}

