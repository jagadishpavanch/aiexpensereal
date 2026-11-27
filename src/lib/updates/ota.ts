import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { parseManifest, parseSemver, resolveManifestUrl, shouldApplyUpdate } from "./manifest";
import { BUNDLE_VERSION } from "./version";

export type OtaStatus = "idle" | "checking" | "downloading" | "ready" | "up_to_date" | "error";

export interface OtaState {
  currentVersion: string;
  pendingVersion: string | null;
  status: OtaStatus;
  lastCheckedAt: number | null;
}

export interface UpdaterBundle {
  id: string;
  version: string;
  status?: string;
}

export interface UpdaterAdapter {
  notifyAppReady(): Promise<unknown>;
  current(): Promise<{ bundle: UpdaterBundle; native: string }>;
  list(): Promise<{ bundles: UpdaterBundle[] }>;
  getNextBundle(): Promise<UpdaterBundle | null>;
  download(options: { url: string; version: string; checksum?: string }): Promise<UpdaterBundle>;
  next(options: { id: string }): Promise<UpdaterBundle>;
  reload(): Promise<void>;
}

export interface OtaControllerDeps {
  isNative: () => boolean;
  isOnline: () => boolean;
  manifestUrl: () => string | null;
  fetchManifest: (url: string) => Promise<unknown>;
  loadUpdater: () => Promise<UpdaterAdapter>;
  subscribeForeground?: (onActive: () => void) => void;
  now?: () => number;
  cooldownMs?: number;
}

export type OtaCheckResult =
  | { kind: "ready"; version: string }
  | { kind: "up_to_date" }
  | { kind: "native_too_old"; minNativeVersion: string }
  | { kind: "offline" }
  | { kind: "unavailable" }
  | { kind: "error" };

const DEFAULT_COOLDOWN_MS = 60_000;

export function createOtaController(deps: OtaControllerDeps) {
  const now = deps.now ?? (() => Date.now());
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let state: OtaState = {
    currentVersion: BUNDLE_VERSION,
    pendingVersion: null,
    status: "idle",
    lastCheckedAt: null,
  };
  let started = false;
  let inFlight: Promise<OtaCheckResult> | null = null;
  const subs = new Set<() => void>();

  const emit = () => subs.forEach((fn) => fn());
  const setState = (patch: Partial<OtaState>) => {
    state = { ...state, ...patch };
    emit();
  };

  function subscribe(fn: () => void) {
    subs.add(fn);
    return () => void subs.delete(fn);
  }

  function getState(): OtaState {
    return state;
  }

  async function syncVersions(updater: UpdaterAdapter) {
    try {
      const [{ bundle, native }, pending] = await Promise.all([
        updater.current(),
        updater.getNextBundle(),
      ]);
      const activeVersion =
        bundle.id !== "builtin" && parseSemver(bundle.version) ? bundle.version : BUNDLE_VERSION;
      const pendingVersion = pending && parseSemver(pending.version) ? pending.version : null;
      setState({
        currentVersion: activeVersion,
        pendingVersion,
        ...(pendingVersion ? { status: "ready" as const } : {}),
      });
      return { activeVersion, nativeVersion: parseSemver(native) ? native : "1.0", pending };
    } catch {
      return { activeVersion: state.currentVersion, nativeVersion: "1.0", pending: null };
    }
  }

  async function runCheck(manual: boolean): Promise<OtaCheckResult> {
    if (!deps.isNative()) return { kind: "unavailable" };
    if (!deps.isOnline()) {
      if (manual && !state.pendingVersion) setState({ status: "error" });
      return { kind: "offline" };
    }
    const url = deps.manifestUrl();
    if (!url) return { kind: "unavailable" };

    if (!manual && state.lastCheckedAt !== null && now() - state.lastCheckedAt < cooldownMs) {
      return state.pendingVersion
        ? { kind: "ready", version: state.pendingVersion }
        : { kind: "up_to_date" };
    }

    if (manual) setState({ status: "checking" });

    try {
      const updater = await deps.loadUpdater();
      const { activeVersion, nativeVersion, pending } = await syncVersions(updater);
      const raw = await deps.fetchManifest(url);
      setState({ lastCheckedAt: now() });

      const manifest = parseManifest(raw);
      if (!manifest) {
        if (manual && !pending) setState({ status: "idle" });
        return { kind: "unavailable" };
      }

      const decision = shouldApplyUpdate(manifest, {
        currentVersion: activeVersion,
        nativeVersion,
      });
      if (!decision.apply) {
        if (pending) {
          setState({ status: "ready", pendingVersion: pending.version });
          return { kind: "ready", version: pending.version };
        }
        setState({
          status: manual ? (decision.reason === "up_to_date" ? "up_to_date" : "idle") : "idle",
        });
        return decision.reason === "native_too_old"
          ? { kind: "native_too_old", minNativeVersion: manifest.minNativeVersion! }
          : { kind: "up_to_date" };
      }

      if (pending?.version === manifest.version) {
        setState({ status: "ready", pendingVersion: pending.version });
        return { kind: "ready", version: pending.version };
      }

      const { bundles } = await updater.list();
      const cached = bundles.find(
        (b) => b.version === manifest.version && (b.status === "success" || b.status === "pending"),
      );

      let target = cached;
      if (!target) {
        setState({ status: "downloading" });
        target = await updater.download({
          url: manifest.url,
          version: manifest.version,
          checksum: manifest.checksum,
        });
      }

      await updater.next({ id: target.id });
      setState({ status: "ready", pendingVersion: manifest.version });
      return { kind: "ready", version: manifest.version };
    } catch (err) {
      if (manual) {
        console.warn("[ota]", err);
        setState({ status: state.pendingVersion ? "ready" : "error" });
      } else {
        setState({ status: state.pendingVersion ? "ready" : "idle" });
      }
      return { kind: "error" };
    }
  }

  function checkForUpdate(options?: { manual?: boolean }): Promise<OtaCheckResult> {
    if (inFlight) return inFlight;
    const manual = options?.manual ?? false;
    inFlight = runCheck(manual).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function init() {
    if (started || typeof window === "undefined" || !deps.isNative()) return;
    started = true;
    try {
      const updater = await deps.loadUpdater();
      // Confirm bundle boot immediately before any network calls so rollback never triggers on slow networks.
      await updater.notifyAppReady();
      await syncVersions(updater);
    } catch (err) {
      console.warn("[ota]", err);
    }
    window.addEventListener("online", () => void checkForUpdate({ manual: false }));
    deps.subscribeForeground?.(() => void checkForUpdate({ manual: false }));
    void checkForUpdate({ manual: false });
  }

  async function applyPendingUpdate() {
    if (!deps.isNative()) return;
    const updater = await deps.loadUpdater();
    await updater.reload();
  }

  return { init, checkForUpdate, applyPendingUpdate, getState, subscribe };
}

const defaultController = createOtaController({
  isNative: () => Capacitor.isNativePlatform(),
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  manifestUrl: () =>
    resolveManifestUrl({
      VITE_OTA_MANIFEST_URL: import.meta.env["VITE_OTA_MANIFEST_URL"] as string | undefined,
      VITE_SUPABASE_URL: import.meta.env["VITE_SUPABASE_URL"] as string | undefined,
    }),
  fetchManifest: async (url) => {
    const reqUrl = new URL(url);
    reqUrl.searchParams.set("t", String(Date.now()));
    const res = await fetch(reqUrl.toString(), { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Manifest fetch failed (${res.status})`);
    return res.json();
  },
  loadUpdater: async () => {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    return CapacitorUpdater;
  },
  subscribeForeground: (onActive) => {
    import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => isActive && onActive()),
      )
      .catch((err) => console.warn("[ota]", err));
  },
});

const SERVER_SNAPSHOT: OtaState = {
  currentVersion: BUNDLE_VERSION,
  pendingVersion: null,
  status: "idle",
  lastCheckedAt: null,
};

export function initOtaUpdates() {
  void defaultController.init();
}

export function checkForOtaUpdate(options?: { manual?: boolean }) {
  return defaultController.checkForUpdate(options);
}

export function applyPendingOtaUpdate() {
  return defaultController.applyPendingUpdate();
}

export function useOtaState(): OtaState {
  return useSyncExternalStore(
    defaultController.subscribe,
    defaultController.getState,
    () => SERVER_SNAPSHOT,
  );
}
