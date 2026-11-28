import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  return import("./store");
}

const full = () => vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });

describe("a full phone storage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("keeps the edit in memory, keeps trying to save it, and writes it once there is room", async () => {
    const { actions, syncPort } = await freshStore();
    syncPort.reset();
    const spy = full();
    expect(() => actions.addGoal({ name: "Bike", target: 100, saved: 0, emoji: "🚲" })).not.toThrow();
    expect(syncPort.getState().goals).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("extrack:v1")!).goals).toHaveLength(0); // not written yet

    spy.mockRestore(); // the user freed some space
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(localStorage.getItem("extrack:v1")!).goals).toHaveLength(1);
  });

  it("tells the sync engine a pull was not saved, so it does not move its cursor past rows this phone lost", async () => {
    const { syncPort } = await freshStore();
    syncPort.getState();
    full();
    const saved = syncPort.applyRemote((s) => ({ ...s, prefs: { ...s.prefs, name: "Meera" } }));
    expect(saved).toBe(false);
  });

  it("reports a pull that was saved", async () => {
    const { syncPort } = await freshStore();
    syncPort.getState();
    expect(syncPort.applyRemote((s) => ({ ...s, prefs: { ...s.prefs, name: "Meera" } }))).toBe(true);
  });
});
