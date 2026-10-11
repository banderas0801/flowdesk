export type GeminiMedia = { data: string; mimeType: string };

export async function callGemini(options: { apiKey: string; model: string; prompt: string; media?: GeminiMedia }) {
  const parts: Array<Record<string, unknown>> = [{ text: options.prompt }];
  if (options.media?.data) {
    const [header, payload] = options.media.data.split(",", 2);
    const mimeType = options.media.mimeType || header?.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
    if (payload) parts.push({ inlineData: { mimeType, data: payload } });
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Gemini trả về HTTP ${response.status}.`);
  return result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}
