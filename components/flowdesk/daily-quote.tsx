"use client";
import { useEffect, useState } from "react";
import { nextQuoteRefreshDelay, quoteForDate } from "./daily-quote-data";

export function DisciplineQuote() {
  const [daily,setDaily] = useState(() => quoteForDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const next = quoteForDate();
      setDaily(previous => previous.date === next.date ? previous : next);
      timer = setTimeout(refresh,nextQuoteRefreshDelay());
    };
    const onVisible = () => { if(document.visibilityState === "visible") refresh(); };
    refresh();
    document.addEventListener("visibilitychange",onVisible);
    window.addEventListener("focus",refresh);
    window.addEventListener("pageshow",refresh);
    return () => { clearTimeout(timer);document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh); };
  },[]);
  const {quote,date}=daily;
  return <section data-quote-date={date} className="relative mb-7 overflow-hidden rounded-[22px] border border-[#2b3b5d] bg-[#172035] p-5 text-white shadow-[0_14px_35px_rgba(23,32,53,.14)] sm:p-6"><span className="pointer-events-none absolute -right-4 -top-8 font-serif text-[150px] leading-none text-[#c7f36b]/10">“</span><div className="relative flex items-start gap-4"><span className="mt-1 grid size-10 shrink-0 place-items-center rounded-xl bg-[#c7f36b] font-serif text-3xl font-black leading-none text-[#172035]">“</span><div><blockquote className="max-w-3xl text-xl font-bold leading-8 tracking-[-.015em] text-white sm:text-2xl">{quote.text}</blockquote><p className="mt-3 text-sm text-white/70"><span className="font-semibold text-white">{quote.author}</span><span className="mx-2 text-[#c7f36b]">·</span><a href={quote.url} target="_blank" rel="noopener noreferrer" className="underline decoration-white/25 underline-offset-4 hover:text-[#c7f36b]" title="Nguồn nguyên tác; câu hiển thị được dịch sang tiếng Việt"><cite className="not-italic">{quote.source}</cite></a></p></div></div></section>;
}
