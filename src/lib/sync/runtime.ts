import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/auth/supabase";
import { listenForNativeCallback } from "@/lib/auth/google";
import { syncPort } from "@/lib/finance/store";
import { createSyncEngine, type SyncEngine, type SyncInfo } from "./engine";
import { supabaseRemote } from "./supabase-remote";

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
  // Supabase warns against awaiting its own calls inside this callback, so defer.
  db.auth.onAuthStateChange((_event, s) => void setTimeout(() => onUser(s?.user ?? null), 0));
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  if (Capacitor.isNativePlatform()) {
    listenForNativeCallback(db).catch((err) => console.warn("[auth]", err));
  }
}

function onUser(user: User | null) {
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

/** Upload what we can, then remove this user's data from the phone and sign out of this phone only. */
export async function signOutAndForget() {
  // Best effort, but a dead connection must not freeze the Sign out button.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((res) => { timer = setTimeout(res, SIGN_OUT_SYNC_MS); });
  await Promise.race([engine?.syncNow().catch(() => {}), giveUp]);
  clearTimeout(timer);
  try {
    // scope "local" removes the stored session before any request, so it sticks offline and other devices stay signed in.
    const { error } = (await getSupabase()?.auth.signOut({ scope: "local" })) ?? {};
    if (error) console.warn("[auth]", error);
  } catch (err) {
    console.warn("[auth]", err);
  }
  engine?.forget();
  engine?.stop();
  engine = null;
  resetInfo();
  setSession({ auth: "signedOut" });
}

/** Delete every record in the account (as tombstones so other devices clear too) and on this phone. */
export async function deleteEverything() {
  if (!engine) throw new Error("Not signed in");
  await engine.wipeAll();
}
