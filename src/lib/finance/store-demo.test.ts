import { beforeEach, describe, expect, it, vi } from "vitest";
import { actions, syncPort } from "./store";
import type { Transaction } from "./types";

const real: Omit<Transaction, "id"> = { type: "expense", amount: 250, categoryId: "food", accountId: "upi", merchant: "Chai", date: "2026-11-01T10:00:00.000Z", source: "manual", isDemo: false };

describe("sample data never replaces the user's own", () => {
  beforeEach(() => {
    syncPort.reset();
    actions.setPrefs({ onboarded: true, demoMode: false });
  });

  it("Load samples does nothing when the user has their own data, and reports it", () => {
    const tx = actions.addTx(real);
    actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" });
    const seen = vi.fn();
    const off = syncPort.onLocalCommit(seen);
    const before = syncPort.getState();
    expect(actions.loadDemo()).toBe(false);
    off();
    expect(seen).not.toHaveBeenCalled(); // nothing to sync, so no tombstones for the real records
    expect(syncPort.getState()).toBe(before);
    expect(syncPort.getState().transactions).toContainEqual(tx);
  });

  it("Load samples works on an empty account", () => {
    expect(actions.loadDemo()).toBe(true);
    expect(syncPort.getState().prefs.demoMode).toBe(true);
    expect(syncPort.getState().transactions.length).toBeGreaterThan(50);
  });

  it("Start fresh clears the samples but keeps what the user added while exploring them", () => {
    actions.loadDemo();
    const tx = actions.addTx(real);
    actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" });
    actions.startFresh();
    const s = syncPort.getState();
    expect(s.prefs.demoMode).toBe(false);
    expect(s.transactions).toEqual([tx]);
    expect(s.goals.map((g) => g.name)).toEqual(["Bike"]);
    expect(s.budgets).toEqual([]);
    expect(s.people).toEqual([]);
  });

  it("Start fresh on real data (the onboarding button) loses nothing", () => {
    const tx = actions.addTx(real);
    actions.startFresh();
    expect(syncPort.getState().transactions).toEqual([tx]);
  });
});
