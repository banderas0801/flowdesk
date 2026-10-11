import { getRawDb } from "../../../../db";
import { answerTelegramCallback, sendTelegramMessage } from "../../../lib/telegram-actions";
import { fetchTelegramImage, telegramContentType } from "../../../lib/telegram-media";
import { processTelegramText } from "../../../lib/telegram-inbox";

type TelegramMessage = { chat?: { id?: number }; text?: string; caption?: string; photo?: Array<{ file_id: string; width?: number; height?: number }>; document?: { file_id: string; mime_type?: string; file_name?: string } };
type TelegramUpdate = { update_id?: number; message?: TelegramMessage; callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number } } } };

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ ok: false, error: "Chưa cấu hình TELEGRAM_BOT_TOKEN." }, { status: 503 });
  const webhookSecret = process.env.FLOWDESK_WEBHOOK_SECRET?.trim();
  if (!webhookSecret || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) return Response.json({ ok: false, error: "Webhook không hợp lệ." }, { status: 401 });
  const allowedChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!allowedChatId) return Response.json({ ok: false, error: "Chưa cấu hình TELEGRAM_CHAT_ID." }, { status: 503 });
  try {
    const update = await request.json() as TelegramUpdate;
    const db = getRawDb();
    const callback = update.callback_query;
    const callbackChatId = callback?.message?.chat?.id;
    if (callbackChatId && String(callbackChatId) !== allowedChatId) return Response.json({ ok: true, ignored: true });
    if (callback?.id && callback.message?.chat?.id && (callback.data === "fd_confirm" || callback.data === "fd_reject")) {
      const command = callback.data === "fd_confirm" ? "/confirm" : "/reject";
      const reply = await processTelegramText(db, callback.message.chat.id, command);
      await answerTelegramCallback(token, callback.id, callback.data === "fd_confirm" ? "Đã tạo công việc/ghi chú" : "Đã hủy bản nháp", AbortSignal.timeout(8000));
      const response = await sendTelegramMessage(token, callback.message.chat.id, reply, AbortSignal.timeout(8000));
      if (!response.ok) return Response.json({ ok: false, error: "Không gửi được kết quả về Telegram." }, { status: 502 });
      return Response.json({ ok: true });
    }
    const message = update.message;
    const chatId = message?.chat?.id;
    if (!chatId) return Response.json({ ok: true });
    if (String(chatId) !== allowedChatId) return Response.json({ ok: true, ignored: true });
    const caption = message.caption?.trim() || "";
    const text = message.text?.trim() || caption || (message.photo || message.document ? "Hãy đọc nội dung tệp đính kèm và đề xuất công việc hoặc ghi chú." : "");
    if (!text) return Response.json({ ok: true });
    const media = (message.photo || (message.document?.mime_type || "").startsWith("image/")) ? await fetchTelegramImage(token, message) : null;
    const reply = await processTelegramText(db, chatId, text, { messageId: update.update_id, contentType: telegramContentType(message), rawInput: caption ? `${caption}\n[Telegram media attached]` : text, media: media ? { data: media.data, mimeType: media.mimeType } : undefined });
    const response = await sendTelegramMessage(token, chatId, reply, AbortSignal.timeout(8000));
    if (!response.ok) return Response.json({ ok: false, error: "Đã xử lý Inbox nhưng không gửi được phản hồi Telegram." }, { status: 502 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram webhook failed", error);
    return Response.json({ ok: false, error: "Không thể xử lý tin nhắn Telegram." }, { status: 503 });
  }
}
