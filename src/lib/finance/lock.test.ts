import { beforeEach, describe, expect, it } from "vitest";
import { clearPinFails, FREE_TRIES, pinLockedUntil, pinWaitMs, recordPinFail } from "./lock";

describe("pinWaitMs", () => {
  it("lets the first five wrong PINs through, then waits 30 s doubling up to 15 min", () => {
    for (let i = 0; i < FREE_TRIES; i++) expect(pinWaitMs(i)).toBe(0);
    expect(pinWaitMs(5)).toBe(30_000);
    expect(pinWaitMs(6)).toBe(60_000);
    expect(pinWaitMs(7)).toBe(120_000);
    expect(pinWaitMs(20)).toBe(15 * 60_000);
  });
});

describe("wrong-PIN count", () => {
  beforeEach(() => clearPinFails());

  it("starts making you wait after the fifth wrong PIN and survives a reload", () => {
    for (let i = 0; i < 4; i++) recordPinFail();
    expect(pinLockedUntil()).toBe(0);
    const until = recordPinFail();
    expect(until).toBeGreaterThan(Date.now());
    expect(pinLockedUntil()).toBe(until);
  });

  it("a right PIN clears the count", () => {
    for (let i = 0; i < 6; i++) recordPinFail();
    clearPinFails();
    expect(pinLockedUntil()).toBe(0);
  });
});
