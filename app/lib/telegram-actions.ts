export function draftKeyboard(reply: string) {
  return reply.includes("/confirm") ? { inline_keyboard: [[{ text: "✓ Xác nhận", callback_data: "fd_confirm" }, { text: "✕ Hủy", callback_data: "fd_reject" }]] } : undefined;
}

export async function sendTelegramMessage(token: string, chatId: number, text: string, signal?: AbortSignal) {
  return fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), reply_markup: draftKeyboard(text) }), signal });
}

export async function answerTelegramCallback(token: string, callbackId: string, text: string, signal?: AbortSignal) {
  return fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: callbackId, text }), signal });
}
