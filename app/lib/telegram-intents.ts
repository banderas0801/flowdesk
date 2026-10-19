export function telegramIntentReply(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (value === "/start") return "Flowdesk đã kết nối. Gửi câu hỏi hoặc lệnh công việc cho mình.";
  if (value === "/help" || value === "help" || value === "trợ giúp") return "Lệnh nhanh:\n/today — việc hôm nay và quá hạn\n/tasks — mọi việc chưa hoàn thành\n/overdue — việc quá hạn\n/tomorrow — việc ngày mai\n/doing — việc đang làm\n/done — việc đã hoàn thành\nBạn có thể hỏi: ‘Nay có việc nào chưa hoàn thành vậy?’ — Flowdesk đọc dữ liệu hiện tại ngay.";
  if (["alo", "hello", "hi", "ping"].includes(value)) return "Flowdesk đang nghe. Bạn cần xử lý việc nào?";
  return null;
}
