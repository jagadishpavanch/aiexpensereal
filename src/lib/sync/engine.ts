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
  reset(): void;
}
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SyncStatus = "idle" | "syncing" | "offline" | "error";
export interface SyncInfo { status: SyncStatus; pending: number; lastSyncedAt: number | null }

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let again = false;

  const info = (): SyncInfo => ({ status, pending: Object.keys(outbox).length, lastSyncedAt });
  const emit = () => onInfo?.(info());
  const saveOutbox = () => { kv.setItem(SYNC_KEYS.outbox, JSON.stringify(outbox)); emit(); };
  const setStatus = (s: SyncStatus) => { status = s; emit(); };

  const unsubscribe = port.onLocalCommit((prev, next) => {
    outbox = enqueue(outbox, diffState(prev, next));
    saveOutbox();
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), debounceMs);
  });

  async function runOnce() {
    const sending = outbox;
    const changes = Object.values(sending);
    if (changes.length) {
      await remote.push(changes);
      outbox = acknowledge(outbox, sending);
      saveOutbox();
    }
    const rows = await remote.pull(cursor);
    if (rows.length) {
      port.applyRemote((s) => applyRows(s, rows, outbox));
      cursor = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor ?? "");
      kv.setItem(SYNC_KEYS.cursor, cursor);
    }
  }

  /** Push queued changes, then pull newer rows. Concurrent calls share one run. */
  function syncNow(): Promise<void> {
    if (running) { again = true; return running; }
    setStatus("syncing");
    running = (async () => {
      try {
        do { again = false; await runOnce(); } while (again);
        lastSyncedAt = Date.now();
        setStatus("idle");
      } catch {
        setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** First run for a user on this device decides whose data wins, then syncs. */
  async function start(userId: string) {
    const owner = kv.getItem(SYNC_KEYS.owner);
    if (owner !== userId) {
      const cloudHasData = await remote.hasAny();
      const local = port.getState();
      if (owner !== null || cloudHasData) { port.reset(); outbox = {}; }
      else if (local.prefs.onboarded) outbox = enqueue({}, toChanges(local));
      cursor = null;
      kv.removeItem(SYNC_KEYS.cursor);
      saveOutbox();
      kv.setItem(SYNC_KEYS.owner, userId);
    }
    await syncNow();
  }

  async function wipeAll() {
    await remote.wipe();
    outbox = {};
    saveOutbox();
    port.reset();
  }

  /** Sign-out: drop this user's data and sync bookkeeping from the device. */
  function forget() {
    Object.values(SYNC_KEYS).forEach((k) => kv.removeItem(k));
    outbox = {};
    cursor = null;
    port.reset();
    emit();
  }

  function stop() { unsubscribe(); clearTimeout(timer); }

  return { start, syncNow, wipeAll, forget, stop, info };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;
