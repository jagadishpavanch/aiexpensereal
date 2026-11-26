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

/** Call once on the client. Follows the Supabase session and runs one sync engine per signed-in user. */
export function initAppSession() {
  if (started || typeof window === "undefined") return;
  started = true;
  const db = getSupabase();
  if (!db) return setSession({ auth: "misconfigured" });
  // Supabase warns against awaiting its own calls inside this callback, so defer.
  db.auth.onAuthStateChange((_event, s) => void setTimeout(() => onUser(s?.user ?? null), 0));
  window.addEventListener("online", () => void engine?.syncNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void engine?.syncNow();
  });
  if (Capacitor.isNativePlatform()) void listenForNativeCallback(db);
}

function onUser(user: User | null) {
  if (!user) {
    engine?.stop();
    engine = null;
    return setSession({ auth: "signedOut" });
  }
  if (engine && session.auth === "signedIn" && session.user.id === user.id) return setSession({ ...session, user });
  engine?.stop();
  engine = createSyncEngine({
    remote: supabaseRemote(getSupabase()!, user.id),
    port: syncPort,
    kv: localStorage,
    onInfo: (i) => {
      info = i;
      notify();
    },
  });
  startEngine(user);
}

function startEngine(user: User) {
  setSession({ auth: "signedIn", user, sync: "starting" });
  engine!.start(user.id).then(
    () => setSession({ auth: "signedIn", user, sync: "ready" }),
    () => setSession({ auth: "signedIn", user, sync: "failed" }),
  );
}

export const syncNow = () => engine?.syncNow() ?? Promise.resolve();
export function retrySync() {
  if (session.auth === "signedIn" && engine) startEngine(session.user);
}

/** Upload what we can, then remove this user's data from the phone and sign out. */
export async function signOutAndForget() {
  await engine?.syncNow();
  engine?.forget();
  engine?.stop();
  engine = null;
  setSession({ auth: "signedOut" });
  await getSupabase()?.auth.signOut();
}

/** Delete every record in the account (as tombstones so other devices clear too) and on this phone. */
export async function deleteEverything() {
  if (!engine) throw new Error("Not signed in");
  await engine.wipeAll();
}
