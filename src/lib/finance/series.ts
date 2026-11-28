import { spendOf } from "./calc";
import type { Transaction } from "./types";

/** Time series of spending and income for a range, in India Standard Time days. */

export const RANGES = ["7D", "30D", "3M", "1Y", "ALL"] as const;
export type RangeKey = (typeof RANGES)[number];
export type Bucket = "day" | "week" | "month";

export interface SeriesPoint {
  /** Start of the bucket: IST midnight as an ISO instant. */
  date: string;
  /** Last day the bucket covers, as an IST midnight ISO instant (same as `date` for a day). */
  endDate: string;
  /** Net spending (refunds subtract). Can dip below zero if refunds outweigh spending. */
  spent: number;
  income: number;
  /** Spending transactions (expenses and refunds) in the bucket. */
  count: number;
  incomeCount: number;
  /** Time of the latest spending or income transaction in the bucket, if any. */
  lastAt?: string;
}

export interface Series {
  range: RangeKey;
  bucket: Bucket;
  points: SeriesPoint[];
  spent: number;
  income: number;
  count: number;
}

const DAY = 86_400_000;
/** India has a fixed +05:30 offset and no daylight saving. */
const IST_OFFSET = 19_800_000;

/** Whole IST calendar days since 1970-01-01 for an instant. */
export function istDay(ms: number) {
  return Math.floor((ms + IST_OFFSET) / DAY);
}

/** The IST midnight that starts the given day number, as an ISO instant. */
export function istDayStartISO(day: number) {
  return new Date(day * DAY - IST_OFFSET).toISOString();
}

/** Monday of the week containing the day (1970-01-01 was a Thursday). */
function weekStart(day: number) {
  return day - ((day + 3) % 7);
}

function monthParts(day: number) {
  const d = new Date(day * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function monthStart(day: number) {
  const { y, m } = monthParts(day);
  return Math.floor(Date.UTC(y, m, 1) / DAY);
}

function nextMonthStart(day: number) {
  const { y, m } = monthParts(day);
  return Math.floor(Date.UTC(y, m + 1, 1) / DAY);
}

export function bucketFor(range: RangeKey): Bucket {
  return range === "1Y" ? "week" : range === "ALL" ? "month" : "day";
}

/** Day numbers at which each bucket starts, oldest first. */
function bucketStarts(range: RangeKey, today: number, earliest: number | null): number[] {
  const out: number[] = [];
  if (range === "ALL") {
    const first = monthStart(earliest ?? today);
    for (let s = first; s <= today; s = nextMonthStart(s)) out.push(s);
    return out;
  }
  if (range === "1Y") {
    for (let s = weekStart(today - 364); s <= today; s += 7) out.push(s);
    return out;
  }
  const n = range === "7D" ? 7 : range === "30D" ? 30 : 90;
  for (let s = today - n + 1; s <= today; s++) out.push(s);
  return out;
}

/**
 * Spending and income per bucket for a range ending today (IST).
 * 7D, 30D and 3M are daily (7, 30 and 90 days), 1Y is weekly (Monday to Sunday, partial
 * first and last weeks included), All is monthly from the first transaction's month.
 * Transfers are ignored; refunds reduce spending. Transactions dated after today are left out.
 */
export function spendSeries(txs: Transaction[], range: RangeKey = "30D", now = new Date()): Series {
  const today = istDay(now.getTime());
  let earliest: number | null = null;
  if (range === "ALL") {
    for (const t of txs) {
      const d = istDay(new Date(t.date).getTime());
      if (Number.isNaN(d) || d > today) continue;
      if (earliest === null || d < earliest) earliest = d;
    }
  }

  const bucket = bucketFor(range);
  const starts = bucketStarts(range, today, earliest);
  const points: SeriesPoint[] = starts.map((s) => {
    const end = bucket === "day" ? s : bucket === "week" ? s + 6 : nextMonthStart(s) - 1;
    return { date: istDayStartISO(s), endDate: istDayStartISO(Math.min(end, today)), spent: 0, income: 0, count: 0, incomeCount: 0 };
  });
  const index = new Map(starts.map((s, i) => [s, i]));
  const startOf = bucket === "day" ? (d: number) => d : bucket === "week" ? weekStart : monthStart;
  const lastTs: number[] = starts.map(() => -Infinity);

  for (const t of txs) {
    if (t.type === "transfer") continue;
    const ms = new Date(t.date).getTime();
    const d = istDay(ms);
    if (Number.isNaN(d) || d > today) continue;
    const i = index.get(startOf(d));
    if (i === undefined) continue;
    const p = points[i];
    if (t.type === "income") {
      p.income += t.amount;
      p.incomeCount += 1;
    } else {
      p.spent += spendOf(t);
      p.count += 1;
    }
    if (ms > lastTs[i]) lastTs[i] = ms;
  }
  points.forEach((p, i) => {
    if (lastTs[i] > -Infinity) p.lastAt = new Date(lastTs[i]).toISOString();
  });

  return {
    range,
    bucket,
    points,
    spent: points.reduce((s, p) => s + p.spent, 0),
    income: points.reduce((s, p) => s + p.income, 0),
    count: points.reduce((s, p) => s + p.count, 0),
  };
}

/** Change from the first point's value to another's, like the +/- on a stock chart. */
export function changeBetween(from: number, to: number) {
  const delta = to - from;
  return { delta, pct: from === 0 ? null : (delta / Math.abs(from)) * 100 };
}

/** Index of the point nearest a horizontal position, `frac` being 0 (left edge) to 1 (right edge). */
export function pointIndexAt(length: number, frac: number) {
  if (length <= 1) return 0;
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  return Math.round(f * (length - 1));
}
