import { describe, expect, it } from "vitest";
import { computeShares } from "./splits";

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
});
