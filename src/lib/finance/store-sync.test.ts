import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, syncPort } from "./store";

describe("syncPort", () => {
  beforeEach(() => syncPort.reset());

  it("tells listeners about local commits with before/after state", () => {
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" });
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    const [prev, next] = seen.mock.calls[0];
    expect(next.goals.length).toBe(prev.goals.length + 1);
  });

  it("applies remote changes without reporting them as local", () => {
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    syncPort.applyRemote((s) => ({ ...s, prefs: { ...s.prefs, name: "Meera" } }));
    off();
    expect(seen).not.toHaveBeenCalled();
    expect(syncPort.getState().prefs.name).toBe("Meera");
  });

  it("reset returns to an un-onboarded empty state", () => {
    actions.setPrefs({ onboarded: true });
    syncPort.reset();
    expect(syncPort.getState().prefs.onboarded).toBe(false);
    expect(syncPort.getState().transactions).toEqual([]);
  });

  // A "Delete everything" leaves tombstones for the built-in ids on the server; a fresh install
  // that pulls them used to end up with no categories or accounts at all.
  it("restores built-in categories and accounts when a pull removes them all, and pushes them back", () => {
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    syncPort.applyRemote((s) => ({ ...s, categories: [], accounts: [] }));
    off();
    const s = syncPort.getState();
    expect(s.categories.some((c) => c.kind === "expense")).toBe(true);
    expect(s.categories.some((c) => c.kind === "income")).toBe(true);
    expect(s.accounts.length).toBeGreaterThan(0);
    // reported as a local edit, so the engine uploads them and clears the tombstones
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][1].categories.length).toBeGreaterThan(0);
  });

  it("restores only the kind that is gone and keeps the user's own categories", () => {
    const mine = { id: "mine", name: "Pets", icon: "tag", color: "chart-5", kind: "expense" as const };
    syncPort.applyRemote((s) => ({ ...s, categories: [mine] }));
    const cats = syncPort.getState().categories;
    expect(cats.filter((c) => c.kind === "expense")).toEqual([mine]);
    expect(cats.some((c) => c.kind === "income")).toBe(true);
  });

  it("leaves a pull alone when every kind still has a category", () => {
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    syncPort.applyRemote((s) => ({ ...s, categories: s.categories.slice(0, 1).concat(s.categories.filter((c) => c.kind === "income").slice(0, 1)) }));
    off();
    expect(seen).not.toHaveBeenCalled();
    expect(syncPort.getState().categories).toHaveLength(2);
  });

  it("reset keeps the app lock only when asked to", () => {
    actions.setPrefs({ lock: { ...syncPort.getState().prefs.lock, pinHash: "abc" } });
    syncPort.reset({ keepLock: true });
    expect(syncPort.getState().prefs.lock.pinHash).toBe("abc");
    syncPort.reset();
    expect(syncPort.getState().prefs.lock.pinHash).toBeUndefined();
  });
});
