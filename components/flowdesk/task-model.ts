export type PlannedTask = {
  id: string; title: string; description: string; status: "todo" | "doing" | "done"; priority: string;
  project_id: string | null; due_at: string | null; planned_date?: string | null; completed_at?: string | null; checklist: string;
};
export type TaskProject = { id: string; name: string; color?: string };
export type TaskView = "day" | "week" | "all" | "board" | "calendar";
export type DateBasis = "planned" | "due";
export function dayKey(date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => p.find(x => x.type === type)?.value).join("-");
}
export function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + "T12:00:00Z").toISOString().slice(0,10) === value;
}
export function shiftDay(day: string, amount: number) {
  const date = new Date(day + "T12:00:00+07:00"); date.setUTCDate(date.getUTCDate() + amount); return dayKey(date);
}
export function weekStart(day: string) {
  const weekday = new Date(day + "T12:00:00+07:00").getUTCDay(); return shiftDay(day, -((weekday + 6) % 7));
}
export function dueDay(value?: string | null): string | null {
  if (!value) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const date = new Date(value); return Number.isFinite(date.getTime()) ? dayKey(date) : null;
  }
  return validDay(value.slice(0,10)) ? value.slice(0,10) : null;
}
export function taskDate(task: PlannedTask, basis: DateBasis) {
  return basis === "planned" ? task.planned_date || null : dueDay(task.due_at);
}
export function planDay(task: PlannedTask) { return task.planned_date || dueDay(task.due_at); }
export function isOverdue(task: PlannedTask, now = new Date()) {
  if (task.status === "done" || !task.due_at) return false;
  if (task.due_at.length === 10) return task.due_at < dayKey(now);
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(task.due_at) ? task.due_at : task.due_at + "+07:00");
  return Number.isFinite(date.getTime()) && date.getTime() < now.getTime();
}
export function dueOnDay(task: PlannedTask, day: string) {
  if (!task.due_at || task.due_at.length === 10) return day;
  const old = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(task.due_at) ? task.due_at : task.due_at + "+07:00");
  const time = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(old);
  return day + "T" + time + "+07:00";
}
export function monthDays(day: string) {
  const first = day.slice(0,7) + "-01", start = weekStart(first);
  const next = new Date(first + "T12:00:00Z"); next.setUTCMonth(next.getUTCMonth()+1);
  const last = shiftDay(next.toISOString().slice(0,10), -1);
  const count = Math.ceil((Math.round((Date.parse(last)-Date.parse(start))/86400000)+1)/7)*7;
  return Array.from({length:count},(_,i)=>shiftDay(start,i));
}
export function sortTasks(tasks: PlannedTask[], by: "priority" | "date" | "title") {
  const rank: Record<string,number> = {Cao:0,"Vừa":1,"Thấp":2};
  return [...tasks].sort((a,b)=> {
    if (by === "title") return a.title.localeCompare(b.title,"vi");
    if (by === "priority") return (rank[a.priority] ?? 3)-(rank[b.priority] ?? 3) || (planDay(a)||"9999").localeCompare(planDay(b)||"9999");
    return (planDay(a)||"9999").localeCompare(planDay(b)||"9999") || (rank[a.priority] ?? 3)-(rank[b.priority] ?? 3);
  });
}
