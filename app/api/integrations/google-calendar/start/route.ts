export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Response.json({ ok: false, error: "Flowdesk chưa có GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET." }, { status: 503 });
  const url = new URL(request.url);
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/integrations/google-calendar/callback`;
  const state = crypto.randomUUID();
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly");
  auth.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": `flowdesk_google_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}

