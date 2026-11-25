import type { FinanceState } from "@/lib/finance/types";
import { diffState, toChanges, type Change } from "./diff";
import { applyRows, type RemoteRow } from "./merge";
import { acknowledge, enqueue, type Outbox } from "./outbox";

export interface RemoteApi {
  push(changes: Change[]): Promise<void>;
  pull(since: string | null): Promise<RemoteRow[]>;
  hasAny(): Promise<boolean>;
  wipe(): Promise<void>;
}
export interface SyncPort {
  getState(): FinanceState;
  onLocalCommit(listener: (prev: FinanceState, next: FinanceState) => void): () => void;
  applyRemote(fn: (s: FinanceState) => FinanceState): void;
  reset(opts?: { keepLock?: boolean }): void;
}
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null; lastError: string | null }

export const SYNC_KEYS = { outbox: "extrack:outbox:v1", cursor: "extrack:cursor:v1", owner: "extrack:owner:v1" } as const;

function readOutbox(kv: KV): Outbox {
  try { return JSON.parse(kv.getItem(SYNC_KEYS.outbox) ?? "{}") as Outbox; } catch { return {}; }
}

export function createSyncEngine(opts: { remote: RemoteApi; port: SyncPort; kv: KV; debounceMs?: number; onInfo?: (info: SyncInfo) => void }) {
  const { remote, port, kv, debounceMs = 1500, onInfo } = opts;
  let outbox = readOutbox(kv);
  let cursor = kv.getItem(SYNC_KEYS.cursor);
  let status: SyncStatus = "idle";
  let lastSyncedAt: number | null = null;
  let lastError: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let running: Promise<void> | null = null;
  let again = false;
  /** Bumped by forget / wipeAll / stop: any run started before the bump must not touch anything after its next await. */
  let gen = 0;
  /** True while wipeAll waits on the server: no new sync may start, or its push could land after the wipe. */
  let wiping = false;

  const info = (): SyncInfo => ({ status, pending: Object.keys(outbox).length, lastSyncedAt, lastError });
  const emit = () => onInfo?.(info());
  const saveOutbox = () => { kv.setItem(SYNC_KEYS.outbox, JSON.stringify(outbox)); emit(); };
  const setStatus = (s: SyncStatus) => { status = s; emit(); };

  const unsubscribe = port.onLocalCommit((prev, next) => {
    outbox = enqueue(outbox, diffState(prev, next));
    saveOutbox();
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), debounceMs);
  });

  async function runOnce(g: number) {
    const sending = outbox;
    const changes = Object.values(sending);
    if (changes.length) {
      await remote.push(changes);
      if (g !== gen) return;
      outbox = acknowledge(outbox, sending);
      saveOutbox();
    }
    const rows = await remote.pull(cursor);
    if (g !== gen) return;
    if (rows.length) {
      port.applyRemote((s) => applyRows(s, rows, outbox));
      cursor = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor ?? "");
      kv.setItem(SYNC_KEYS.cursor, cursor);
    }
  }

  /** Push queued changes, then pull newer rows. Concurrent calls share one run. */
  function syncNow(): Promise<void> {
    if (wiping) return Promise.resolve();
    if (running) { again = true; return running; }
    setStatus("syncing");
    const g = gen;
    let run: Promise<void> | undefined;
    run = (async () => {
      try {
        do { again = false; await runOnce(g); } while (again && g === gen);
        if (g !== gen) return;
        clearTimeout(retryTimer);
        failures = 0;
        lastError = null;
        lastSyncedAt = Date.now();
        setStatus("idle");
      } catch (err) {
        if (g !== gen) return;
        lastError = err instanceof Error ? err.message : String(err);
        console.warn("[sync]", err);
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (!offline) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void syncNow(), Math.min(60_000, 2_000 * 2 ** failures));
        }
        failures++;
        setStatus(offline ? "offline" : "error");
      } finally {
        if (running === run) running = null;
      }
    })();
    running = run;
    return run;
  }

  /** First run for a user on this device decides whose data wins, then syncs. */
  async function start(userId: string) {
    const g = gen;
    const owner = kv.getItem(SYNC_KEYS.owner);
    if (owner !== userId) {
      let cloudHasData: boolean;
      try {
        cloudHasData = await remote.hasAny();
      } catch (err) {
        if (g === gen) { lastError = err instanceof Error ? err.message : String(err); setStatus("error"); }
        throw err;
      }
      if (g !== gen) return;
      const local = port.getState();
      if (owner !== null || cloudHasData) { port.reset({ keepLock: true }); outbox = {}; }
      else if (local.prefs.onboarded) outbox = enqueue({}, toChanges(local));
      cursor = null;
      kv.removeItem(SYNC_KEYS.cursor);
      saveOutbox();
      kv.setItem(SYNC_KEYS.owner, userId);
    }
    await syncNow();
  }

  /** Let any in-flight run land first, so its push reaches the server before the wipe. */
  async function wipeAll() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    if (running) await running;
    wiping = true;
    gen++;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    try {
      await remote.wipe();
      gen++;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      outbox = {};
      saveOutbox();
      failures = 0;
      lastError = null;
      status = "idle";
      port.reset();
      emit();
    } finally {
      wiping = false;
    }
  }

  /** Cancel timers and orphan any in-flight run. */
  function invalidate() {
    gen++;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    running = null;
    again = false;
  }

  /** Sign-out: drop this user's data and sync bookkeeping from the device. */
  function forget() {
    invalidate();
    Object.values(SYNC_KEYS).forEach((k) => kv.removeItem(k));
    outbox = {};
    cursor = null;
    failures = 0;
    lastError = null;
    status = "idle";
    port.reset();
    emit();
  }

  function stop() { unsubscribe(); invalidate(); }

  return { start, syncNow, wipeAll, forget, stop, info };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;
