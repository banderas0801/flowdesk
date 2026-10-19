import { getRawDb } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";
import { selectKnowledge, knowledgePrompt, type KnowledgeNote } from "../../lib/knowledge";
import { callGemini } from "../../lib/gemini";
import { answerTaskQuery, taskQueryIntent } from "../../lib/task-assistant";

const providers: Record<string, { key: string; baseKey: string; modelKey: string; defaultBase: string; defaultModel: string }> = {
  codex: { key: "OPENAI_API_KEY", baseKey: "OPENAI_BASE_URL", modelKey: "OPENAI_MODEL", defaultBase: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  grok: { key: "XAI_API_KEY", baseKey: "XAI_BASE_URL", modelKey: "XAI_MODEL", defaultBase: "https://api.x.ai/v1", defaultModel: "grok-3-mini" },
  antigravity: { key: "ANTIGRAVITY_API_KEY", baseKey: "ANTIGRAVITY_BASE_URL", modelKey: "ANTIGRAVITY_MODEL", defaultBase: "", defaultModel: "" },
  openrouter: { key: "OPENROUTER_API_KEY", baseKey: "OPENROUTER_BASE_URL", modelKey: "OPENROUTER_MODEL", defaultBase: "https://openrouter.ai/api/v1", defaultModel: "deepseek/deepseek-v4-flash-0731" },
  gemini: { key: "GEMINI_API_KEY", baseKey: "GEMINI_BASE_URL", modelKey: "GEMINI_MODEL", defaultBase: "", defaultModel: "gemini-2.5-flash" },
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { useKnowledge?: boolean; provider?: string; apiKey?: string; message?: string; history?: Array<{ role: "user" | "assistant"; content: string }>; attachment?: { name?: string; type?: string; data?: string } | null };
    const suppliedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const providerId = suppliedKey.startsWith("sk-or-v1-") ? "openrouter" : (body.provider || "codex");
    const provider = providers[providerId];
    if (!provider) return Response.json({ error: "LLM không được hỗ trợ." }, { status: 400 });
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return Response.json({ error: "Hãy nhập một tin nhắn." }, { status: 400 });
    const taskQuery = !body.attachment ? taskQueryIntent(message) : null;
    if (taskQuery) {
      const user = await getChatGPTUser();
      const owner = user?.userId || (process.env.NODE_ENV !== "production" ? "local-preview" : null);
      if (!owner) return Response.json({ error: "Hãy đăng nhập để xem công việc của bạn." }, { status: 401 });
      try {
        const reply = await answerTaskQuery(getRawDb(), owner, taskQuery);
        return Response.json({ reply, provider: "flowdesk", source: "tasks", sources: [] });
      } catch { return Response.json({ error: "Không đọc được dữ liệu công việc từ Flowdesk lúc này. Hãy thử lại sau." }, { status: 503 }); }
    }
    let context = "";
    let sources: Array<{ id: string; title: string; excerpt: string }> = [];
    if (body.useKnowledge) {
      const user = await getChatGPTUser();
      const owner = user?.userId || (process.env.NODE_ENV !== "production" ? "local-preview" : null);
      if (!owner) return Response.json({ error: "Hãy đăng nhập để tra cứu kho tri thức của bạn." }, { status: 401 });
      const db = getRawDb();
      const [noteRows, linkRows] = await Promise.all([
        db.prepare("SELECT id, title, body, tag, project_id FROM notes WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500").bind(owner).all<KnowledgeNote>(),
        db.prepare("SELECT source_id, target_id FROM note_links WHERE owner_id = ?").bind(owner).all<{ source_id: string; target_id: string }>(),
      ]);
      const selected = selectKnowledge(noteRows.results, linkRows.results, message);
      if (!selected.length) return Response.json({ reply: "Chưa tìm thấy ghi chú phù hợp trong 500 trang cập nhật gần nhất. Hãy dùng từ khóa cụ thể hơn hoặc thêm tài liệu vào kho.", sources: [] });
      context = knowledgePrompt(selected);
      sources = selected.map(note => ({ id: note.id, title: note.title, excerpt: note.body.slice(0, 220) }));
    }
    // Runtime Site Secret is the shared source of truth for web chat and Telegram.
    // A supplied session key is only a fallback for temporary testing.
    const key = process.env[provider.key] || suppliedKey;
    if (!key) return Response.json({ error: `Chưa cấu hình ${provider.key} trong Site Secrets.` }, { status: 503 });
    const base = process.env[provider.baseKey] || provider.defaultBase;
    const model = process.env[provider.modelKey] || provider.defaultModel;
    if (!model || (providerId !== "gemini" && !base)) return Response.json({ error: `Cần cấu hình ${provider.key}${providerId === "gemini" ? "" : ` và ${provider.baseKey}`}.` }, { status: 503 });
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    let textMessage = message;
    if (body.attachment?.data && body.attachment.type && !body.attachment.type.startsWith("image/")) {
      try { const encoded = body.attachment.data.split(",")[1] || ""; textMessage = `${message}\n\nTệp ${body.attachment.name || "đính kèm"}:\n${atob(encoded).slice(0, 12000)}`; } catch { /* keep the original message */ }
    }
    const content: unknown = body.attachment?.type?.startsWith("image/") && body.attachment.data ? [{ type: "text", text: message }, { type: "image_url", image_url: { url: body.attachment.data } }] : textMessage;
    if (providerId === "gemini") {
      const reply = await callGemini({ apiKey: key, model, prompt: [...(context ? [context] : []), ...history.map((item) => `${item.role}: ${item.content}`), `user: ${textMessage}`].join("\n"), media: body.attachment?.type?.startsWith("image/") && body.attachment.data ? { data: body.attachment.data, mimeType: body.attachment.type || "image/*" } : undefined });
      return Response.json({ reply: reply || "Gemini không trả về nội dung.", provider: providerId, model, sources });
    }
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://idea-workbench.kh-ng-gian-l-0906.chatgpt.site", "X-Title": "Flowdesk" }, body: JSON.stringify({ model, messages: [...(context ? [{ role: "system", content: context }] : []), ...history, { role: "user", content }], temperature: 0.4 }) });
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) return Response.json({ error: result.error?.message || "LLM từ chối yêu cầu." }, { status: 502 });
    return Response.json({ reply: result.choices?.[0]?.message?.content || "LLM không trả về nội dung.", provider: providerId, model, sources });
  } catch { return Response.json({ error: "Không thể kết nối LLM lúc này." }, { status: 503 }); }
}
