import { describe, expect, it } from "vitest";
import { balances, computeShares, splitSummary } from "./splits";
import { advance, daysUntil, dueSoon, occurrencesInMonth } from "./bills";
import { cashbackTotals } from "./cashback";
import { isFinanceAlert, parseAlert } from "./sms-parse";
import type { Bill, Split, Transaction } from "./types";

describe("splits", () => {
  it("splits ₹100 equally between 3 people to the paisa", () => {
    const { shares } = computeShares(100, "equal", [{ personId: "me" }, { personId: "a" }, { personId: "b" }]);
    expect(shares.map((s) => s.amount)).toEqual([33.34, 33.33, 33.33]);
  });
  it("splits by percent", () => {
    const { shares } = computeShares(1000, "percent", [{ personId: "me", value: 60 }, { personId: "a", value: 40 }]);
    expect(shares.map((s) => s.amount)).toEqual([600, 400]);
  });
  it("rejects percentages that do not add up to 100", () => {
    expect(computeShares(1000, "percent", [{ personId: "me", value: 50 }, { personId: "a", value: 40 }]).error).toBeTruthy();
  });
  it("rejects exact amounts that do not add up", () => {
    expect(computeShares(500, "exact", [{ personId: "me", value: 200 }, { personId: "a", value: 200 }]).error).toBeTruthy();
  });
  it("splits by shares 2:1", () => {
    const { shares } = computeShares(900, "shares", [{ personId: "me", value: 2 }, { personId: "a", value: 1 }]);
    expect(shares.map((s) => s.amount)).toEqual([600, 300]);
  });
  it("works out who owes whom and ignores settled shares", () => {
    const splits: Split[] = [
      { id: "1", title: "Dinner", total: 1200, paidBy: "me", date: "", mode: "equal", settled: [], shares: [{ personId: "me", amount: 400 }, { personId: "a", amount: 400 }, { personId: "b", amount: 400 }] },
      { id: "2", title: "Cab", total: 300, paidBy: "a", date: "", mode: "equal", settled: [], shares: [{ personId: "me", amount: 150 }, { personId: "a", amount: 150 }] },
      { id: "3", title: "Movie", total: 600, paidBy: "me", date: "", mode: "equal", settled: ["b"], shares: [{ personId: "me", amount: 300 }, { personId: "b", amount: 300 }] },
    ];
    const b = balances(splits);
    expect(b.get("a")).toBe(250);
    expect(b.get("b")).toBe(400);
    expect(splitSummary(splits)).toEqual({ owedToMe: 650, iOwe: 0 });
  });
});

describe("bills", () => {
  it("moves a monthly bill on 31 Jan to the last day of February", () => {
    expect(new Date(advance(new Date(2026, 0, 31, 9).toISOString(), "monthly")).getDate()).toBe(28);
  });
  it("counts days until due and overdue", () => {
    const now = new Date(2026, 9, 22, 18);
    expect(daysUntil({ dueDate: new Date(2026, 9, 25).toISOString() }, now)).toBe(3);
    expect(daysUntil({ dueDate: new Date(2026, 9, 20).toISOString() }, now)).toBe(-2);
  });
  it("lists weekly occurrences inside a month and due-soon bills", () => {
    const bill: Bill = { id: "x", name: "Maid", amount: 500, dueDate: new Date(2026, 9, 3, 9).toISOString(), repeat: "weekly", categoryId: "bills", accountId: "cash", paidCount: 0 };
    expect(occurrencesInMonth(bill, 2026, 9)).toEqual([3, 10, 17, 24, 31]);
    expect(dueSoon([bill], new Date(2026, 9, 1)).length).toBe(1);
    expect(dueSoon([bill], new Date(2026, 8, 1)).length).toBe(0);
  });
});

describe("cashback", () => {
  it("totals only income marked as cashback, by month, year and source", () => {
    const now = new Date(2026, 9, 22);
    const tx = (d: Date, amount: number, extra: Partial<Transaction>): Transaction => ({ id: String(Math.random()), type: "income", amount, categoryId: "other", accountId: "upi", merchant: "x", date: d.toISOString(), source: "manual", isDemo: false, ...extra });
    const r = cashbackTotals([
      tx(new Date(2026, 9, 5), 50, { cashback: true, cashbackSource: "Google Pay" }),
      tx(new Date(2026, 9, 6), 25, { cashback: true, cashbackSource: "PhonePe" }),
      tx(new Date(2026, 5, 6), 100, { cashback: true, cashbackSource: "Google Pay" }),
      tx(new Date(2026, 9, 7), 9999, {}),
    ], now);
    expect(r.month).toBe(75);
    expect(r.year).toBe(175);
    expect(r.bySource[0]).toEqual({ source: "Google Pay", amount: 150 });
  });
});

describe("alert reader", () => {
  it("reads a UPI debit", () => {
    const p = parseAlert("Rs.452.00 debited from A/c XX4821 on 21-10-26 to VPA swiggy@icici (UPI Ref 629104837122).");
    expect(p).toMatchObject({ kind: "expense", amount: 452, last4: "4821", merchant: "Swiggy", isUpi: true });
  });
  it("reads a salary credit with Indian commas", () => {
    expect(parseAlert("INR 92,000.00 credited to A/c XX4821 on 01-10-26 by NEFT from ACME LABS PVT LTD.")).toMatchObject({ kind: "income", amount: 92000 });
  });
  it("reads a card bill with a due date", () => {
    const p = parseAlert("Your ICICI Credit Card XX9012 statement: Total due Rs 18,240.50. Due date 05-Nov-26. Min due Rs 920.");
    expect(p?.kind).toBe("bill");
    expect(p?.amount).toBe(18240.5);
    expect(new Date(p!.dueDate!).getDate()).toBe(5);
  });
  it("ignores non-money messages", () => {
    expect(isFinanceAlert("Your OTP is 482913. Do not share it.")).toBe(false);
    expect(isFinanceAlert("Hey are we meeting at 7?")).toBe(false);
  });
});
