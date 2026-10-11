"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const sourceUrl = "https://phamquangdai.com/tro-ly-ai";
const summary = "Trang giới thiệu khóa học Javis: cài trên máy và máy chủ, kết hợp model AI, Second Brain và MCP. Họ công bố khả năng đổi model, hỏi tài liệu qua Telegram, bot Zalo, content đa kênh và nối dữ liệu nghiệp vụ. Đây là mô tả của bên cung cấp, chưa kiểm thử độc lập.";
const comparison = [
  { layer: "Model AI", status: "Đã có giao diện", current: "Flowdesk có cấu hình nhiều nhà cung cấp; tra cứu tri thức hiện dùng OpenRouter.", next: "Cho chọn model ngay trong tra cứu, giữ cùng nguồn đối chiếu." },
  { layer: "Nơi chạy", status: "Đã có web được lưu trữ", current: "Site có máy chủ, dữ liệu D1 và các endpoint Telegram. Tác vụ nền phụ thuộc lịch hoặc webhook đã cấu hình.", next: "Hiển thị lần chạy gần nhất, lỗi và trạng thái lịch để biết việc có thực sự chạy." },
  { layer: "Kho tri thức", status: "Đã có nền tảng", current: "Nhập TXT/Markdown, xuất Markdown, liên kết ghi chú, tra cứu từ khóa và mở nguồn. Chưa tự chưng cất tài liệu.", next: "Ưu tiên bản nháp tri thức ngắn có nguồn, duyệt trước khi lưu và liên kết với tài liệu gốc." },
  { layer: "Kết nối dữ liệu", status: "Có kết nối cụ thể", current: "Có Telegram và Google Calendar. Chưa thấy lớp MCP tổng quát để phối hợp nhiều ứng dụng.", next: "Hoàn thiện một quy trình xuyên suốt với dữ liệu thật trước khi mở rộng kết nối." },
];
const priorities = [
  { name: "Chưng cất có kiểm chứng", text: "Từ một tài liệu tạo bản nháp: ý chính, nguồn, điểm chưa rõ và liên kết đề xuất. Người dùng duyệt rồi mới đưa vào kho." },
  { name: "Nghiệm thu một vòng hoàn chỉnh", text: "Nhập tài liệu → hỏi trên web → mở đúng nguồn → thử cùng câu hỏi qua Telegram → lưu kết quả. Đo bằng việc làm được." },
  { name: "Quan sát vận hành", text: "Tập trung trạng thái kết nối, lần chạy, lỗi và chi phí vào một nơi. Ưu tiên độ tin cậy của quy trình đang dùng." },
];

export function ReferenceReview({ onCreate, onKnowledge, onConnections }: { onCreate: (payload: Record<string, unknown>) => Promise<unknown>; onKnowledge: () => void; onConnections: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      await onCreate({ title: "Javis — đối chiếu với Flowdesk (11/10/2026)", tag: "Tham khảo", color: "blue", body: `Nguồn: ${sourceUrl}\nNgày đọc: 11/10/2026\n\n${summary}\n\nĐối chiếu từ mã nguồn Flowdesk, chưa xác nhận cấu hình thực tế:\n${comparison.map(row => `\n${row.layer}\nHiện có: ${row.current}\nĐề xuất: ${row.next}`).join("\n")}\n\nƯu tiên đề xuất, chưa triển khai:\n${priorities.map((item, i) => `${i + 1}. ${item.name}: ${item.text}`).join("\n")}` });
      setSaved(true); toast.success("Đã lưu bản đối chiếu vào kho tri thức");
    } catch { /* workspace reports save errors */ } finally { setSaving(false); }
  };
  return <div className="space-y-6">
    <section className="rounded-[24px] bg-[#10182a] p-6 text-white sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-[#c7f36b]">THAM KHẢO · ĐỌC NGÀY 11/10/2026</p>
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Họ đang xây trợ lý AI như thế nào?</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-white/75">{summary}</p>
      <div className="mt-5 flex flex-wrap gap-3"><Button asChild className="bg-[#c7f36b] text-[#10182a] hover:bg-[#b6e358]"><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Đọc trang gốc <ExternalLink /></a></Button><Button disabled={saving || saved} onClick={() => void save()} className="border border-white/20 bg-white/10 text-white hover:bg-white/20">{saving ? <Loader2 className="animate-spin" /> : <BookOpen />}{saved ? "Đã lưu trong phiên này" : "Lưu bản đối chiếu vào tri thức"}</Button></div>
    </section>
    <section className="rounded-[24px] border border-[#dfe3e8] bg-white p-5 sm:p-6"><h2 className="text-xl font-bold">Flowdesk đang ở đâu?</h2><p className="mt-2 text-sm leading-6 text-[#667184]">Đối chiếu chức năng trong mã nguồn hiện tại. Có chức năng chưa đồng nghĩa đã cấu hình và vận hành thành công.</p><div className="mt-5 grid gap-4 md:grid-cols-2">{comparison.map(row => <article key={row.layer} className="rounded-2xl border border-[#e5e8ee] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{row.layer}</h3><span className="rounded-full bg-[#edf2ff] px-3 py-1 text-xs text-[#365da9]">{row.status}</span></div><p className="mt-3 text-sm leading-6 text-[#667184]">{row.current}</p><p className="mt-3 border-t border-[#edf0f2] pt-3 text-sm leading-6"><span className="font-semibold">Bước nên làm: </span>{row.next}</p></article>)}</div></section>
    <section><h2 className="text-xl font-bold">Ba điểm đáng học để áp dụng</h2><p className="mt-2 text-sm text-[#667184]">Đề xuất cho Flowdesk; chưa phải tính năng đã triển khai.</p><div className="mt-4 grid gap-4 xl:grid-cols-3">{priorities.map((item, index) => <article key={item.name} className="rounded-[22px] border border-[#dfe3e8] bg-white p-5"><span className="text-sm font-bold text-[#5b6ba3]">0{index + 1}</span><h3 className="mt-2 font-bold">{item.name}</h3><p className="mt-3 text-sm leading-6 text-[#667184]">{item.text}</p></article>)}</div><div className="mt-5 flex flex-wrap gap-3"><Button variant="outline" onClick={onKnowledge}>Mở kho tri thức <ArrowRight /></Button><Button variant="outline" onClick={onConnections}>Kiểm tra kết nối <ArrowRight /></Button></div></section>
  </div>;
}
