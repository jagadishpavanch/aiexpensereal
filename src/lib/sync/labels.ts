import type { SyncInfo } from "./engine";

const LABEL: Record<SyncInfo["status"], string> = {
  idle: "Synced",
  syncing: "Syncing…",
  offline: "Offline. Changes are saved on this phone",
  error: "Couldn't sync. Tap Sync now to retry",
};

const MAX_ERROR = 80;

export const syncLabel = (info: SyncInfo): string => LABEL[info.status];

const oneLine = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_ERROR ? `${t.slice(0, MAX_ERROR - 1).trimEnd()}…` : t;
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Second line under the sync label: the error when sync failed, else queued edits, else the last sync time. */
export function syncSub(info: SyncInfo): string | undefined {
  if (info.status === "error" && info.lastError) return oneLine(info.lastError);
  if (info.pending) return `${info.pending} change${info.pending === 1 ? "" : "s"} waiting to upload`;
  if (info.lastSyncedAt) return `Last synced ${clock(info.lastSyncedAt)}`;
  return undefined;
}
