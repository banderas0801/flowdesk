const providerConfig: Record<string, { key: string; base: string; model: string }> = {
  antigravity: { key: "ANTIGRAVITY_API_KEY", base: "ANTIGRAVITY_BASE_URL", model: "ANTIGRAVITY_MODEL" },
  grok: { key: "XAI_API_KEY", base: "XAI_BASE_URL", model: "XAI_MODEL" },
  codex: { key: "OPENAI_API_KEY", base: "OPENAI_BASE_URL", model: "OPENAI_MODEL" },
  openrouter: { key: "OPENROUTER_API_KEY", base: "OPENROUTER_BASE_URL", model: "OPENROUTER_MODEL" },
  gemini: { key: "GEMINI_API_KEY", base: "GEMINI_BASE_URL", model: "GEMINI_MODEL" },
};

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") || "";
  const config = providerConfig[provider];
  if (!config) return Response.json({ error: "Nhà cung cấp không được hỗ trợ." }, { status: 400 });
  return Response.json({
    provider,
    configured: Boolean(process.env[config.key]),
    endpointConfigured: Boolean(process.env[config.base]),
    modelConfigured: Boolean(process.env[config.model]),
    gateway: provider === "gemini" ? "Google Gemini API" : "OpenAI-compatible",
  });
}
