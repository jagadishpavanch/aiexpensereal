import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "./demo";
import type { Transaction } from "./types";

const tx: Transaction = { id: "t1", type: "expense", amount: 250, categoryId: "food", accountId: "upi", merchant: "Chai", date: "2026-11-01T10:00:00.000Z", source: "manual", isDemo: false };

/** Loads the store fresh over whatever is in localStorage, as the app does on launch. */
async function launch(setup: () => void) {
  vi.resetModules();
  localStorage.clear();
  setup();
  return import("./store");
}

describe("an unreadable saved copy", () => {
  beforeEach(() => localStorage.clear());

  it("is never replaced by sample data: it is kept aside and the app starts empty, not in demo mode", async () => {
    const raw = '{"transactions":[{"id":"t1","amount":250,';
    const { syncPort, actions } = await launch(() => localStorage.setItem("extrack:v1", raw));
    const s = syncPort.getState();
    expect(s.transactions.some((t) => t.isDemo)).toBe(false);
    expect(s.prefs.demoMode).toBe(false);
    expect(localStorage.getItem("extrack:v1:corrupt")).toBe(raw);

    actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" }); // the first save overwrites extrack:v1
    expect(localStorage.getItem("extrack:v1:corrupt")).toBe(raw);
    expect(JSON.parse(localStorage.getItem("extrack:v1")!).transactions.some((t: Transaction) => t.isDemo)).toBe(false);
  });

  it("makes the next sign-in restore from the account: owner and pull cursor are forgotten, queued edits are kept", async () => {
    const { syncPort } = await launch(() => {
      localStorage.setItem("extrack:v1", "not json");
      localStorage.setItem("extrack:owner:v1", "u1");
      localStorage.setItem("extrack:cursor:v1", "2026-11-20T00:00:00.000Z");
      localStorage.setItem("extrack:outbox:v1", '{"goals:g1":{"collection":"goals","id":"g1","data":{"id":"g1"}}}');
    });
    syncPort.getState();
    expect(localStorage.getItem("extrack:owner:v1")).toBeNull();
    expect(localStorage.getItem("extrack:cursor:v1")).toBeNull();
    expect(localStorage.getItem("extrack:outbox:v1")).toContain("goals:g1");
  });

  it("falls back to the old key's copy when only the new key is damaged", async () => {
    const { syncPort } = await launch(() => {
      localStorage.setItem("extrack:v1", "{{{");
      localStorage.setItem("rupeeflow:v1", JSON.stringify({ ...emptyState(), transactions: [tx], prefs: { ...emptyState().prefs, onboarded: true, demoMode: false } }));
    });
    expect(syncPort.getState().transactions).toEqual([tx]);
  });

  it("does not treat an older save that lacks a list as unreadable", async () => {
    const old = { transactions: [tx], categories: emptyState().categories, accounts: emptyState().accounts, prefs: { ...emptyState().prefs, onboarded: true, demoMode: false } };
    const { syncPort } = await launch(() => localStorage.setItem("extrack:v1", JSON.stringify(old)));
    const s = syncPort.getState();
    expect(s.transactions).toEqual([tx]);
    expect(s.goals).toEqual([]);
    expect(s.rules).toEqual([]);
    expect(localStorage.getItem("extrack:v1:corrupt")).toBeNull();
  });

  it("still starts a brand new install on the sample data", async () => {
    const { syncPort } = await launch(() => {});
    expect(syncPort.getState().prefs.demoMode).toBe(true);
    expect(localStorage.getItem("extrack:v1:corrupt")).toBeNull();
  });
});
