import { describe, expect, it } from "vitest";
import { billOccurrencesInMonth, buildMonthGrid, entryTimeForDay, istDayKey, shiftMonth } from "./calendar";
import type { Bill, Transaction } from "./types";

// All instants are written with an explicit +05:30 offset so the tests mean the same on any machine.
const at = (iso: string) => `${iso}+05:30`;
const NOW = new Date(at("2026-11-18T10:00:00"));

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(),
  type: "expense",
  amount: 100,
  categoryId: "food",
  accountId: "a",
  merchant: "Swiggy",
  date: at("2026-11-10T12:00:00"),
  source: "manual",
  isDemo: false,
  ...p,
});

const bill = (p: Partial<Bill>): Bill => ({
  id: "b" + Math.random(),
  name: "Rent",
  amount: 1000,
  dueDate: at("2026-11-20T09:00:00"),
  repeat: "monthly",
  categoryId: "rent",
  accountId: "a",
  paidCount: 0,
  ...p,
});

const dayOf = (g: ReturnType<typeof buildMonthGrid>, d: number) => g.days[d - 1];

describe("month grid layout", () => {
  it("starts weeks on Monday: 1 Nov 2026 is a Sunday, so six empty cells precede it", () => {
    const g = buildMonthGrid([], [], 2026, 10, NOW);
    expect(g.weeks[0].slice(0, 6).every((c) => c === null)).toBe(true);
    expect(g.weeks[0][6]?.day).toBe(1);
    expect(g.weeks).toHaveLength(6);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("puts the 1st in the first column when the month starts on a Monday", () => {
    // 1 Jun 2026 is a Monday, and June has 30 days: five full-ish weeks.
    const g = buildMonthGrid([], [], 2026, 5, NOW);
    expect(g.weeks[0][0]?.day).toBe(1);
    expect(g.weeks).toHaveLength(5);
    expect(g.weeks[4].slice(0, 2).map((c) => c?.day)).toEqual([29, 30]);
    expect(g.weeks[4].slice(2).every((c) => c === null)).toBe(true);
  });

  it("handles a 28-day February that fills exactly four weeks", () => {
    // 1 Feb 2027 is a Monday.
    const g = buildMonthGrid([], [], 2027, 1, NOW);
    expect(g.days).toHaveLength(28);
    expect(g.weeks).toHaveLength(4);
    expect(g.weeks.flat().every((c) => c !== null)).toBe(true);
  });

  it("knows leap-year February and month edges", () => {
    const g = buildMonthGrid([], [], 2028, 1, NOW);
    expect(g.days).toHaveLength(29);
    expect(g.days[28].key).toBe("2028-02-29");
    expect(buildMonthGrid([], [], 2026, 11, NOW).days[30].key).toBe("2026-12-31");
  });

  it("marks today in IST", () => {
    const g = buildMonthGrid([], [], 2026, 10, NOW);
    expect(g.days.filter((d) => d.isToday).map((d) => d.day)).toEqual([18]);
    expect(buildMonthGrid([], [], 2026, 9, NOW).days.some((d) => d.isToday)).toBe(false);
  });

  it("shifts months across a year boundary", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });
});

describe("day totals", () => {
  it("sums spending, income and count per day", () => {
    const g = buildMonthGrid(
      [tx({ amount: 300 }), tx({ amount: 200 }), tx({ type: "income", amount: 5000 }), tx({ amount: 50, date: at("2026-11-11T09:00:00") })],
      [], 2026, 10, NOW,
    );
    const d = dayOf(g, 10);
    expect(d).toMatchObject({ spent: 500, income: 5000, count: 3 });
    expect(dayOf(g, 11)).toMatchObject({ spent: 50, income: 0, count: 1 });
    expect(dayOf(g, 12)).toMatchObject({ spent: 0, income: 0, count: 0 });
    expect(g.totals).toMatchObject({ spent: 550, income: 5000 });
    expect(g.maxSpent).toBe(500);
  });

  it("refunds reduce spending", () => {
    const g = buildMonthGrid([tx({ amount: 1000 }), tx({ type: "refund", amount: 400 })], [], 2026, 10, NOW);
    expect(dayOf(g, 10).spent).toBe(600);
    expect(dayOf(g, 10).income).toBe(0);
    expect(dayOf(g, 10).count).toBe(2);
  });

  it("a refund bigger than the day's spending goes below zero but never lifts the intensity scale", () => {
    const g = buildMonthGrid([tx({ type: "refund", amount: 400 })], [], 2026, 10, NOW);
    expect(dayOf(g, 10).spent).toBe(-400);
    expect(g.maxSpent).toBe(1);
  });

  it("ignores transfers in sums and count, but still lists them", () => {
    const g = buildMonthGrid([tx({ type: "transfer", amount: 9000 }), tx({ amount: 20 })], [], 2026, 10, NOW);
    const d = dayOf(g, 10);
    expect(d).toMatchObject({ spent: 20, income: 0, count: 1 });
    expect(d.txs).toHaveLength(2);
    expect(g.totals.spent).toBe(20);
  });

  it("uses IST days: 00:10 IST is the new day, 23:50 IST is still the old one", () => {
    // 2026-11-09T18:40Z is 00:10 IST on the 10th; 2026-11-10T18:20Z is 23:50 IST on the 10th.
    const g = buildMonthGrid(
      [tx({ amount: 1, date: "2026-11-09T18:40:00Z" }), tx({ amount: 2, date: "2026-11-10T18:20:00Z" }), tx({ amount: 4, date: "2026-11-10T18:31:00Z" })],
      [], 2026, 10, NOW,
    );
    expect(dayOf(g, 9).spent).toBe(0);
    expect(dayOf(g, 10).spent).toBe(3);
    expect(dayOf(g, 11).spent).toBe(4);
  });

  it("puts the last second of the month in that month and the next one in the following month", () => {
    const edge = [tx({ amount: 7, date: at("2026-11-30T23:59:59") }), tx({ amount: 9, date: at("2026-12-01T00:00:00") })];
    expect(dayOf(buildMonthGrid(edge, [], 2026, 10, NOW), 30).spent).toBe(7);
    expect(buildMonthGrid(edge, [], 2026, 10, NOW).totals.spent).toBe(7);
    expect(dayOf(buildMonthGrid(edge, [], 2026, 11, NOW), 1).spent).toBe(9);
  });

  it("skips transactions with an unreadable date and lists newest first", () => {
    const g = buildMonthGrid(
      [tx({ date: "not a date" }), tx({ merchant: "early", date: at("2026-11-10T08:00:00") }), tx({ merchant: "late", date: at("2026-11-10T20:00:00") })],
      [], 2026, 10, NOW,
    );
    expect(dayOf(g, 10).txs.map((t) => t.merchant)).toEqual(["late", "early"]);
    expect(g.totals.spent).toBe(200);
  });
});

describe("bills on the calendar", () => {
  it("shows a one-off bill on its day only", () => {
    const b = bill({ repeat: "none", dueDate: at("2026-11-25T09:00:00") });
    const g = buildMonthGrid([], [b], 2026, 10, NOW);
    expect(dayOf(g, 25).bills).toHaveLength(1);
    expect(g.days.flatMap((d) => d.bills)).toHaveLength(1);
    expect(buildMonthGrid([], [b], 2026, 11, NOW).days.flatMap((d) => d.bills)).toHaveLength(0);
  });

  it("repeats a monthly bill in every later month and not before its first due date", () => {
    const b = bill({ dueDate: at("2026-11-20T09:00:00") });
    expect(buildMonthGrid([], [b], 2026, 11, NOW).days.find((d) => d.bills.length)?.key).toBe("2026-12-20");
    expect(buildMonthGrid([], [b], 2027, 4, NOW).days.find((d) => d.bills.length)?.key).toBe("2027-05-20");
    expect(buildMonthGrid([], [b], 2026, 9, NOW).days.flatMap((d) => d.bills)).toHaveLength(0);
  });

  it("repeats a weekly bill on every matching day, including more than four a month", () => {
    // Fridays from 6 Nov 2026: 6, 13, 20, 27.
    const b = bill({ repeat: "weekly", dueDate: at("2026-11-06T09:00:00") });
    const keys = buildMonthGrid([], [b], 2026, 10, NOW).days.filter((d) => d.bills.length).map((d) => d.day);
    expect(keys).toEqual([6, 13, 20, 27]);
    // 1 Jan 2027 is a Friday too: five Fridays in January.
    expect(buildMonthGrid([], [b], 2027, 0, NOW).days.filter((d) => d.bills.length).map((d) => d.day)).toEqual([1, 8, 15, 22, 29]);
  });

  it("keeps the same day of month and clamps in short months, as payBill's advance does", () => {
    const b = bill({ dueDate: at("2026-01-31T09:00:00") });
    const feb = buildMonthGrid([], [b], 2026, 1, NOW).days.filter((d) => d.bills.length).map((d) => d.day);
    expect(feb).toEqual([28]);
    // advance() carries the clamped day forward, so March shows the 28th, exactly what paying would give.
    const mar = buildMonthGrid([], [b], 2026, 2, NOW).days.filter((d) => d.bills.length).map((d) => d.day);
    expect(mar).toEqual([28]);
  });

  it("repeats a yearly bill once a year", () => {
    const b = bill({ repeat: "yearly", dueDate: at("2026-12-05T09:00:00") });
    expect(buildMonthGrid([], [b], 2027, 11, NOW).days.filter((d) => d.bills.length).map((d) => d.day)).toEqual([5]);
    expect(buildMonthGrid([], [b], 2027, 10, NOW).days.flatMap((d) => d.bills)).toHaveLength(0);
  });

  it("flags bills before today as overdue and the rest as due", () => {
    const b = bill({ repeat: "weekly", dueDate: at("2026-11-06T09:00:00") });
    const g = buildMonthGrid([], [b], 2026, 10, NOW);
    expect(dayOf(g, 6).bills[0].status).toBe("overdue");
    expect(dayOf(g, 13).bills[0].status).toBe("overdue");
    expect(dayOf(g, 20).bills[0].status).toBe("due");
    expect(g.totals).toMatchObject({ billsDue: 4000, overdue: 2000 });
  });

  it("a bill due today is due, not overdue, even if its time has passed", () => {
    const b = bill({ repeat: "none", dueDate: at("2026-11-18T09:00:00") });
    expect(dayOf(buildMonthGrid([], [b], 2026, 10, NOW), 18).bills[0].status).toBe("due");
  });

  it("only the occurrence the bill's dueDate points at can be settled", () => {
    const b = bill({ dueDate: at("2026-11-20T09:00:00") });
    expect(dayOf(buildMonthGrid([], [b], 2026, 10, NOW), 20).bills[0].isNext).toBe(true);
    expect(buildMonthGrid([], [b], 2026, 11, NOW).days.find((d) => d.bills.length)?.bills[0].isNext).toBe(false);
  });

  it("shows a paid one-off bill as paid and leaves it out of the amount due", () => {
    const b = bill({ repeat: "none", done: true, paidCount: 1, dueDate: at("2026-11-05T09:00:00") });
    const g = buildMonthGrid([], [b], 2026, 10, NOW);
    expect(dayOf(g, 5).bills[0].status).toBe("paid");
    expect(g.totals.billsDue).toBe(0);
  });

  it("shows the periods a repeating bill has already paid as paid", () => {
    // Paid twice, next due 20 Nov: the 20 Oct and 20 Sep are the paid ones.
    const b = bill({ dueDate: at("2026-11-20T09:00:00"), paidCount: 2 });
    const oct = buildMonthGrid([], [b], 2026, 9, NOW).days.filter((d) => d.bills.length);
    expect(oct.map((d) => [d.day, d.bills[0].status])).toEqual([[20, "paid"]]);
    expect(buildMonthGrid([], [b], 2026, 8, NOW).days.find((d) => d.bills.length)?.bills[0].status).toBe("paid");
    expect(buildMonthGrid([], [b], 2026, 7, NOW).days.flatMap((d) => d.bills)).toHaveLength(0);
  });

  it("uses the IST day of the due date, not the device's", () => {
    // 2026-11-19T18:45Z is 00:15 IST on the 20th.
    const b = bill({ repeat: "none", dueDate: "2026-11-19T18:45:00Z" });
    const g = buildMonthGrid([], [b], 2026, 10, NOW);
    expect(dayOf(g, 20).bills).toHaveLength(1);
    expect(dayOf(g, 19).bills).toHaveLength(0);
  });

  it("ignores a bill with an unreadable date", () => {
    expect(billOccurrencesInMonth([bill({ dueDate: "nope" })], 2026, 10, NOW)).toEqual([]);
  });
});

describe("day keys and entry times", () => {
  it("names the IST day of an instant", () => {
    expect(istDayKey("2026-11-09T18:40:00Z")).toBe("2026-11-10");
    expect(istDayKey("2026-11-10T18:29:59Z")).toBe("2026-11-10");
    expect(istDayKey("garbage")).toBe("");
  });

  it("prefills the current time for today and noon IST for any other day", () => {
    expect(entryTimeForDay("2026-11-18", NOW)).toBe(NOW.toISOString());
    expect(entryTimeForDay("2026-11-25", NOW)).toBe("2026-11-25T06:30:00.000Z");
    expect(istDayKey(entryTimeForDay("2026-12-01", NOW))).toBe("2026-12-01");
  });
});
