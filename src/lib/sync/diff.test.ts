import { describe, expect, it } from "vitest";
import { demoState } from "@/lib/finance/demo";
import { diffState, toChanges } from "./diff";

const base = demoState(new Date(2026, 10, 25));

describe("diffState", () => {
  it("finds nothing when state is the same object", () => {
    expect(diffState(base, base)).toEqual([]);
  });
  it("reports only the edited transaction", () => {
    const [first, ...rest] = base.transactions;
    const edited = { ...first, amount: first.amount + 1 };
    const changes = diffState(base, { ...base, transactions: [edited, ...rest] });
    expect(changes).toEqual([{ collection: "transactions", id: first.id, data: edited }]);
  });
  it("reports a removed record as data null", () => {
    const changes = diffState(base, { ...base, goals: base.goals.slice(1) });
    expect(changes).toEqual([{ collection: "goals", id: base.goals[0].id, data: null }]);
  });
  it("syncs prefs without the device lock", () => {
    const changes = diffState(base, { ...base, prefs: { ...base.prefs, name: "Meera" } });
    expect(changes).toHaveLength(1);
    expect(changes[0].collection).toBe("prefs");
    expect(changes[0].data).toMatchObject({ name: "Meera" });
    expect(changes[0].data).not.toHaveProperty("lock");
  });
  it("ignores a lock-only prefs change", () => {
    const next = { ...base, prefs: { ...base.prefs, lock: { idleMinutes: 1, pinHash: "x" } } };
    expect(diffState(base, next)).toEqual([]);
  });
  it("snapshots every record plus prefs", () => {
    const all = toChanges(base);
    expect(all.filter((c) => c.collection === "transactions")).toHaveLength(base.transactions.length);
    expect(all.at(-1)).toMatchObject({ collection: "prefs", id: "prefs" });
  });
});
