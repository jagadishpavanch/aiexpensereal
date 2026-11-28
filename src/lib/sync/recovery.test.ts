import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/lib/finance/types";
import type { Change } from "./diff";
import type { RemoteApi } from "./engine";
import type { RemoteRow } from "./merge";

const tx: Transaction = { id: "t1", type: "expense", amount: 250, categoryId: "food", accountId: "upi", merchant: "Chai", date: "2026-11-01T10:00:00.000Z", source: "manual", isDemo: false };
const goal = { id: "g1", name: "Bike", target: 100, saved: 0, emoji: "🚲" };
const goal2 = { id: "g2", name: "Trip", target: 500, saved: 10, emoji: "✈️" };

/** A cloud that already holds this user's history. */
function cloud(): RemoteApi & { rows: RemoteRow[]; pushed: Change[] } {
  const rows: RemoteRow[] = [
    { collection: "transactions", id: "t1", data: tx as unknown as Record<string, unknown>, deleted: false, updated_at: "2026-11-01T10:00:01.000Z" },
    { collection: "goals", id: "g1", data: goal, deleted: false, updated_at: "2026-11-01T10:00:02.000Z" },
    { collection: "prefs", id: "prefs", data: { name: "Meera", onboarded: true, demoMode: false }, deleted: false, updated_at: "2026-11-01T10:00:03.000Z" },
  ];
  const pushed: Change[] = [];
  return {
    rows,
    pushed,
    push: async (c) => void pushed.push(...c),
    pull: async (since) => rows.filter((r) => since === null || r.updated_at > since),
    hasAny: async () => rows.length > 0,
    wipe: async () => {},
  };
}

describe("an unreadable local copy of an account that has history in the cloud", () => {
  beforeEach(() => localStorage.clear());

  it("comes back from the cloud on the next start, and neither sample data nor default prefs are pushed over it", async () => {
    vi.resetModules();
    localStorage.setItem("extrack:v1", '{"transactions":[{"id":"t1"');
    localStorage.setItem("extrack:owner:v1", "u1");
    localStorage.setItem("extrack:cursor:v1", "2099-01-01T00:00:00.000Z"); // pulled "everything" before the file broke
    const { syncPort } = await import("@/lib/finance/store");
    const { createSyncEngine } = await import("./engine");
    const remote = cloud();
    const engine = createSyncEngine({ remote, port: syncPort, kv: localStorage, debounceMs: 60_000 });
    await engine.start("u1");

    const s = syncPort.getState();
    expect(s.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(s.goals.map((g) => g.id)).toEqual(["g1"]);
    expect(s.prefs.name).toBe("Meera");
    expect(s.prefs.onboarded).toBe(true);
    expect(remote.pushed.filter((c) => c.collection === "prefs")).toEqual([]);
    expect(localStorage.getItem("extrack:v1:corrupt")).toContain('"transactions"');
    engine.stop();
  });

  it("still uploads the edits that were queued before the file broke", async () => {
    vi.resetModules();
    localStorage.setItem("extrack:v1", "not json");
    localStorage.setItem("extrack:owner:v1", "u1");
    localStorage.setItem("extrack:outbox:v1", JSON.stringify({ "goals:g2": { collection: "goals", id: "g2", data: goal2 } }));
    const { syncPort } = await import("@/lib/finance/store");
    const { createSyncEngine } = await import("./engine");
    const remote = cloud();
    const engine = createSyncEngine({ remote, port: syncPort, kv: localStorage, debounceMs: 60_000 });
    await engine.start("u1");
    expect(remote.pushed.find((c) => c.collection === "goals" && c.id === "g2")?.data).toEqual(goal2);
    engine.stop();
  });
});
