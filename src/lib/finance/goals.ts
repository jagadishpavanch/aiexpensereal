import type { Goal } from "./types";

/** True when the goal is reached (saved at or past the target). */
export function isGoalReached(g: Pick<Goal, "saved" | "target">) {
  return g.target > 0 && g.saved >= g.target;
}

/** True when adding `amount` is the contribution that reaches the goal. */
export function completesGoal(g: Pick<Goal, "saved" | "target">, amount: number) {
  return !isGoalReached(g) && amount > 0 && isGoalReached({ saved: g.saved + amount, target: g.target });
}
