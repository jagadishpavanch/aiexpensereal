import { describe, expect, it } from "vitest";
import { budgetStatus, isDuplicate, totals } from "./calc";
import { formatINR } from "./format";
import { parseCSV } from "./csv";
import type { Transaction } from "./types";

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(),
  type: "expense",
  amount: 100,
  categoryId: "food",
  accountId: "a",
  merchant: "Swiggy",
  date: new Date(2026, 9, 10, 12).toISOString(),
  source: "manual",
  isDemo: false,
  ...p,
});

describe("finance rules", () => {
  it("refunds reduce spending and transfers are ignored", () => {
    const t = totals([tx({ amount: 1000 }), tx({ type: "refund", amount: 200 }), tx({ type: "transfer", amount: 5000 }), tx({ type: "income", amount: 50000 })]);
    expect(t.spent).toBe(800);
    expect(t.income).toBe(50000);
    expect(t.net).toBe(49200);
  });

  it("budget is 'near' at 80% and 'over' at 100%", () => {
    const b = { id: "b", categoryId: "food", limit: 1000 };
    expect(budgetStatus(b, [tx({ amount: 800 })]).state).toBe("near");
    expect(budgetStatus(b, [tx({ amount: 1000 })]).state).toBe("over");
    expect(budgetStatus(b, [tx({ amount: 500 })]).state).toBe("ok");
  });

  it("formats rupees in Indian grouping", () => {
    expect(formatINR(123456)).toBe("₹1,23,456");
  });

  it("flags same merchant and amount within two minutes as duplicate", () => {
    const base = tx({});
    const near = { amount: 100, merchant: "swiggy ", date: new Date(new Date(base.date).getTime() + 60000).toISOString() };
    const far = { ...near, date: new Date(new Date(base.date).getTime() + 10 * 60000).toISOString() };
    expect(isDuplicate(near, [base])).toBe(true);
    expect(isDuplicate(far, [base])).toBe(false);
  });

  it("parses CSV rows and reports bad ones", () => {
    const r = parseCSV("date,amount,merchant,type,category\n2026-10-01,250,Zomato,expense,food\nbad,x,,expense,food");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(250);
    expect(r.errors).toHaveLength(1);
  });
});
