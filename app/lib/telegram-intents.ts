export function telegramIntentReply(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (value === "/start") return "Flowdesk đã kết nối. Gửi câu hỏi hoặc lệnh công việc cho mình.";
  if (value === "/help" || value === "help" || value === "trợ giúp") return "Lệnh nhanh:\n/today — việc hôm nay\n/overdue — việc quá hạn\n/help — xem hướng dẫn\nBạn cũng có thể gửi câu hỏi tự nhiên cho Flowdesk.";
  if (value === "/today") return "Mình sẽ gửi bản việc hôm nay khi lịch nhắc chạy. Bạn có thể xem đầy đủ trong Flowdesk.";
  if (value === "/overdue") return "Mình sẽ gửi các việc quá hạn trong bản nhắc tiếp theo. Bạn có thể xem ngay trong Flowdesk.";
  if (["alo", "hello", "hi", "ping"].includes(value)) return "Flowdesk đang nghe. Bạn cần xử lý việc nào?";
  return null;
}
