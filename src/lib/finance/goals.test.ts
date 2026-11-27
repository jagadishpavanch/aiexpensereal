import { describe, expect, it } from "vitest";
import { completesGoal, isGoalReached } from "./goals";

describe("goals", () => {
  it("knows when a goal is reached", () => {
    expect(isGoalReached({ saved: 999, target: 1000 })).toBe(false);
    expect(isGoalReached({ saved: 1000, target: 1000 })).toBe(true);
    expect(isGoalReached({ saved: 0, target: 0 })).toBe(false);
  });

  it("flags only the contribution that crosses the target", () => {
    expect(completesGoal({ saved: 900, target: 1000 }, 100)).toBe(true);
    expect(completesGoal({ saved: 900, target: 1000 }, 500)).toBe(true);
    expect(completesGoal({ saved: 900, target: 1000 }, 99)).toBe(false);
  });

  it("does not celebrate a goal that was already reached", () => {
    expect(completesGoal({ saved: 1000, target: 1000 }, 500)).toBe(false);
    expect(completesGoal({ saved: 1000, target: 1000 }, 0)).toBe(false);
  });
});
