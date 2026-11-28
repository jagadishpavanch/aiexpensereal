import { describe, expect, it } from "vitest";
import { balances, computeShares, splitSummary } from "./splits";
import type { Split } from "./types";

const paise = (r: { shares: { amount: number }[] }) => r.shares.map((s) => Math.round(s.amount * 100));
const who = (...ids: string[]) => ids.map((personId) => ({ personId }));

describe("computeShares", () => {
  it("equal split of 100 between 3 gives the extra paisa to the first person", () => {
    const r = computeShares(100, "equal", who("me", "a", "b"));
    expect(r.error).toBeUndefined();
    expect(paise(r)).toEqual([3334, 3333, 3333]);
  });

  it("shares in a clean ratio are exact even when the decimals are not representable in floating point", () => {
    // 1.3 : 3.9 is exactly 1 : 3, so 122.92 splits into 30.73 and 92.19.
    const r = computeShares(122.92, "shares", [{ personId: "a", value: 1.3 }, { personId: "b", value: 3.9 }]);
    expect(paise(r)).toEqual([3073, 9219]);
  });

  it("shares always add up to the total, whatever the weights", () => {
    for (let k = 1; k <= 300; k++) {
      const total = k * 7.13 + 0.01;
      const r = computeShares(total, "shares", [{ personId: "a", value: 1.1 }, { personId: "b", value: 2.2 }, { personId: "c", value: 0.7 }]);
      expect(paise(r).reduce((a, b) => a + b, 0)).toBe(Math.round(total * 100));
    }
  });

  it("percent must add up to 100", () => {
    expect(computeShares(100, "percent", [{ personId: "a", value: 50 }, { personId: "b", value: 40 }]).error).toMatch(/100/);
    expect(paise(computeShares(100, "percent", [{ personId: "a", value: 33.333 }, { personId: "b", value: 33.333 }, { personId: "c", value: 33.334 }]))).toEqual([3334, 3333, 3333]);
  });

  it("exact amounts off by a rupee are rejected", () => {
    expect(computeShares(100, "exact", [{ personId: "a", value: 50 }, { personId: "b", value: 49 }]).error).toBeTruthy();
    expect(computeShares(100, "exact", [{ personId: "a", value: 50 }, { personId: "b", value: 50 }]).error).toBeUndefined();
  });

  it("exact amounts are stored in whole paise", () => {
    // 10.004 and 89.996 round to 10.00 and 90.00, which is what must be stored.
    const r = computeShares(100, "exact", [{ personId: "a", value: 10.004 }, { personId: "b", value: 89.996 }]);
    expect(r.error).toBeUndefined();
    expect(r.shares.map((s) => s.amount)).toEqual([10, 90]);
  });

  it("a negative exact amount is rejected", () => {
    expect(computeShares(100, "exact", [{ personId: "a", value: -50 }, { personId: "b", value: 150 }]).error).toBeTruthy();
  });
});

describe("balances", () => {
  const sp = (over: Partial<Split>): Split => ({ id: "x", title: "t", total: 0, paidBy: "me", date: "2026-01-01", mode: "equal", shares: [], settled: [], ...over });
  const splits: Split[] = [
    sp({ id: "1", total: 300, paidBy: "me", shares: [{ personId: "me", amount: 100 }, { personId: "a", amount: 100 }, { personId: "b", amount: 100 }] }),
    sp({ id: "2", total: 90, paidBy: "a", shares: [{ personId: "me", amount: 30 }, { personId: "a", amount: 30 }, { personId: "b", amount: 30 }] }),
    sp({ id: "3", total: 50, paidBy: "me", settled: ["b"], shares: [{ personId: "me", amount: 25 }, { personId: "b", amount: 25 }] }),
  ];

  it("nets what each person owes across many splits, ignoring settled shares and debts between others", () => {
    const b = balances(splits);
    expect(b.get("a")).toBe(70); // owes 100, I owe 30
    expect(b.get("b")).toBe(100); // owes 100 on split 1; split 3 is settled; split 2 is between a and b
    expect(splitSummary(splits)).toEqual({ owedToMe: 170, iOwe: 0 });
  });

  it("a person who is owed more than they owe shows as someone I owe", () => {
    expect(balances([splits[1]]).get("a")).toBe(-30);
    expect(splitSummary([splits[1]])).toEqual({ owedToMe: 0, iOwe: 30 });
  });
});
