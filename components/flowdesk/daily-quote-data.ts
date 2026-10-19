import { dayKey } from "./task-model";
import { additionalQuotes } from "./additional-quotes";

const epictetus = "https://classics.mit.edu/Epictetus/epicench.html";
export const dailyQuotes = [
  { text: "Đừng bàn mãi về việc người tốt phải như thế nào. Hãy trở thành người như thế.", author: "Marcus Aurelius", source: "Meditations, X.16", url: "https://classics.mit.edu/Antoninus/meditations.10.ten.html" },
  { text: "Trong khi ta trì hoãn, cuộc đời vụt qua.", author: "Seneca", source: "Letters to Lucilius, Thư 1", url: "https://en.wikisource.org/wiki/Moral_letters_to_Lucilius/Letter_1" },
  { text: "Trong mọi việc, hãy cân nhắc điều đi trước và điều theo sau, rồi mới bắt tay làm.", author: "Epictetus", source: "Enchiridion, §29", url: epictetus },
  { text: "Buổi sáng, khi miễn cưỡng thức dậy, hãy nhớ: ta đứng lên để làm công việc của một con người.", author: "Marcus Aurelius", source: "Meditations, V.1", url: "https://classics.mit.edu/Antoninus/meditations.5.five.html" },
  { text: "Không phải sự việc làm ta khổ, mà là cách ta phán đoán về chúng.", author: "Epictetus", source: "Enchiridion, §5", url: epictetus },
  { text: "Khi không biết mình đang hướng tới bến cảng nào, chẳng ngọn gió nào là thuận.", author: "Seneca", source: "Letters to Lucilius, Thư 71.3", url: "https://en.wikisource.org/wiki/Moral_letters_to_Lucilius/Letter_71" },
  { text: "Hãy làm mỗi việc trong đời như thể đó là việc cuối cùng của mình.", author: "Marcus Aurelius", source: "Meditations, II.5", url: "https://classics.mit.edu/Antoninus/meditations.2.two.html" },
  { text: "Với mỗi điều xảy đến, hãy tự hỏi mình có năng lực nào để sử dụng nó cho đúng.", author: "Epictetus", source: "Enchiridion, §10", url: epictetus },
  { text: "Đừng làm mình rối loạn bằng cách nghĩ về toàn bộ cuộc đời cùng một lúc.", author: "Marcus Aurelius", source: "Meditations, VIII.36", url: "https://classics.mit.edu/Antoninus/meditations.8.eight.html" },
  { text: "Đừng nói nhiều về các nguyên lý; hãy hành động phù hợp với chúng.", author: "Epictetus", source: "Enchiridion, §46", url: epictetus },
  { text: "Khi hoàn cảnh làm mình xao động, hãy nhanh chóng trở về với chính mình.", author: "Marcus Aurelius", source: "Meditations, VI.11", url: "https://classics.mit.edu/Antoninus/meditations.6.six.html" },
  { text: "Có những điều nằm trong quyền kiểm soát của ta, và những điều không nằm trong đó.", author: "Epictetus", source: "Enchiridion, §1", url: epictetus },
  { text: "Những quy tắc đã cân nhắc và đặt ra cho mình, hãy tuân thủ như luật.", author: "Epictetus", source: "Enchiridion, §50, bản Elizabeth Carter", url: epictetus },
  { text: "Mỗi việc có hai quai: một quai giúp ta mang được nó, một quai thì không.", author: "Epictetus", source: "Enchiridion, §43", url: epictetus },
  ...additionalQuotes,
];
const anchor = Date.parse("2026-10-13T00:00:00Z");
export function quoteForDate(now = new Date()) {
  const date = dayKey(now);
  const elapsed = Math.round((Date.parse(date+"T00:00:00Z")-anchor)/86400000);
  const index = ((elapsed % dailyQuotes.length) + dailyQuotes.length) % dailyQuotes.length;
  return { date, quote: dailyQuotes[index], index };
}
export function nextQuoteRefreshDelay(now = new Date()) {
  const next = Date.parse(dayKey(now)+"T00:00:00+07:00")+86400000;
  return Math.max(50,next-now.getTime()+50);
}
