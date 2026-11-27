import { describe, expect, it } from "vitest";
import { demoState } from "@/lib/finance/demo";
import { applyRows, type RemoteRow } from "./merge";
import { enqueue } from "./outbox";

const base = demoState(new Date(2026, 10, 25));
const row = (p: Partial<RemoteRow>): RemoteRow => ({ collection: "goals", id: "x", data: null, deleted: false, updated_at: "2026-11-25T00:00:00Z", ...p });

describe("applyRows", () => {
  it("updates a record in place, keeping list order", () => {
    const g = base.goals[1];
    const next = applyRows(base, [row({ id: g.id, data: { ...g, saved: 1 } })], {});
    expect(next.goals.map((x) => x.id)).toEqual(base.goals.map((x) => x.id));
    expect(next.goals[1].saved).toBe(1);
  });
  it("adds new records and removes tombstoned ones", () => {
    const gone = base.goals[0].id;
    const added = { id: "new", name: "Bike", target: 1, saved: 0, emoji: "🚲" };
    const next = applyRows(base, [row({ id: gone, deleted: true }), row({ id: "new", data: added })], {});
    expect(next.goals.some((x) => x.id === gone)).toBe(false);
    expect(next.goals.at(-1)).toEqual(added);
  });
  it("skips rows for records with an unpushed local change", () => {
    const g = base.goals[0];
    const pending = enqueue({}, [{ collection: "goals", id: g.id, data: { ...g } }]);
    const next = applyRows(base, [row({ id: g.id, data: { ...g, saved: 999 } })], pending);
    expect(next.goals[0].saved).toBe(g.saved);
  });
  it("keeps this device's lock and fills missing feature flags", () => {
    const s = { ...base, prefs: { ...base.prefs, lock: { idleMinutes: 2, pinHash: "h" } } };
    const next = applyRows(s, [row({ collection: "prefs", id: "prefs", data: { name: "Meera", features: { splits: false } } })], {});
    expect(next.prefs.name).toBe("Meera");
    expect(next.prefs.lock).toEqual({ idleMinutes: 2, pinHash: "h" });
    expect(next.prefs.features.splits).toBe(false);
    expect(next.prefs.features.bills).toBe(true);
  });
  it("a prefs tombstone sends the device back to onboarding", () => {
    const next = applyRows(base, [row({ collection: "prefs", id: "prefs", deleted: true })], {});
    expect(next.prefs.onboarded).toBe(false);
  });
  it("keeps transactions newest first", () => {
    const t = { ...base.transactions[0], id: "future", date: "2099-01-01T00:00:00.000Z" };
    const next = applyRows(base, [row({ collection: "transactions", id: "future", data: t })], {});
    expect(next.transactions[0].id).toBe("future");
  });
  it("returns the same object when nothing applies", () => {
    expect(applyRows(base, [], {})).toBe(base);
  });
});
