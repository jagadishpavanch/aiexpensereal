import { spendOf } from "./calc";
import type { Bill, Repeat, Transaction } from "./types";

/**
 * Month grid for the money calendar. Every date is an Asia/Kolkata calendar day, so a
 * transaction at 00:10 IST belongs to that IST day on any device, and the grid is the same
 * whatever time zone the machine running it is set to. IST has no daylight saving, so
 * "+5:30" is exact.
 */
const IST_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day, "YYYY-MM-DD" (month is 1-12). */
export type DayKey = string;

interface Parts { y: number; m: number; d: number; h: number; min: number }

/** Wall-clock parts of an instant in IST (m is 0-11 here). */
function istParts(ms: number): Parts {
  const x = new Date(ms + IST_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes() };
}

/** The instant of an IST wall-clock time. Month and day may overflow, as in Date.UTC. */
function fromIst(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m, d, h, min) - IST_MS;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export function keyOf(y: number, m: number, d: number): DayKey {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** IST calendar day of an ISO string or Date; "" when the date is invalid. */
export function istDayKey(at: string | Date): DayKey {
  const ms = typeof at === "string" ? Date.parse(at) : at.getTime();
  if (Number.isNaN(ms)) return "";
  const p = istParts(ms);
  return keyOf(p.y, p.m, p.d);
}

/** The month (0-11) and year containing `at` in IST. */
export function istMonthOf(at: Date = new Date()): { year: number; month: number } {
  const p = istParts(at.getTime());
  return { year: p.y, month: p.m };
}

/** The month before or after (delta can be negative). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const t = year * 12 + month + delta;
  return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 };
}

/**
 * The instant to prefill when adding something on a calendar day: the current time for today,
 * noon IST for any other day (so no time zone can push it onto a neighbouring date).
 */
export function entryTimeForDay(key: DayKey, now: Date = new Date()): string {
  if (key === istDayKey(now)) return now.toISOString();
  const [y, m, d] = key.split("-").map(Number);
  return new Date(fromIst(y, m - 1, d, 12)).toISOString();
}

/** One step of a repeat, matching `advance` in bills.ts (the day of month survives except where a month is short). */
function stepForward(ms: number, repeat: Repeat): number {
  const p = istParts(ms);
  if (repeat === "weekly") return ms + 7 * DAY_MS;
  if (repeat === "monthly" || repeat === "yearly") {
    const months = repeat === "monthly" ? 1 : 12;
    const t = shiftMonth(p.y, p.m, months);
    return fromIst(t.year, t.month, Math.min(p.d, daysInMonth(t.year, t.month)), p.h, p.min);
  }
  return ms;
}

/** `n` periods before a due date, keeping the original day of month where the month is long enough. */
function stepBack(ms: number, repeat: Repeat, n: number): number {
  if (repeat === "weekly") return ms - 7 * n * DAY_MS;
  const p = istParts(ms);
  const t = shiftMonth(p.y, p.m, -n * (repeat === "yearly" ? 12 : 1));
  return fromIst(t.year, t.month, Math.min(p.d, daysInMonth(t.year, t.month)), p.h, p.min);
}

export type BillStatus = "paid" | "overdue" | "due";

export interface CalendarBill {
  bill: Bill;
  /** The day this occurrence falls on. */
  key: DayKey;
  /** paid: already settled. overdue: due before today and not paid. due: due today or later. */
  status: BillStatus;
  /** True for the occurrence the bill's `dueDate` points at, the only one `payBill` can settle. */
  isNext: boolean;
}

/**
 * Every occurrence of the bills inside a month. A bill's `dueDate` is its next unpaid due, so
 * from that date on it repeats forward and anything before today is overdue. A repeating bill's
 * `paidCount` earlier periods are shown as paid. A paid one-off bill stays on its day as paid.
 */
export function billOccurrencesInMonth(bills: Bill[], year: number, month: number, now: Date = new Date()): CalendarBill[] {
  const today = istDayKey(now);
  const first = keyOf(year, month, 1);
  const last = keyOf(year, month, daysInMonth(year, month));
  const inRange = (k: DayKey) => k >= first && k <= last;
  const out: CalendarBill[] = [];

  for (const bill of bills) {
    const start = Date.parse(bill.dueDate);
    if (Number.isNaN(start)) continue;
    const startKey = istDayKey(new Date(start));

    if (bill.done) {
      if (inRange(startKey)) out.push({ bill, key: startKey, status: "paid", isNext: false });
      continue;
    }

    if (bill.repeat !== "none") {
      const back = Math.min(Math.max(0, bill.paidCount || 0), 36);
      for (let i = 1; i <= back; i++) {
        const k = istDayKey(new Date(stepBack(start, bill.repeat, i)));
        if (inRange(k)) out.push({ bill, key: k, status: "paid", isNext: false });
      }
    }

    let ms = start;
    for (let i = 0; i < 6000; i++) {
      const k = istDayKey(new Date(ms));
      if (k > last) break;
      if (inRange(k)) out.push({ bill, key: k, status: k < today ? "overdue" : "due", isNext: i === 0 });
      if (bill.repeat === "none") break;
      ms = stepForward(ms, bill.repeat);
    }
  }
  return out;
}

export interface CalendarDay {
  key: DayKey;
  /** Day of the month, 1-31. */
  day: number;
  isToday: boolean;
  /** Net spending: expenses minus refunds (can be below zero). Transfers are ignored. */
  spent: number;
  income: number;
  /** Transactions other than transfers. */
  count: number;
  /** Everything that happened on the day, newest first, transfers included for listing. */
  txs: Transaction[];
  bills: CalendarBill[];
}

export interface MonthGrid {
  year: number;
  month: number;
  /** Weeks start on Monday. Cells before the 1st and after the last day are null. */
  weeks: (CalendarDay | null)[][];
  /** The month's days in order. */
  days: CalendarDay[];
  /** Largest positive day spend, at least 1 so it can be a divisor. */
  maxSpent: number;
  totals: { spent: number; income: number; billsDue: number; overdue: number };
}

/**
 * The calendar for a month: per day, spending, income, transaction count and the bills due.
 * Transfers are ignored in the sums and the count, refunds reduce spending.
 */
export function buildMonthGrid(txs: Transaction[], bills: Bill[], year: number, month: number, now: Date = new Date()): MonthGrid {
  const count = daysInMonth(year, month);
  const today = istDayKey(now);
  const days: CalendarDay[] = Array.from({ length: count }, (_, i) => ({
    key: keyOf(year, month, i + 1), day: i + 1, isToday: false, spent: 0, income: 0, count: 0, txs: [], bills: [],
  }));
  for (const d of days) d.isToday = d.key === today;

  const prefix = `${year}-${pad(month + 1)}-`;
  for (const t of txs) {
    const k = istDayKey(t.date);
    if (!k.startsWith(prefix)) continue;
    const day = days[Number(k.slice(8)) - 1];
    day.txs.push(t);
    if (t.type === "transfer") continue;
    day.count += 1;
    day.spent += spendOf(t);
    if (t.type === "income") day.income += t.amount;
  }
  for (const d of days) d.txs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  let billsDue = 0;
  let overdue = 0;
  for (const o of billOccurrencesInMonth(bills, year, month, now)) {
    days[Number(o.key.slice(8)) - 1].bills.push(o);
    if (o.status === "paid") continue;
    billsDue += o.bill.amount;
    if (o.status === "overdue") overdue += o.bill.amount;
  }

  // Monday = 0: JS Sunday = 0, so shift by six.
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const totalsOf = days.reduce((a, d) => ({ spent: a.spent + d.spent, income: a.income + d.income }), { spent: 0, income: 0 });
  return {
    year, month, weeks, days,
    maxSpent: Math.max(1, ...days.map((d) => d.spent)),
    totals: { ...totalsOf, billsDue, overdue },
  };
}
