import { getRawDb } from "../../../../db";
import { answerTelegramCallback, sendTelegramMessage } from "../../../lib/telegram-actions";
import { fetchTelegramImage, telegramContentType } from "../../../lib/telegram-media";
import { processTelegramText } from "../../../lib/telegram-inbox";

type TelegramMessage = { chat?: { id?: number }; text?: string; caption?: string; photo?: Array<{ file_id: string; width?: number; height?: number }>; document?: { file_id: string; mime_type?: string; file_name?: string } };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: { id?: string; data?: string; message?: { chat?: { id?: number } } } };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; openrouterKey?: string; geminiKey?: string; offset?: number; reset?: boolean };
    const token = body.token?.trim();
    if (!token) return Response.json({ ok: false, error: "Thiếu Telegram token." }, { status: 400 });
    const telegramOptions = { signal: AbortSignal.timeout(8000) };
    if (body.reset) {
      const resetResponse = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/deleteWebhook?drop_pending_updates=false`, { method: "POST", ...telegramOptions });
      if (!resetResponse.ok) return Response.json({ ok: false, error: "Không thể chuyển Telegram sang chế độ thử." }, { status: 502 });
    }
    const updatesResponse = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?timeout=0&allowed_updates=%5B%22message%22,%22callback_query%22%5D${typeof body.offset === "number" && body.offset > 0 ? `&offset=${body.offset}` : ""}`, telegramOptions);
    const updatesResult = await updatesResponse.json() as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
    if (!updatesResponse.ok || !updatesResult.ok) return Response.json({ ok: false, error: updatesResult.description || "Telegram không phản hồi." }, { status: 502 });
    const updates = updatesResult.result || [];
    const db = getRawDb();
    for (const update of updates) {
      const callback = update.callback_query;
      if (callback?.id && callback.message?.chat?.id && (callback.data === "fd_confirm" || callback.data === "fd_reject")) {
        const chatId = callback.message.chat.id;
        const reply = await processTelegramText(db, chatId, callback.data === "fd_confirm" ? "/confirm" : "/reject");
        await answerTelegramCallback(token, callback.id, callback.data === "fd_confirm" ? "Đã tạo công việc/ghi chú" : "Đã hủy bản nháp", telegramOptions.signal);
        await sendTelegramMessage(token, chatId, reply, telegramOptions.signal);
        continue;
      }
      const message = update.message;
      const chatId = message?.chat?.id;
      if (!chatId) continue;
      const caption = message.caption?.trim() || "";
      const text = message.text?.trim() || caption || (message.photo || message.document ? "Hãy đọc nội dung tệp đính kèm và đề xuất công việc hoặc ghi chú." : "");
      if (!text) continue;
      const media = (message.photo || (message.document?.mime_type || "").startsWith("image/")) ? await fetchTelegramImage(token, message) : null;
      const reply = await processTelegramText(db, chatId, text, { suppliedKey: body.openrouterKey, geminiKey: body.geminiKey, messageId: update.update_id, contentType: telegramContentType(message), rawInput: caption ? `${caption}\n[Telegram media attached]` : text, media: media ? { data: media.data, mimeType: media.mimeType } : undefined });
      const sendResponse = await sendTelegramMessage(token, chatId, reply, telegramOptions.signal);
      if (!sendResponse.ok) return Response.json({ ok: false, error: "Đã nhận tin nhưng không gửi được phản hồi về Telegram." }, { status: 502 });
    }
    return Response.json({ ok: true, nextOffset: updates.length ? updates[updates.length - 1].update_id + 1 : body.offset || 0, count: updates.length, chatIds: [...new Set(updates.map((update) => update.message?.chat?.id || update.callback_query?.message?.chat?.id).filter((id): id is number => typeof id === "number"))] });
  } catch { return Response.json({ ok: false, error: "Không thể kết nối Telegram từ chế độ thử." }, { status: 503 }); }
}
