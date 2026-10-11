"use client";
import { useRef, useState } from "react";
import { Download, FileUp, Loader2, Search, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Note = { id: string; title: string; body: string; tag: string; color: string; project_id: string | null; deleted_at: string | null };
type Source = { id: string; title: string; excerpt: string };
export function KnowledgeDesk({ notes, links, onOpen, onCreate }: { notes: Note[]; links: { source_id: string; target_id: string }[]; onOpen: (note: Note) => void; onCreate: (payload: Record<string, unknown>) => Promise<unknown> }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const exportNotes = () => {
    const alive = new Set(notes.map(note => note.id));
    const markdown = `# Kho tri thức Flowdesk\n\nXuất ngày ${new Date().toISOString()}\n\n` + notes.map(note => {
      const related = links.filter(link => link.source_id === note.id || link.target_id === note.id).map(link => link.source_id === note.id ? link.target_id : link.source_id).filter(id => alive.has(id));
      return `## ${note.title}\n\nID: ${note.id}\nNhãn: ${note.tag}\n\n${note.body}\n\nLiên kết: ${related.map(id => `[[${notes.find(n => n.id === id)?.title}]] (ID: ${id})`).join(", ") || "Chưa có"}\n\n---\n`;
    }).join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "flowdesk-tri-thuc.md"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true); setAnswer(""); setSources([]); setLastQuestion(question.trim());
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openrouter", apiKey: sessionStorage.getItem("flowdesk-openrouter-key") || undefined, message: question.trim(), useKnowledge: true }) });
      const result = await response.json() as { reply?: string; error?: string; sources?: Source[] };
      if (!response.ok) throw new Error(result.error || "Không thể tra cứu.");
      setAnswer(result.reply || "Chưa có câu trả lời."); setSources(result.sources || []);
    } catch (error) { setAnswer(error instanceof Error ? error.message : "Không thể tra cứu."); } finally { setBusy(false); }
  };
  const importFile = async (file?: File) => {
    if (!file) return; setImporting(true);
    try {
      if (!/\.(md|txt)$/i.test(file.name) || file.size > 200000) throw new Error("Chọn tệp .md hoặc .txt, tối đa 200 KB.");
      const body = await file.text(); if (!body.trim()) throw new Error("Tệp đang trống.");
      await onCreate({ title: file.name.replace(/\.(md|txt)$/i, ""), body: `Nguồn: ${file.name}\nNhập ngày: ${new Date().toISOString()}\n\n${body}`, tag: "Tài liệu", color: "blue" });
      toast.success("Đã lưu tài liệu vào kho tri thức");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể nhập tệp."); } finally { setImporting(false); if (input.current) input.current.value = ""; }
  };
  return <section className="mb-6 overflow-hidden rounded-[24px] border border-[#dfe3e8] bg-white">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#edf0f2] p-5 sm:p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-[#5b6ba3]">SECOND BRAIN</p><h2 className="mt-1 flex items-center gap-2 text-xl font-bold"><BookOpen className="size-5" /> Hỏi kho tri thức</h2><p className="mt-2 max-w-xl text-sm text-[#667184]">Tra cứu ghi chú và các trang liên kết, mở nguồn để kiểm chứng. {notes.length} trang trong kho.</p></div><div className="flex flex-wrap gap-2"><input ref={input} type="file" accept=".md,.txt" className="hidden" onChange={event => void importFile(event.target.files?.[0])} /><Button variant="outline" disabled={importing} onClick={() => input.current?.click()}>{importing ? <Loader2 className="animate-spin" /> : <FileUp />} Nhập tài liệu</Button><Button variant="outline" disabled={!notes.length} onClick={exportNotes}><Download /> Xuất Markdown</Button></div></div>
    <div className="p-5 sm:p-6"><form className="flex flex-col gap-3 sm:flex-row" onSubmit={event => { event.preventDefault(); void ask(); }}><Input aria-label="Câu hỏi về kho tri thức" placeholder="Ví dụ: Nguyên tắc ánh sáng trong kho của tôi là gì?" value={question} onChange={event => setQuestion(event.target.value)} className="h-12 min-w-0 flex-1" maxLength={4000} /><Button type="submit" className="h-12 bg-[#172035]" disabled={busy || !question.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Tra cứu</Button></form><p className="mt-2 text-xs leading-5 text-[#7b8495]">Tìm theo từ khóa và liên kết đã lưu. Tài liệu nhập giữ nguyên nội dung; chưa tự chưng cất hay đọc PDF/ảnh.</p>
    {answer && <div className="mt-5 rounded-2xl bg-[#f4f6f8] p-4"><p className="mb-3 whitespace-pre-wrap text-sm leading-7">{answer}</p>{sources.length > 0 && <div className="space-y-2 border-t border-[#dfe3e8] pt-3"><p className="text-xs font-bold uppercase text-[#667184]">Nguồn cung cấp cho câu trả lời</p>{sources.map((source, index) => <button key={source.id} className="block w-full rounded-xl bg-white p-3 text-left hover:bg-[#edf2ff]" onClick={() => { const note = notes.find(n => n.id === source.id); if (note) onOpen(note); else toast.error("Ghi chú không còn trong kho."); }}><span className="text-sm font-semibold">[{index + 1}] {source.title}</span><span className="mt-1 block text-xs leading-5 text-[#667184]">{source.excerpt}</span></button>)}<Button variant="outline" onClick={async () => { try { await onCreate({ title: lastQuestion.slice(0, 160), body: `${answer}\n\nNguồn tham khảo:\n${sources.map((source, index) => `[${index + 1}] [[${source.title}]] (ID: ${source.id})`).join("\n")}\n\nBản tổng hợp AI, cần kiểm chứng trước khi sử dụng.`, tag: "Tổng hợp AI", color: "lime" }); toast.success("Đã lưu câu trả lời cùng nguồn"); } catch { /* parent reports errors */ } }}>Lưu vào kho tri thức</Button></div>}</div>}
    </div></section>;
}
