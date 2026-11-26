import { describe, expect, it } from "vitest";
import { friendlyError, syncLabel, syncSub } from "./labels";
import type { SyncInfo } from "./engine";

const info = (o: Partial<SyncInfo> = {}): SyncInfo => ({ status: "idle", pending: 0, lastSyncedAt: null, lastError: null, ...o });

const NETWORK = "No internet connection. Changes are saved on this phone.";
const AUTH = "Your sign-in needs refreshing. Sync will retry.";
const OTHER = "Couldn't sync. Tap Sync now to try again.";

describe("friendlyError", () => {
  it.each(["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "Request timed out", "timeout of 5000ms exceeded"])("maps network failure %s", (m) => {
    expect(friendlyError(m)).toBe(NETWORK);
  });
  it.each(["JWT expired", "invalid token", "Request failed with status 401", "403 Forbidden", 'new row violates row-level security policy for table "records"'])("maps auth failure %s", (m) => {
    expect(friendlyError(m)).toBe(AUTH);
  });
  it("hides everything else, including ids and internals", () => {
    expect(friendlyError("sync pull made no progress")).toBe(OTHER);
    expect(friendlyError('invalid input syntax for type uuid: "abc"')).toBe(OTHER);
    expect(friendlyError("")).toBe(OTHER);
    expect(friendlyError(null)).toBe(OTHER);
  });
});

describe("sync labels", () => {
  it("names each status in plain words", () => {
    expect(syncLabel(info())).toBe("Synced");
    expect(syncLabel(info({ status: "syncing" }))).toBe("Syncing…");
    expect(syncLabel(info({ status: "offline" }))).toMatch(/^Offline/);
    expect(syncLabel(info({ status: "error" }))).toMatch(/Sync now/);
  });

  it("has no sub-line before anything happened", () => {
    expect(syncSub(info())).toBeUndefined();
  });

  it("counts waiting changes with the right plural", () => {
    expect(syncSub(info({ pending: 1 }))).toBe("1 change waiting to upload");
    expect(syncSub(info({ pending: 3 }))).toBe("3 changes waiting to upload");
  });

  it("shows the last sync time in Asia/Kolkata", () => {
    // 2026-01-01T06:30:00Z is 12:00 pm in India
    expect(syncSub(info({ lastSyncedAt: Date.UTC(2026, 0, 1, 6, 30) }))).toMatch(/^Last synced 12:00\s?pm$/i);
  });

  it("says waiting to upload, not Synced, while edits are queued", () => {
    expect(syncLabel(info({ pending: 2 }))).toBe("Waiting to upload");
    expect(syncLabel(info({ status: "syncing", pending: 2 }))).toBe("Syncing…");
  });

  it("shows a plain-language error line when sync failed", () => {
    expect(syncSub(info({ status: "error", pending: 2, lastError: "boom" }))).toBe(OTHER);
    expect(syncSub(info({ status: "error", lastError: "TypeError: Failed to fetch" }))).toBe(NETWORK);
  });

  it("falls back to pending when error has no message", () => {
    expect(syncSub(info({ status: "error", pending: 2 }))).toBe("2 changes waiting to upload");
  });
});
