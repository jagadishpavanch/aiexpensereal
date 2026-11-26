import { describe, expect, it } from "vitest";
import { syncLabel, syncSub } from "./labels";
import type { SyncInfo } from "./engine";

const info = (o: Partial<SyncInfo> = {}): SyncInfo => ({ status: "idle", pending: 0, lastSyncedAt: null, lastError: null, ...o });

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

  it("shows the error on one shortened line when sync failed", () => {
    expect(syncSub(info({ status: "error", pending: 2, lastError: "boom" }))).toBe("boom");
    const long = syncSub(info({ status: "error", lastError: `line one\nline two ${"x".repeat(200)}` }))!;
    expect(long).not.toContain("\n");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("falls back to pending when error has no message", () => {
    expect(syncSub(info({ status: "error", pending: 2 }))).toBe("2 changes waiting to upload");
  });
});
