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

  it("reset keeps the app lock only when asked to", () => {
    actions.setPrefs({ lock: { ...syncPort.getState().prefs.lock, pinHash: "abc" } });
    syncPort.reset({ keepLock: true });
    expect(syncPort.getState().prefs.lock.pinHash).toBe("abc");
    syncPort.reset();
    expect(syncPort.getState().prefs.lock.pinHash).toBeUndefined();
  });
});
