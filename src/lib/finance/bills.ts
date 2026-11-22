import type { Bill, Repeat } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Advance a due date by one repeat period, keeping the day of month where possible. */
export function advance(iso: string, repeat: Repeat): string {
  const d = new Date(iso);
  if (repeat === "weekly") return new Date(d.getTime() + 7 * DAY).toISOString();
  if (repeat === "monthly" || repeat === "yearly") {
    const months = repeat === "monthly" ? 1 : 12;
    const day = d.getDate();
    const n = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes());
    const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(day, last));
    return n.toISOString();
  }
  return iso;
}

/** Whole days until due; negative when overdue. */
export function daysUntil(bill: Pick<Bill, "dueDate">, now = new Date()) {
  return Math.round((startOfDay(new Date(bill.dueDate)).getTime() - startOfDay(now).getTime()) / DAY);
}

export function billState(bill: Bill, now = new Date()): "paid" | "overdue" | "today" | "soon" | "later" {
  if (bill.done) return "paid";
  const d = daysUntil(bill, now);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "soon";
  return "later";
}

/** Bills due within `days` (including overdue), soonest first. */
export function dueSoon(bills: Bill[], now = new Date(), days = 7) {
  return bills
    .filter((b) => !b.done && daysUntil(b, now) <= days)
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
}

/** All due dates of a bill falling inside the given month (projects repeats forward). */
export function occurrencesInMonth(bill: Bill, year: number, month: number): number[] {
  if (bill.done) return [];
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const out: number[] = [];
  let iso = bill.dueDate;
  for (let i = 0; i < 60; i++) {
    const d = new Date(iso);
    if (d >= end) break;
    if (d >= start) out.push(d.getDate());
    if (bill.repeat === "none") break;
    iso = advance(iso, bill.repeat);
  }
  return out;
}

/** Total of unpaid bills due in the given month. */
export function monthBillsTotal(bills: Bill[], year: number, month: number) {
  return bills.reduce((s, b) => s + occurrencesInMonth(b, year, month).length * b.amount, 0);
}
