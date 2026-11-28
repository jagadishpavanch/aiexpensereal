import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import type { AuthChangeEvent, SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/auth/supabase";
import { listenForNativeCallback } from "@/lib/auth/google";
import { syncPort } from "@/lib/finance/store";
import { createSyncEngine, SYNC_KEYS, type SyncEngine, type SyncInfo } from "./engine";
import { supabaseRemote } from "./supabase-remote";
import { projectUrl } from "@/lib/auth/project-url";

export type AppSession =
  | { auth: "loading" }
  | { auth: "misconfigured" }
  | { auth: "signedOut" }
  | { auth: "signedIn"; user: User; sync: "starting" | "ready" | "failed" };

const LOADING: AppSession = { auth: "loading" };
const IDLE_INFO: SyncInfo = { status: "idle", pending: 0, lastSyncedAt: null, lastError: null };
let session: AppSession = LOADING;
let info: SyncInfo = IDLE_INFO;
let engine: SyncEngine | null = null;
let started = false;
/** True while signOutAndForget runs: the SIGNED_OUT that supabase fires mid-call must not take the keep-data path. */
let signingOut = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));
const setSession = (s: AppSession) => {
  session = s;
  notify();
};

export const useAppSession = () => useSyncExternalStore(subscribe, () => session, () => LOADING);
export const useSyncInfo = () => useSyncExternalStore(subscribe, () => info, () => IDLE_INFO);

const resetInfo = () => {
  info = IDLE_INFO;
  notify();
};
/** Engines whose start() has not settled yet, so an overlapping retry cannot start a second one. */
const starting = new WeakSet<SyncEngine>();
/** Only an engine that has settled ownership of this phone's data may sync. */
const canSync = () => session.auth === "signedIn" && session.sync === "ready";

/** Call once on the client. Follows the Supabase session and runs one sync engine per signed-in user. */
export function initAppSession() {
  if (started || typeof window === "undefined") return;
  started = true;
  const db = getSupabase();
  if (!db) return setSession({ auth: "misconfigured" });
  // A returning user whose data is already on this phone opens at once. Supabase's first event can take ~25 s
  // offline with an expired token (it retries the refresh), and it changes nothing for this user when it arrives;
  // a revoked session still ends in SIGNED_OUT. Anyone else (new phone, other account) waits for supabase.
  const stored = storedUser(db);
  if (stored && localStorage.getItem(SYNC_KEYS.owner) === stored.id) onUser(stored);
  // Supabase warns against awaiting its own calls inside this callback, so defer.
  db.auth.onAuthStateChange((event, s) => void setTimeout(() => onAuth(db, event, s?.user ?? null), 0));
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  if (Capacitor.isNativePlatform()) {
    listenForNativeCallback(db).catch((err) => console.warn("[auth]", err));
  }
}

/**
 * Opening the app offline with an expired access token: the refresh fails with a retryable network error, supabase
 * keeps the session in storage but emits INITIAL_SESSION with null. Treat the stored user as signed in; once the
 * network is back, auto-refresh emits TOKEN_REFRESHED or (refresh token rejected) SIGNED_OUT.
 */
function onAuth(db: SupabaseClient, event: AuthChangeEvent, user: User | null) {
  onUser(user ?? (event === "INITIAL_SESSION" ? storedUser(db) : null));
}

function storedUser(db: SupabaseClient): User | null {
  try {
    const key = (db.auth as unknown as { storageKey?: unknown }).storageKey;
    const url = projectUrl(import.meta.env["VITE_SUPABASE_URL"] as string | undefined);
    const k = typeof key === "string" ? key : url ? `sb-${new URL(url).hostname.split(".")[0]}-auth-token` : null;
    const raw = k ? localStorage.getItem(k) : null;
    const u = raw ? (JSON.parse(raw) as { user?: { id?: unknown } } | null)?.user : null;
    return u && typeof u.id === "string" ? (u as User) : null;
  } catch {
    return null;
  }
}

function onUser(user: User | null) {
  if (signingOut) return; // signOutAndForget finishes the job (forget, then signed out)
  if (!user) {
    // An unrequested sign-out (expired session, failed refresh) keeps this phone's data and queued edits, so the
    // same user's next sign-in pushes them. Another account never receives them: start() resets local data and
    // the outbox when the stored owner differs, and nothing is pushed until it has.
    engine?.stop();
    engine = null;
    resetInfo();
    return setSession({ auth: "signedOut" });
  }
  if (engine && session.auth === "signedIn" && session.user.id === user.id) return setSession({ ...session, user });
  engine?.stop();
  resetInfo();
  const created: SyncEngine = createSyncEngine({
    remote: supabaseRemote(getSupabase()!, user.id),
    port: syncPort,
    kv: localStorage,
    onInfo: (i) => {
      if (engine !== created) return; // a stopped engine must not overwrite the current one's status
      info = i;
      notify();
    },
  });
  engine = created;
  startEngine(user);
}

function startEngine(user: User) {
  const e = engine;
  if (!e || starting.has(e)) return;
  starting.add(e);
  setSession({ auth: "signedIn", user, sync: "starting" });
  // A start that resolves after sign-out or a user switch must not bring the old session back.
  const settle = (sync: "ready" | "failed") => {
    starting.delete(e);
    if (engine !== e) return;
    const current = session.auth === "signedIn" ? session.user : user;
    setSession({ auth: "signedIn", user: current, sync });
  };
  e.start(user.id).then(
    () => settle("ready"),
    () => settle("failed"),
  );
}

/** A no-op until the engine has settled whose data this phone holds. */
export const syncNow = () => (canSync() && engine ? engine.syncNow() : Promise.resolve());
export function retrySync() {
  if (session.auth === "signedIn" && engine) startEngine(session.user);
}

const SIGN_OUT_SYNC_MS = 5000;

/**
 * Upload what we can, then remove this user's data from the phone and sign out of this phone only.
 * Edits that still could not be uploaded are never thrown away unasked: without `discardUnsynced` the call stops
 * (still signed in, data untouched) and reports how many, so the screen can ask first.
 */
export async function signOutAndForget(opts?: { discardUnsynced?: boolean }): Promise<{ signedOut: boolean; pending: number }> {
  // Supabase fires SIGNED_OUT before signOut() resolves, so hold on to this engine and keep onUser out of the way.
  const e = engine;
  signingOut = true;
  try {
    // Best effort, but a dead connection must not freeze the Sign out button.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const giveUp = new Promise<void>((res) => { timer = setTimeout(res, SIGN_OUT_SYNC_MS); });
    await Promise.race([e?.syncNow().catch(() => {}), giveUp]);
    clearTimeout(timer);
    const pending = e ? info.pending : 0;
    if (pending > 0 && !opts?.discardUnsynced) return { signedOut: false, pending };
    try {
      // scope "local" removes the stored session before any request, so it sticks offline and other devices stay signed in.
      const { error } = (await getSupabase()?.auth.signOut({ scope: "local" })) ?? {};
      if (error) console.warn("[auth]", error);
    } catch (err) {
      console.warn("[auth]", err);
    }
    e?.forget();
    e?.stop();
    if (engine === e) engine = null;
    resetInfo();
    setSession({ auth: "signedOut" });
    return { signedOut: true, pending };
  } finally {
    signingOut = false;
  }
}

/** Delete every record in the account (as tombstones so other devices clear too) and on this phone. */
export async function deleteEverything() {
  if (!engine) throw new Error("Not signed in");
  await engine.wipeAll();
}
