import { getRawDb } from "../../../../../db";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { ensureGoogleCalendarSchema } from "../../../../lib/google-calendar";

export async function GET() {
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  let connected = false;
  try {
    const user = await getChatGPTUser();
    const owner = user?.userId || process.env.FLOWDESK_OWNER_ID || process.env.TELEGRAM_OWNER_ID;
    if (owner) {
      const db = getRawDb();
      await ensureGoogleCalendarSchema(db);
      const row = await db.prepare("SELECT owner_id FROM google_calendar_connections WHERE owner_id = ? LIMIT 1").bind(owner).first();
      connected = Boolean(row);
    }
  } catch {
    connected = false;
  }
  return Response.json({ configured, connected, redirectUri: process.env.GOOGLE_REDIRECT_URI || "/api/integrations/google-calendar/callback" });
}

