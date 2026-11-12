import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  isSameMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";

export const todayISO = () => format(new Date(), "yyyy-MM-dd");
export const monthKey = (d: Date | string = new Date()) =>
  format(typeof d === "string" ? parseISO(d) : d, "yyyy-MM");
export const monthLabel = (key: string, short = false) => {
  const d = parseISO(`${key}-01`);
  return format(d, short ? "MMM" : "MMMM yyyy");
};
export const fmtDate = (iso: string, pattern = "d MMM") => {
  if (!iso) return "—";
  return format(parseISO(iso), pattern);
};
export const fmtDateLong = (iso: string) => format(parseISO(iso), "d MMM yyyy");
export const fmtDateTime = (iso: string) => format(parseISO(iso), "d MMM, h:mm a");

export const daysInMonth = (d: Date = new Date()) => endOfMonth(d).getDate();
export const daysLeftInMonth = (d: Date = new Date()) =>
  Math.max(1, differenceInCalendarDays(endOfMonth(d), d) + 1);
export const dayOfMonth = (d: Date = new Date()) => d.getDate();

export const previousMonthKey = (key: string) => monthKey(subMonths(parseISO(`${key}-01`), 1));
export const nextMonthKey = (key: string) => monthKey(addMonths(parseISO(`${key}-01`), 1));

export function monthRange(key: string) {
  const start = parseISO(`${key}-01`);
  return { start, end: endOfMonth(start) };
}

export function lastNMonths(n: number, from: Date = new Date()) {
  return Array.from({ length: n }, (_, i) => monthKey(subMonths(from, n - 1 - i)));
}

export function inMonth(iso: string, key: string) {
  return iso.startsWith(key);
}

export function isOverdueDate(iso: string) {
  const d = parseISO(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return isBefore(d, today);
}

export function daysUntil(iso: string) {
  const d = parseISO(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return differenceInCalendarDays(d, today);
}

export function monthDays(key: string) {
  const { start, end } = monthRange(key);
  return eachDayOfInterval({ start, end });
}

export function isCurrentMonth(key: string) {
  return isSameMonth(parseISO(`${key}-01`), new Date());
}

export function nextOccurrence(day: number, from: Date = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), Math.min(day, 28));
  if (base.getTime() < new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) {
    return new Date(from.getFullYear(), from.getMonth() + 1, Math.min(day, 28));
  }
  return base;
}

export function addDaysISO(iso: string, days: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
}

export function addMonthsISO(iso: string, months: number) {
  return format(addMonths(parseISO(iso), months), "yyyy-MM-dd");
}

export function relativeDue(iso: string) {
  const d = daysUntil(iso);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < 0) return `${Math.abs(d)} days overdue`;
  return `in ${d} days`;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export { parseISO, format, startOfMonth, endOfMonth, subMonths, addMonths };
