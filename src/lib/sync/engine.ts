import type { FinanceState } from "@/lib/finance/types";
import { diffState, toChanges, type Change } from "./diff";
import { applyRows, type RemoteRow } from "./merge";
import { SYNC_KEYS } from "./keys";
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
  /** False when the result could not be saved on the device (storage full). */
  applyRemote(fn: (s: FinanceState) => FinanceState): boolean | void;
  reset(opts?: { keepLock?: boolean }): void;
}
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null; lastError: string | null }

export { SYNC_KEYS };

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
  /** False until start() has settled whose data is on this device; nothing may be pushed before that. */
  let ready = false;

  const info = (): SyncInfo => ({ status, pending: Object.keys(outbox).length, lastSyncedAt, lastError });
  const emit = () => onInfo?.(info());
  // A full phone must not stop the upload: the queue stays in memory and each later save writes all of it again.
  const saveOutbox = () => {
    try { kv.setItem(SYNC_KEYS.outbox, JSON.stringify(outbox)); } catch (err) { console.warn("[sync] could not save the queue", err); }
    emit();
  };
  const setStatus = (s: SyncStatus) => { status = s; emit(); };

  const unsubscribe = port.onLocalCommit((prev, next) => {
    outbox = enqueue(outbox, diffState(prev, next));
    saveOutbox();
    clearTimeout(timer);
    timer = setTimeout(() => { if (ready) void syncNow(); }, debounceMs);
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
      // Rows this phone could not store are read again next time, not skipped.
      if (port.applyRemote((s) => applyRows(s, rows, outbox)) === false) return;
      cursor = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor ?? "");
      kv.setItem(SYNC_KEYS.cursor, cursor);
    }
  }

  /**
   * Push queued changes, then pull newer rows. Concurrent calls share one run.
   * `strict` (start()'s first sync on a new phone) rethrows a failure and schedules no retry, so the caller decides.
   */
  async function syncNow(strict = false): Promise<void> {
    if (wiping) return;
    if (strict) { clearTimeout(retryTimer); if (running) await running; }
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
        if (!offline && !strict) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void syncNow(), Math.min(60_000, 2_000 * 2 ** failures));
        }
        failures++;
        setStatus(offline ? "offline" : "error");
        if (strict) throw err;
      } finally {
        if (running === run) running = null;
      }
    })();
    running = run;
    return run;
  }

  /**
   * First run for a user on this device decides whose data wins, then syncs.
   * Resolves at once for the phone's owner (the local data is already theirs) and syncs in the background.
   * On a phone the user doesn't own yet whose cloud has data, resolves only once that data has loaded.
   */
  async function start(userId: string) {
    const g = gen;
    // Loading the store may find an unreadable copy and forget the owner, so read the owner only after it.
    port.getState();
    const owner = kv.getItem(SYNC_KEYS.owner);
    if (owner === userId) {
      ready = true;
      void syncNow();
      return;
    }
    let cloudHasData: boolean;
    try {
      cloudHasData = await remote.hasAny();
    } catch (err) {
      if (g === gen) { lastError = err instanceof Error ? err.message : String(err); setStatus("error"); }
      throw err;
    }
    if (g !== gen) return;
    const local = port.getState();
    // Edits queued while no owner was recorded are this user's own (a store that lost its copy keeps them): only another account's are dropped.
    const kept = owner === null ? outbox : {};
    if (owner !== null || cloudHasData) { port.reset({ keepLock: true }); outbox = kept; }
    else if (local.prefs.onboarded) outbox = enqueue(kept, toChanges(local));
    cursor = null;
    kv.removeItem(SYNC_KEYS.cursor);
    saveOutbox();
    if (cloudHasData) {
      // Not this phone's owner until the cloud copy is here: a retry must take this branch again, not the fast path.
      kv.removeItem(SYNC_KEYS.owner);
      await syncNow(true);
      if (g !== gen) return;
      kv.setItem(SYNC_KEYS.owner, userId);
      ready = true;
      return;
    }
    kv.setItem(SYNC_KEYS.owner, userId);
    ready = true;
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
    ready = false;
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

  function stop() { ready = false; unsubscribe(); invalidate(); }

  /** Public entry: a no-op until start() has settled ownership. */
  const requestSync = () => (ready ? syncNow() : Promise.resolve());

  return { start, syncNow: requestSync, wipeAll, forget, stop, info };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;
