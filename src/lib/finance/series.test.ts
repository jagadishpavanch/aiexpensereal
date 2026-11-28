import { describe, expect, it } from "vitest";
import { changeBetween, monthSeries, pointIndexAt, spendSeries } from "./series";
import type { Transaction } from "./types";

// Thursday 15 Oct 2026, 15:30 IST
const NOW = new Date("2026-10-15T10:00:00Z");

const tx = (iso: string, p: Partial<Transaction> = {}): Transaction => ({
  id: Math.random().toString(),
  type: "expense",
  amount: 100,
  categoryId: "food",
  accountId: "a",
  merchant: "Swiggy",
  date: iso,
  source: "manual",
  isDemo: false,
  ...p,
});

describe("spendSeries buckets", () => {
  it("7D and 30D are daily with the right number of points, oldest first, ending today", () => {
    const w = spendSeries([], "7D", NOW);
    expect(w.bucket).toBe("day");
    expect(w.points).toHaveLength(7);
    expect(w.points[0].date).toBe("2026-10-08T18:30:00.000Z"); // 9 Oct 00:00 IST
    expect(w.points[6].date).toBe("2026-10-14T18:30:00.000Z"); // 15 Oct 00:00 IST
    expect(spendSeries([], "30D", NOW).points).toHaveLength(30);
    expect(spendSeries([], "3M", NOW).points).toHaveLength(90);
  });

  it("defaults to 30 days", () => {
    expect(spendSeries([], undefined, NOW).range).toBe("30D");
  });

  it("1Y is weekly, Monday to Sunday, with the last week clipped to today", () => {
    const y = spendSeries([], "1Y", NOW);
    expect(y.bucket).toBe("week");
    expect(y.points.length).toBeGreaterThanOrEqual(52);
    expect(y.points.length).toBeLessThanOrEqual(54);
    const last = y.points[y.points.length - 1];
    expect(last.date).toBe("2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    expect(last.endDate).toBe("2026-10-14T18:30:00.000Z"); // clipped to Thu 15 Oct
    const prev = y.points[y.points.length - 2];
    expect(prev.date).toBe("2026-10-04T18:30:00.000Z"); // Mon 5 Oct
    expect(prev.endDate).toBe("2026-10-10T18:30:00.000Z"); // Sun 11 Oct
    // every start is a Monday in IST
    for (const p of y.points) expect(new Date(new Date(p.date).getTime() + 19_800_000).getUTCDay()).toBe(1);
  });

  it("All is monthly from the first transaction's month", () => {
    const s = spendSeries([tx("2026-07-20T09:00:00Z"), tx("2026-10-02T09:00:00Z")], "ALL", NOW);
    expect(s.bucket).toBe("month");
    expect(s.points.map((p) => p.date)).toEqual([
      "2026-06-30T18:30:00.000Z",
      "2026-07-31T18:30:00.000Z",
      "2026-08-31T18:30:00.000Z",
      "2026-09-30T18:30:00.000Z",
    ]);
    expect(s.points[0].spent).toBe(100);
    expect(s.points[0].endDate).toBe("2026-07-30T18:30:00.000Z"); // 31 Jul
    expect(s.points[3].spent).toBe(100);
    expect(s.points[3].endDate).toBe("2026-10-14T18:30:00.000Z"); // clipped to today
  });

  it("All with no transactions is a single current-month point", () => {
    const s = spendSeries([], "ALL", NOW);
    expect(s.points).toHaveLength(1);
    expect(s.points[0].spent).toBe(0);
  });
});

describe("spendSeries totals", () => {
  it("sums spending per day, counts transactions and notes the latest time", () => {
    const s = spendSeries(
      [tx("2026-10-14T05:00:00Z", { amount: 250 }), tx("2026-10-14T13:00:00Z", { amount: 50 }), tx("2026-10-13T05:00:00Z", { amount: 10 })],
      "7D",
      NOW,
    );
    const p = s.points[5]; // 14 Oct
    expect(p.spent).toBe(300);
    expect(p.count).toBe(2);
    expect(p.lastAt).toBe("2026-10-14T13:00:00.000Z");
    expect(s.points[4].spent).toBe(10);
    expect(s.spent).toBe(310);
    expect(s.count).toBe(3);
    expect(s.points[0].lastAt).toBeUndefined();
  });

  it("refunds reduce spending and transfers are ignored", () => {
    const s = spendSeries(
      [
        tx("2026-10-14T05:00:00Z", { amount: 1000 }),
        tx("2026-10-14T06:00:00Z", { type: "refund", amount: 200 }),
        tx("2026-10-14T07:00:00Z", { type: "transfer", amount: 5000 }),
        tx("2026-10-14T08:00:00Z", { type: "income", amount: 50000 }),
      ],
      "7D",
      NOW,
    );
    const p = s.points[5];
    expect(p.spent).toBe(800);
    expect(p.count).toBe(2);
    expect(p.income).toBe(50000);
    expect(p.incomeCount).toBe(1);
    expect(s.income).toBe(50000);
  });

  it("a refund alone dips below zero rather than being hidden", () => {
    const s = spendSeries([tx("2026-10-14T06:00:00Z", { type: "refund", amount: 200 })], "7D", NOW);
    expect(s.points[5].spent).toBe(-200);
  });

  it("a transfer never counts toward a bucket or the latest time", () => {
    const s = spendSeries([tx("2026-10-14T07:00:00Z", { type: "transfer", amount: 5000 })], "7D", NOW);
    expect(s.points[5].count).toBe(0);
    expect(s.points[5].lastAt).toBeUndefined();
  });
});

describe("spendSeries range edges and IST midnight", () => {
  it("splits days at IST midnight, not UTC midnight", () => {
    const s = spendSeries(
      [
        tx("2026-10-14T18:29:59Z", { amount: 1 }), // 23:59:59 IST on 14 Oct
        tx("2026-10-14T18:30:00Z", { amount: 10 }), // 00:00:00 IST on 15 Oct
        tx("2026-10-14T00:00:00Z", { amount: 100 }), // 05:30 IST on 14 Oct (UTC date is also the 14th)
      ],
      "7D",
      NOW,
    );
    expect(s.points[5].spent).toBe(101);
    expect(s.points[6].spent).toBe(10);
  });

  it("includes the first day of the range and drops the day before it", () => {
    const s = spendSeries([tx("2026-10-08T18:30:00Z", { amount: 7 }), tx("2026-10-08T18:29:59Z", { amount: 900 })], "7D", NOW);
    expect(s.points[0].spent).toBe(7);
    expect(s.spent).toBe(7);
  });

  it("includes transactions made later today and drops future ones", () => {
    const s = spendSeries([tx("2026-10-15T15:00:00Z", { amount: 5 }), tx("2026-10-15T18:30:00Z", { amount: 9 })], "7D", NOW);
    // 20:30 IST today is still today (even though it is after `now`); 00:00 IST tomorrow is not.
    expect(s.points[6].spent).toBe(5);
    expect(s.spent).toBe(5);
  });

  it("buckets a week using IST: Sunday night belongs to that week, Monday 00:00 IST to the next", () => {
    const s = spendSeries(
      [tx("2026-10-11T18:29:00Z", { amount: 3 }), tx("2026-10-11T18:30:00Z", { amount: 40 })],
      "1Y",
      NOW,
    );
    const n = s.points.length;
    expect(s.points[n - 2].spent).toBe(3); // week of Mon 5 Oct, Sunday 23:59 IST
    expect(s.points[n - 1].spent).toBe(40); // week of Mon 12 Oct
  });

  it("splits months at IST midnight", () => {
    const s = spendSeries([tx("2026-09-30T18:29:00Z", { amount: 2 }), tx("2026-09-30T18:30:00Z", { amount: 30 })], "ALL", NOW);
    expect(s.points).toHaveLength(2);
    expect(s.points[0].spent).toBe(2); // 30 Sep 23:59 IST
    expect(s.points[1].spent).toBe(30); // 1 Oct 00:00 IST
  });
});

describe("changeBetween and pointIndexAt", () => {
  it("reports the change and percent, with no percent from a zero start", () => {
    expect(changeBetween(200, 300)).toEqual({ delta: 100, pct: 50 });
    expect(changeBetween(200, 100)).toEqual({ delta: -100, pct: -50 });
    expect(changeBetween(0, 100)).toEqual({ delta: 100, pct: null });
  });

  it("maps a horizontal fraction to the nearest point and clamps", () => {
    expect(pointIndexAt(5, 0)).toBe(0);
    expect(pointIndexAt(5, 1)).toBe(4);
    expect(pointIndexAt(5, 0.5)).toBe(2);
    expect(pointIndexAt(5, 0.37)).toBe(1);
    expect(pointIndexAt(5, -3)).toBe(0);
    expect(pointIndexAt(5, 9)).toBe(4);
    expect(pointIndexAt(1, 0.7)).toBe(0);
    expect(pointIndexAt(0, 0.7)).toBe(0);
  });
});

describe("monthSeries", () => {
  it("an earlier month has a point for every day, with that month's spending only", () => {
    const s = monthSeries(
      [tx("2026-02-01T05:00:00Z", { amount: 40 }), tx("2026-02-28T12:00:00Z", { amount: 60 }), tx("2026-03-01T05:00:00Z", { amount: 999 })],
      new Date("2026-02-14T06:00:00Z"),
      NOW,
    );
    expect(s.range).toBe("month");
    expect(s.bucket).toBe("day");
    expect(s.points).toHaveLength(28);
    expect(s.spent).toBe(100);
    expect(s.points[0].spent).toBe(40);
    expect(s.points[27].spent).toBe(60);
  });

  it("the current month stops at today", () => {
    const s = monthSeries([tx("2026-10-15T06:00:00Z", { amount: 25 })], NOW, NOW);
    expect(s.points).toHaveLength(15);
    expect(s.spent).toBe(25);
  });

  it("uses IST month edges: 31 Jan 19:00 UTC is already 1 Feb in India", () => {
    const s = monthSeries([tx("2026-01-31T19:00:00Z", { amount: 70 })], new Date("2026-02-10T06:00:00Z"), NOW);
    expect(s.points[0].spent).toBe(70);
  });
});
