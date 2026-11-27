import type { SyncInfo } from "./engine";

const LABEL: Record<SyncInfo["status"], string> = {
  idle: "Synced",
  syncing: "Syncing…",
  offline: "Offline. Changes are saved on this phone",
  error: "Couldn't sync. Tap Sync now to retry",
};

export const syncLabel = (info: SyncInfo): string => (info.status === "idle" && info.pending > 0 ? "Waiting to upload" : LABEL[info.status]);

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout/i;
const AUTH = /jwt|invalid (token|refresh)|\b40[13]\b|row-level security|unauthori[sz]ed|not authenticated/i;

/** Plain-language version of a raw sync error. The raw text only goes to the console. */
export function friendlyError(raw: string | null | undefined): string {
  const m = raw ?? "";
  if (NETWORK.test(m)) return "No internet connection. Changes are saved on this phone.";
  if (AUTH.test(m)) return "Your sign-in needs refreshing. Sync will retry.";
  return "Couldn't sync. Tap Sync now to try again.";
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Second line under the sync label: the error when sync failed, else queued edits, else the last sync time. */
export function syncSub(info: SyncInfo): string | undefined {
  if (info.status === "error" && info.lastError) return friendlyError(info.lastError);
  if (info.pending) return `${info.pending} change${info.pending === 1 ? "" : "s"} waiting to upload`;
  if (info.lastSyncedAt) return `Last synced ${clock(info.lastSyncedAt)}`;
  return undefined;
}
