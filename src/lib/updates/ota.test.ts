import { describe, expect, it, vi } from "vitest";
import {
  createOtaController,
  type OtaControllerDeps,
  type UpdaterAdapter,
  type UpdaterBundle,
} from "./ota";

const CHECKSUM = "b".repeat(64);
const ZIP_URL =
  "https://example.supabase.co/storage/v1/object/public/app-updates/extrack-1.0.1.zip";

function fakeDeps(overrides?: {
  native?: boolean;
  online?: boolean;
  manifest?: unknown;
  fetchError?: Error;
  activeBundle?: UpdaterBundle;
  nativeVersion?: string;
  bundles?: UpdaterBundle[];
  pending?: UpdaterBundle | null;
}) {
  let pending = overrides?.pending ?? null;
  let bundles = overrides?.bundles ?? [{ id: "builtin", version: "1.0.0", status: "success" }];
  const updater: UpdaterAdapter = {
    notifyAppReady: vi.fn(async () => ({ bundle: overrides?.activeBundle ?? bundles[0] })),
    current: vi.fn(async () => ({
      bundle: overrides?.activeBundle ?? bundles[0],
      native: overrides?.nativeVersion ?? "1.0",
    })),
    list: vi.fn(async () => ({ bundles })),
    getNextBundle: vi.fn(async () => pending),
    download: vi.fn(async ({ version }) => {
      const nextBundle: UpdaterBundle = { id: `bundle-${version}`, version, status: "success" };
      bundles = [...bundles, nextBundle];
      return nextBundle;
    }),
    next: vi.fn(async ({ id }) => {
      const found = bundles.find((b) => b.id === id) ?? { id, version: "1.0.1", status: "pending" };
      pending = found;
      return found;
    }),
    reload: vi.fn(async () => {}),
  };

  let foregroundCb: (() => void) | undefined;
  let clock = 1_000_000;
  const deps: OtaControllerDeps = {
    isNative: () => overrides?.native ?? true,
    isOnline: () => overrides?.online ?? true,
    manifestUrl: () =>
      "https://example.supabase.co/storage/v1/object/public/app-updates/manifest.json",
    fetchManifest: vi.fn(async () => {
      if (overrides?.fetchError) throw overrides.fetchError;
      return (
        overrides?.manifest ?? {
          version: "1.0.1",
          url: ZIP_URL,
          checksum: CHECKSUM,
          minNativeVersion: "1.0",
        }
      );
    }),
    loadUpdater: async () => updater,
    subscribeForeground: (cb) => {
      foregroundCb = cb;
    },
    now: () => clock,
    cooldownMs: 60_000,
  };

  return {
    controller: createOtaController(deps),
    updater,
    deps,
    advanceTime: (ms: number) => {
      clock += ms;
    },
    triggerForeground: () => foregroundCb?.(),
  };
}

describe("OTA update controller", () => {
  it("notifies native app ready and stages a newer bundle on startup", async () => {
    const { controller, updater } = fakeDeps();
    await controller.init();
    await new Promise((r) => setTimeout(r, 0));

    expect(updater.notifyAppReady).toHaveBeenCalledTimes(1);
    expect(updater.download).toHaveBeenCalledWith({
      url: ZIP_URL,
      version: "1.0.1",
      checksum: CHECKSUM,
    });
    expect(updater.next).toHaveBeenCalledWith({ id: "bundle-1.0.1" });
    expect(controller.getState()).toMatchObject({
      status: "ready",
      pendingVersion: "1.0.1",
    });
  });

  it("is a no-op on non-native web platforms", async () => {
    const { controller, updater, deps } = fakeDeps({ native: false });
    await controller.init();
    const res = await controller.checkForUpdate({ manual: true });

    expect(res).toEqual({ kind: "unavailable" });
    expect(updater.notifyAppReady).not.toHaveBeenCalled();
    expect(deps.fetchManifest).not.toHaveBeenCalled();
  });

  it("reuses an already-downloaded bundle without downloading again", async () => {
    const { controller, updater } = fakeDeps({
      bundles: [
        { id: "builtin", version: "1.0.0", status: "success" },
        { id: "cached-1.0.1", version: "1.0.1", status: "success" },
      ],
    });
    const res = await controller.checkForUpdate({ manual: true });

    expect(res).toEqual({ kind: "ready", version: "1.0.1" });
    expect(updater.download).not.toHaveBeenCalled();
    expect(updater.next).toHaveBeenCalledWith({ id: "cached-1.0.1" });
  });

  it("skips updates that require a newer native APK", async () => {
    const { controller, updater } = fakeDeps({
      manifest: { version: "2.0.0", url: ZIP_URL, checksum: CHECKSUM, minNativeVersion: "2.0" },
      nativeVersion: "1.0",
    });
    const res = await controller.checkForUpdate({ manual: true });

    expect(res).toEqual({ kind: "native_too_old", minNativeVersion: "2.0" });
    expect(updater.download).not.toHaveBeenCalled();
  });

  it("fails quietly in background when offline or manifest is missing", async () => {
    const { controller } = fakeDeps({ fetchError: new Error("Manifest fetch failed (404)") });
    const res = await controller.checkForUpdate({ manual: false });

    expect(res).toEqual({ kind: "error" });
    expect(controller.getState().status).toBe("idle");
  });

  it("applies a pending update by calling reload()", async () => {
    const { controller, updater } = fakeDeps();
    await controller.checkForUpdate({ manual: true });
    await controller.applyPendingUpdate();

    expect(updater.reload).toHaveBeenCalledTimes(1);
  });
});
