import { afterEach, describe, expect, it, vi } from "vitest";
import { demoState, emptyState } from "@/lib/finance/demo";
import type { FinanceState } from "@/lib/finance/types";
import type { Change } from "./diff";
import type { RemoteRow } from "./merge";
import { createSyncEngine, SYNC_KEYS, type KV, type RemoteApi, type SyncEngine, type SyncPort } from "./engine";

class FakeRemote implements RemoteApi {
  rows = new Map<string, RemoteRow>();
  clock = 0;
  failNext = false;
  pullGate: Promise<RemoteRow[]> | null = null;
  onPull?: () => void;
  pushGate: Promise<void> | null = null;
  onPush?: () => void;
  wipeGate: Promise<void> | null = null;
  onWipe?: () => void;
  private stamp() { return String(++this.clock).padStart(10, "0"); }
  async push(changes: Change[]) {
    if (this.pushGate) { const g = this.pushGate; this.pushGate = null; this.onPush?.(); await g; }
    if (this.failNext) { this.failNext = false; throw new Error("offline"); }
    for (const c of changes) this.rows.set(`${c.collection}:${c.id}`, { collection: c.collection, id: c.id, data: c.data, deleted: c.data === null, updated_at: this.stamp() });
  }
  async pull(since: string | null) {
    if (this.pullGate) { const g = this.pullGate; this.pullGate = null; this.onPull?.(); return g; }
    return [...this.rows.values()].filter((r) => since === null || r.updated_at > since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
  }
  async hasAny() { return [...this.rows.values()].some((r) => !r.deleted); }
  async wipe() {
    for (const [k, r] of this.rows) if (!r.deleted) this.rows.set(k, { ...r, data: null, deleted: true, updated_at: this.stamp() });
    if (this.wipeGate) { const g = this.wipeGate; this.wipeGate = null; this.onWipe?.(); await g; } // response still in flight
  }
}

function memoryPort(initial: FinanceState) {
  let s = initial;
  const ls = new Set<(p: FinanceState, n: FinanceState) => void>();
  const port: SyncPort & { commit(fn: (s: FinanceState) => FinanceState): void } = {
    getState: () => s,
    onLocalCommit: (l) => (ls.add(l), () => void ls.delete(l)),
    applyRemote: (fn) => { s = fn(s); },
    reset: (o) => { s = { ...emptyState(), prefs: { ...emptyState().prefs, onboarded: false, lock: o?.keepLock ? s.prefs.lock : emptyState().prefs.lock } }; },
    commit: (fn) => { const p = s; s = fn(s); ls.forEach((l) => l(p, s)); },
  };
  return port;
}

const memoryKV = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
const onboarded = (s: FinanceState) => ({ ...s, prefs: { ...s.prefs, onboarded: true } });
const engines: SyncEngine[] = [];
const device = (remote: FakeRemote, initial = emptyState()) => {
  const port = memoryPort(initial);
  const kv = memoryKV();
  const engine = createSyncEngine({ remote, port, kv, debounceMs: 60_000 });
  engines.push(engine);
  return { port, engine, kv };
};
const goal = { id: "g1", name: "Bike", target: 100, saved: 0, emoji: "🚲" };

afterEach(() => {
  engines.splice(0).forEach((e) => e.stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sync engine", () => {
  it("uploads an onboarded device's data on first sign-in when the cloud is empty", async () => {
    const remote = new FakeRemote();
    const a = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
    await a.engine.start("u1");
    expect(await remote.hasAny()).toBe(true);
    expect(remote.rows.get("prefs:prefs")?.data).toMatchObject({ onboarded: true });
  });

  it("replaces local data with the cloud copy when the cloud already has data", async () => {
    const remote = new FakeRemote();
    await remote.push([{ collection: "goals", id: "g1", data: goal }]);
    const b = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
    await b.engine.start("u1");
    expect(b.port.getState().goals).toEqual([goal]);
  });

  it("an edit on one device reaches the other", async () => {
    const remote = new FakeRemote();
    const a = device(remote); const b = device(remote);
    await a.engine.start("u1"); await b.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(b.port.getState().goals).toEqual([goal]);
  });

  it("deletes propagate", async () => {
    const remote = new FakeRemote();
    const a = device(remote); const b = device(remote);
    await a.engine.start("u1"); await b.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    await a.engine.syncNow(); await b.engine.syncNow();
    a.port.commit((s) => ({ ...s, goals: [] }));
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(b.port.getState().goals).toEqual([]);
  });

  it("keeps changes queued while offline and sends them later", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    remote.failNext = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await a.engine.syncNow();
    expect(warn).toHaveBeenCalled();
    expect(a.engine.info().status).not.toBe("idle");
    expect(a.engine.info().pending).toBe(1);
    await a.engine.syncNow();
    expect(a.engine.info()).toMatchObject({ status: "idle", pending: 0 });
    expect(remote.rows.get("goals:g1")?.data).toEqual(goal);
  });

  it("an unpushed local edit is not overwritten by an incoming row", async () => {
    const remote = new FakeRemote();
    const a = device(remote); const b = device(remote);
    await a.engine.start("u1"); await b.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    await a.engine.syncNow(); await b.engine.syncNow();
    b.port.commit((s) => ({ ...s, goals: [{ ...goal, saved: 50 }] }));
    a.port.commit((s) => ({ ...s, goals: [{ ...goal, saved: 10 }] }));
    await a.engine.syncNow();
    await b.engine.syncNow(); // pushes 50 after A's 10, so 50 is newest
    await a.engine.syncNow();
    expect(b.port.getState().goals[0].saved).toBe(50);
    expect(a.port.getState().goals[0].saved).toBe(50);
  });

  it("wipeAll tombstones the cloud and resets this device", async () => {
    const remote = new FakeRemote();
    const a = device(remote, onboarded(emptyState()));
    await a.engine.start("u1");
    await a.engine.wipeAll();
    expect(await remote.hasAny()).toBe(false);
    expect(a.port.getState().prefs.onboarded).toBe(false);
  });

  it("keeps this phone's app lock when first sign-in takes the cloud copy", async () => {
    const remote = new FakeRemote();
    await remote.push([{ collection: "goals", id: "g1", data: goal }]);
    const base = onboarded(emptyState());
    const b = device(remote, { ...base, prefs: { ...base.prefs, lock: { ...base.prefs.lock, pinHash: "abc" } } });
    await b.engine.start("u1");
    expect(b.port.getState().goals).toEqual([goal]);
    expect(b.port.getState().prefs.lock.pinHash).toBe("abc");
  });

  it("sign-out during an in-flight pull leaves nothing of the old user behind", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    let release!: (r: RemoteRow[]) => void;
    remote.pullGate = new Promise<RemoteRow[]>((r) => { release = r; });
    const started = new Promise<void>((r) => { remote.onPull = r; });
    const p = a.engine.start("u1");
    await started;
    a.engine.forget();
    release([{ collection: "goals", id: "g9", data: goal, deleted: false, updated_at: "0000000099" }]);
    await p;
    expect(a.port.getState().goals).toEqual([]);
    for (const k of Object.values(SYNC_KEYS)) expect(a.kv.getItem(k)).toBeNull();
  });

  it("a push in flight during wipeAll reaches the server before the wipe", async () => {
    const remote = new FakeRemote();
    const a = device(remote, onboarded(emptyState()));
    let release!: () => void;
    remote.pushGate = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { remote.onPush = r; });
    const p = a.engine.start("u1");
    await started;
    const w = a.engine.wipeAll();
    release();
    await Promise.all([p, w]);
    expect(await remote.hasAny()).toBe(false);
    expect(a.port.getState().prefs.onboarded).toBe(false);
  });

  it("an edit made while a pull is in flight is kept and pushed next", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    await remote.push([{ collection: "goals", id: "g1", data: goal }]);
    let release!: (r: RemoteRow[]) => void;
    remote.pullGate = new Promise<RemoteRow[]>((r) => { release = r; });
    const started = new Promise<void>((r) => { remote.onPull = r; });
    const p = a.engine.syncNow();
    await started;
    const edited = { ...goal, saved: 10 };
    a.port.commit((s) => ({ ...s, goals: [edited] }));
    release([...remote.rows.values()]);
    await p;
    expect(a.port.getState().goals).toEqual([edited]);
    await a.engine.syncNow();
    expect(remote.rows.get("goals:g1")?.data).toEqual(edited);
  });

  it("reports the last error and clears it after a good run", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    remote.failNext = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await a.engine.syncNow();
    expect(warn).toHaveBeenCalled();
    expect(a.engine.info().lastError).toBe("offline");
    await a.engine.syncNow();
    expect(a.engine.info().lastError).toBeNull();
  });

  it("retries a failed sync by itself with backoff", async () => {
    vi.useFakeTimers();
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    remote.failNext = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await a.engine.syncNow();
    expect(warn).toHaveBeenCalled();
    expect(a.engine.info().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(a.engine.info().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.engine.info()).toMatchObject({ pending: 0, status: "idle", lastError: null });
    expect(remote.rows.get("goals:g1")?.data).toEqual(goal);
  });

  it("surfaces a failing hasAny on start", async () => {
    const remote = new FakeRemote();
    remote.hasAny = async () => { throw new Error("denied"); };
    const a = device(remote);
    await expect(a.engine.start("u1")).rejects.toThrow("denied");
    expect(a.engine.info()).toMatchObject({ status: "error", lastError: "denied" });
  });

  it("a sync started while wipeAll is waiting on the server cannot outlive the wipe", async () => {
    const remote = new FakeRemote();
    const a = device(remote, onboarded(emptyState()));
    await a.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    remote.failNext = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await a.engine.syncNow();
    expect(warn).toHaveBeenCalled();
    expect(a.engine.info()).toMatchObject({ status: "error", lastError: "offline" });
    let release!: () => void;
    remote.wipeGate = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { remote.onWipe = r; });
    const w = a.engine.wipeAll();
    await started;
    a.port.commit((s) => ({ ...s, goals: [{ ...goal, id: "g2" }] }));
    await a.engine.syncNow();
    release();
    await w;
    expect(await remote.hasAny()).toBe(false);
    expect(a.port.getState().goals).toEqual([]);
    expect(a.port.getState().prefs.onboarded).toBe(false);
    expect(a.engine.info()).toMatchObject({ status: "idle", lastError: null, pending: 0 });
  });

  it("a returning user's start resolves at once, without waiting on the network", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    a.port.commit((s) => ({ ...s, goals: [goal] }));
    const before = a.port.getState();
    remote.pushGate = new Promise<void>(() => {});
    remote.pullGate = new Promise<RemoteRow[]>(() => {});
    remote.hasAny = () => new Promise<boolean>(() => {});
    const again = createSyncEngine({ remote, port: a.port, kv: a.kv, debounceMs: 60_000 });
    engines.push(again);
    await expect(again.start("u1")).resolves.toBeUndefined();
    expect(a.port.getState()).toBe(before);
    expect(again.info().status).toBe("syncing");
  });

  it("a new phone whose first pull fails rejects start and does not claim the phone", async () => {
    const remote = new FakeRemote();
    await remote.push([{ collection: "goals", id: "g1", data: goal }]);
    const b = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
    b.kv.setItem(SYNC_KEYS.owner, "someone-else");
    const realPull = remote.pull.bind(remote);
    remote.pull = async () => { throw new Error("offline"); };
    const push = vi.spyOn(remote, "push");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(b.engine.start("u1")).rejects.toThrow("offline");
    expect(warn).toHaveBeenCalled();
    expect(b.kv.getItem(SYNC_KEYS.owner)).toBeNull();
    expect(b.port.getState().prefs.onboarded).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(b.engine.info()).toMatchObject({ status: "error", lastError: "offline" });

    remote.pull = realPull; // the network is back; the user taps Try again
    await b.engine.start("u1");
    expect(b.port.getState().goals).toEqual([goal]);
    expect(b.kv.getItem(SYNC_KEYS.owner)).toBe("u1");
    expect(push).not.toHaveBeenCalled();
  });

  it("a failed strict first sync does not schedule a background retry", async () => {
    vi.useFakeTimers();
    const remote = new FakeRemote();
    await remote.push([{ collection: "goals", id: "g1", data: goal }]);
    const b = device(remote);
    const pull = vi.spyOn(remote, "pull").mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(b.engine.start("u1")).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(b.port.getState().goals).toEqual([]);
  });

  it("a failed first upload stays queued and goes out on the next launch", async () => {
    const remote = new FakeRemote();
    const a = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
    remote.failNext = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await a.engine.start("u1");
    expect(a.kv.getItem(SYNC_KEYS.owner)).toBe("u1");
    expect(a.engine.info().pending).toBeGreaterThan(0);
    expect(remote.rows.size).toBe(0);
    a.engine.stop();
    const next = createSyncEngine({ remote, port: a.port, kv: a.kv, debounceMs: 60_000 });
    engines.push(next);
    await next.start("u1");
    await next.syncNow();
    expect(next.info().pending).toBe(0);
    expect(remote.rows.get("prefs:prefs")?.data).toMatchObject({ onboarded: true });
  });

  it("does not push local edits until start has settled whose data this is", async () => {
    vi.useFakeTimers();
    const remote = new FakeRemote();
    const port = memoryPort(emptyState());
    const engine = createSyncEngine({ remote, port, kv: memoryKV(), debounceMs: 100 });
    engines.push(engine);
    port.commit((s) => ({ ...s, goals: [goal] }));
    await vi.advanceTimersByTimeAsync(500);
    await engine.syncNow();
    expect(remote.rows.size).toBe(0);
    await engine.start("u1");
    expect(remote.rows.get("goals:g1")?.data).toEqual(goal); // the pre-start commit goes out with the first sync
    port.commit((s) => ({ ...s, goals: [{ ...goal, saved: 5 }] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(remote.rows.get("goals:g1")?.data).toEqual({ ...goal, saved: 5 });
  });
});

describe("when this phone cannot save", () => {
  it("still schedules the upload of an edit whose queue entry could not be written", async () => {
    vi.useFakeTimers();
    try {
      const remote = new FakeRemote();
      const port = memoryPort(onboarded(emptyState()));
      const store = memoryKV();
      let full = false;
      const kv: KV = { ...store, setItem: (k, v) => { if (full) throw new DOMException("quota", "QuotaExceededError"); store.setItem(k, v); } };
      const engine = createSyncEngine({ remote, port, kv, debounceMs: 1500 });
      engines.push(engine);
      await engine.start("u1");
      full = true;
      expect(() => port.commit((s) => ({ ...s, goals: [goal] }))).not.toThrow();
      expect(engine.info().pending).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(remote.rows.get("goals:g1")?.data).toEqual(goal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not move the pull cursor when the pulled rows were not saved on the phone", async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.engine.start("u1");
    a.port.commit((s) => onboarded({ ...s, goals: [goal] }));
    await a.engine.syncNow();
    const b = device(remote);
    b.port.applyRemote = () => false; // storage full: nothing was written
    await b.engine.start("u1");
    expect(b.kv.getItem(SYNC_KEYS.cursor)).toBeNull();
  });
});

describe("data that was on the phone before its first sign-in", () => {
  const mine = { id: "t-mine", type: "expense" as const, amount: 99, categoryId: "food", accountId: "upi", merchant: "Chai", date: "2026-10-01T10:00:00.000Z", source: "manual" as const, isDemo: false };

  it("is copied aside before the account's data replaces it, and the copy goes with an explicit sign-out", async () => {
    const remote = new FakeRemote();
    const other = device(remote);
    await other.engine.start("u1");
    other.port.commit((s) => onboarded({ ...s, goals: [goal] }));
    await other.engine.syncNow();

    const phone = device(remote, onboarded({ ...emptyState(), transactions: [mine] }));
    await phone.engine.start("u1");
    expect(phone.port.getState().transactions).toEqual([]); // the account's copy won, as designed
    const backup = JSON.parse(phone.kv.getItem(SYNC_KEYS.backup)!);
    expect(backup.state.transactions).toEqual([mine]);

    phone.engine.forget();
    expect(phone.kv.getItem(SYNC_KEYS.backup)).toBeNull();
  });

  it("is not copied when it only holds sample data", async () => {
    const remote = new FakeRemote();
    const other = device(remote);
    await other.engine.start("u1");
    other.port.commit((s) => onboarded({ ...s, goals: [goal] }));
    await other.engine.syncNow();
    const phone = device(remote, onboarded(demoState(new Date(2026, 10, 25))));
    await phone.engine.start("u1");
    expect(phone.kv.getItem(SYNC_KEYS.backup)).toBeNull();
  });

  it("another account's leftovers are dropped without a copy (they are not this user's data to keep)", async () => {
    const remote = new FakeRemote();
    const other = device(remote);
    await other.engine.start("u2");
    other.port.commit((s) => onboarded({ ...s, goals: [goal] }));
    await other.engine.syncNow();
    const phone = device(remote, onboarded({ ...emptyState(), transactions: [mine] }));
    phone.kv.setItem(SYNC_KEYS.owner, "u1");
    await phone.engine.start("u2");
    expect(phone.kv.getItem(SYNC_KEYS.backup)).toBeNull();
  });
});

describe("delete everything", () => {
  it("also removes the copy kept from before the first sign-in", async () => {
    const remote = new FakeRemote();
    const d = device(remote);
    await d.engine.start("u1");
    d.kv.setItem(SYNC_KEYS.backup, "{}");
    await d.engine.wipeAll();
    expect(d.kv.getItem(SYNC_KEYS.backup)).toBeNull();
  });
});
