import { describe, expect, it } from "vitest";
import { formatINR } from "./finance/format";
import { barCue, burstParticles, digitsByKey, rollCells } from "./motion-cues";

describe("rollCells", () => {
  it("marks digits and keeps separators static", () => {
    const cells = rollCells(formatINR(123456));
    expect(cells.map((c) => c.char).join("")).toBe("₹1,23,456");
    expect(cells.filter((c) => c.digit !== null).map((c) => c.digit)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cells.filter((c) => c.digit === null).map((c) => c.char)).toEqual(["₹", ",", ","]);
  });

  it("keeps each digit's key when the number gains a column", () => {
    const before = rollCells(formatINR(9999));
    const after = rollCells(formatINR(10000));
    const keyOf = (cells: ReturnType<typeof rollCells>, fromRight: number) => cells.filter((c) => c.digit !== null).reverse()[fromRight].key;
    for (let i = 0; i < 4; i++) expect(keyOf(after, i)).toBe(keyOf(before, i));
    expect(after.filter((c) => c.digit !== null)).toHaveLength(5);
  });

  it("never gives a separator the same key as a digit across Indian grouping changes", () => {
    const digitKeys = new Set(rollCells(formatINR(1234567)).filter((c) => c.digit !== null).map((c) => c.key));
    for (const n of [999, 99999, 100000, 9999999]) {
      for (const c of rollCells(formatINR(n))) if (c.digit === null) expect(digitKeys.has(c.key)).toBe(false);
    }
  });

  it("handles negatives and decimals", () => {
    const cells = rollCells(formatINR(-1234.5, { decimals: true }));
    expect(cells.map((c) => c.char).join("")).toBe(formatINR(-1234.5, { decimals: true }));
    expect(cells.filter((c) => c.digit !== null).map((c) => c.digit)).toEqual([1, 2, 3, 4, 5, 0]);
  });
});

describe("digitsByKey", () => {
  it("maps column keys to digits", () => {
    const m = digitsByKey(formatINR(4250));
    expect([...m.values()]).toEqual([4, 2, 5, 0]);
    expect(m.get(rollCells(formatINR(4250)).at(-1)!.key)).toBe(0);
  });
});

describe("barCue", () => {
  it("shakes only when a live change crosses into over", () => {
    expect(barCue("ok", "over")).toBe("shake");
    expect(barCue("near", "over")).toBe("shake");
    expect(barCue(undefined, "over")).toBeNull();
    expect(barCue("over", "over")).toBeNull();
  });

  it("pulses on reaching near, including on mount", () => {
    expect(barCue(undefined, "near")).toBe("pulse");
    expect(barCue("ok", "near")).toBe("pulse");
    expect(barCue("over", "near")).toBe("pulse");
    expect(barCue("near", "near")).toBeNull();
  });

  it("stays quiet for ok", () => {
    expect(barCue(undefined, "ok")).toBeNull();
    expect(barCue("over", "ok")).toBeNull();
  });
});

describe("burstParticles", () => {
  it("is deterministic and sized as asked", () => {
    expect(burstParticles(24, 4)).toEqual(burstParticles(24, 4));
    expect(burstParticles(24, 4)).toHaveLength(24);
  });

  it("fans upward, then falls below the origin", () => {
    for (const p of burstParticles(40, 3)) {
      expect(p.peak).toBeLessThan(0);
      expect(p.fall).toBeGreaterThan(0);
      expect(p.tone).toBeGreaterThanOrEqual(0);
      expect(p.tone).toBeLessThan(3);
    }
  });

  it("spreads to both sides", () => {
    const xs = burstParticles(40, 3).map((p) => p.dx);
    expect(Math.min(...xs)).toBeLessThan(-50);
    expect(Math.max(...xs)).toBeGreaterThan(50);
  });
});
